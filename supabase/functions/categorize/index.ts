// Supabase Edge Function: categorize
// Classifies a single grocery item name into one of Korb's fixed categories,
// and — in the same call, so each is ~free — a coarse food group for the basket
// balance insight, an emoji for the item row, and whether the term is generic
// enough to share. Called only for items the on-device keyword map, the shared
// lexicon and the local cache all failed to resolve.
//
// Piling four answers into one call is the whole cost story of this function.
// The request, the model load and the round trip are paid once; each extra
// field is a handful of output tokens. A separate "get me an emoji" endpoint
// would have doubled the calls to answer a question we were already asking.
//
// The answer also goes into the shared item_lexicon so the next person to type
// the same word gets it for free, with no call at all. Publication is gated —
// see migration 0019 and _shared/lexicon.ts.
//
// Deploy:  supabase functions deploy categorize
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase secrets set LEXICON_SALT=$(openssl rand -hex 32)
//          (without LEXICON_SALT the function still answers; it just stops
//           contributing to the shared lexicon — see offerToLexicon)

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

import { EMOJI_ALLOWLIST, isAllowedEmoji } from '../_shared/emoji-allowlist.ts';
import { offerToLexicon } from '../_shared/lexicon.ts';
import { clientIp, reserveBudget } from '../_shared/rate-limit.ts';

const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
type Category = (typeof CATEGORIES)[number];

const GROUPS = ['protein', 'carbs', 'produce', 'fats', 'other', 'nonfood'] as const;
type Group = (typeof GROUPS)[number];

// Kept in step with UNITS in packages/shared and the CHECK on
// item_lexicon.unit (migration 0021). Deno can't import from the workspace, so
// this is a copy — the CHECK is what stops the two drifting silently.
const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'] as const;
type Unit = (typeof UNITS)[number];

const SYSTEM_PROMPT = `You classify a single grocery item. The name may be in ANY
language — Hindi, Turkish, Arabic, anything — not only the ones this app ships in.
Return ONLY a JSON object, no prose, no code fences. EVERY key is required:
{"category": "...", "group": "...", "emoji": "...", "generic": true, "unit": "..."}
category is one of: ${CATEGORIES.join(', ')}.
- produce/herbs -> fruit_veg; milk/cheese/eggs -> dairy_eggs; fresh meat/fish -> meat_fish;
  bread/pastries -> bakery; dry/canned/staples/condiments -> pantry; frozen goods -> frozen;
  beverages -> drinks; cleaning/paper/kitchen -> household; toiletries/cosmetics -> personal_care;
  if genuinely unclear, other.
group is the coarse food group, one of: ${GROUPS.join(', ')}.
- meat/fish/eggs/tofu/beans/lentils/high-protein dairy -> protein;
  bread/pasta/rice/cereal/potato/sugar/flour -> carbs;
  fresh fruit & vegetables -> produce;
  oils/butter/nuts/seeds/avocado -> fats;
  drinks/snacks/sweets/condiments or unclear food -> other;
  cleaning/toiletries/anything not eaten -> nonfood.
emoji MUST be copied exactly from this list, nothing else:
${EMOJI_ALLOWLIST.join(' ')}
Pick the closest match. For a branded product pick the emoji for what is inside
the packet, not the packet. If nothing fits, use the one that best matches the
category you chose.
generic is a boolean: true if this is an ordinary grocery product that any
shopper in Europe might write on a list, in any language. false for anything
personal, one-off, or not really a product — a person's name, a note to self, a
specific shop or address, a medication brand, a gift description, gibberish.
When in doubt, false.
unit is how a European shopper normally BUYS this item, one of: ${UNITS.join(', ')},
or null. Answer with a unit ONLY when one is clearly standard for the product:
milk -> L, potatoes -> kg, bread -> pcs, coffee -> g, olive oil -> ml.
Use null whenever it is genuinely a toss-up — yoghurt sold in both small pots
and big tubs, sauces that come in bottles and jars, anything you would have to
guess at. null is a good answer and is expected often; the app leaves the choice
to the user, which is much better than a confident wrong unit they have to
notice and undo. Do not pick a unit just because the category usually uses it.`;

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'Body must be {"name": string}' }, { status: 400 });
  }

  // Five short fields plus JSON punctuation. Generous on purpose: a truncated
  // response parses as nothing and costs a whole call. Declared here rather
  // than inline because the budget guard has to know the ceiling before the
  // call, and the two must never drift apart.
  const MAX_TOKENS = 140;
  const guard = await reserveBudget(req, 'categorize', SYSTEM_PROMPT + name, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: name.trim() }],
  });

  // Refund the unused part of the reservation before anything else can throw:
  // a parse failure below must not leave the caller charged the worst case for
  // a call that cost a fraction of it.
  await guard.settle(message.usage);

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let category: Category = 'other';
  let group: Group | null = null;
  let emoji: string | null = null;
  let generic = false;
  let unit: Unit | null = null;
  try {
    const parsed = JSON.parse(extractJson(raw)) as {
      category?: string;
      group?: string;
      emoji?: string;
      generic?: boolean;
      unit?: string | null;
    };
    if (parsed.category && (CATEGORIES as readonly string[]).includes(parsed.category)) {
      category = parsed.category as Category;
    }
    if (parsed.group && (GROUPS as readonly string[]).includes(parsed.group)) {
      group = parsed.group as Group;
    }
    // Membership test, not a shape test. Anything the model invented outside
    // the list is dropped and the client falls back to its category emoji —
    // a slightly generic icon beats an unvetted glyph on every customer's
    // screen. See _shared/emoji-allowlist.ts.
    if (isAllowedEmoji(parsed.emoji)) emoji = parsed.emoji;
    generic = parsed.generic === true;
    // Membership test again, and anything else — including the model deciding
    // to answer "piece" or "litre" — collapses to null, which is the same
    // outcome as it saying it wasn't sure. Falling back to a guess would
    // undo the whole point of letting it decline.
    if (typeof parsed.unit === 'string' && (UNITS as readonly string[]).includes(parsed.unit)) {
      unit = parsed.unit as Unit;
    }
  } catch {
    // leave defaults
  }

  // Offer the answer to the shared dictionary, but never make this caller wait
  // for it: they already have everything they asked for. EdgeRuntime.waitUntil
  // keeps the isolate alive for the write after the response has been sent;
  // where it isn't available the promise is simply left to run.
  if (emoji) {
    const write = offerToLexicon(
      { term: name.trim(), emoji, category, generic, unit },
      `ip:${clientIp(req)}`,
    );
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(write);
    else void write;
  }

  return Response.json({ category, group, emoji, unit });
});
