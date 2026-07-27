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
import { clientIp, rateLimit } from '../_shared/rate-limit.ts';

const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
type Category = (typeof CATEGORIES)[number];

const GROUPS = ['protein', 'carbs', 'produce', 'fats', 'other', 'nonfood'] as const;
type Group = (typeof GROUPS)[number];

const SYSTEM_PROMPT = `You classify a single grocery item.
Return ONLY a JSON object, no prose, no code fences: {"category": "...", "group": "..."}.
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
When in doubt, false.`;

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

  const limited = await rateLimit(req, 'categorize');
  if (limited) return limited;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    // Four short fields plus JSON punctuation. Raised from 40 with room to
    // spare: a truncated response parses as nothing and costs a whole call.
    max_tokens: 120,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: name.trim() }],
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let category: Category = 'other';
  let group: Group | null = null;
  let emoji: string | null = null;
  let generic = false;
  try {
    const parsed = JSON.parse(extractJson(raw)) as {
      category?: string;
      group?: string;
      emoji?: string;
      generic?: boolean;
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
  } catch {
    // leave defaults
  }

  // Offer the answer to the shared dictionary, but never make this caller wait
  // for it: they already have everything they asked for. EdgeRuntime.waitUntil
  // keeps the isolate alive for the write after the response has been sent;
  // where it isn't available the promise is simply left to run.
  if (emoji) {
    const write = offerToLexicon(
      { term: name.trim(), emoji, category, generic },
      `ip:${clientIp(req)}`,
    );
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(write);
    else void write;
  }

  return Response.json({ category, group, emoji });
});
