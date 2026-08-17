// Supabase Edge Function: suggest-swaps
// Three lighter alternatives for one high-impact grocery item, as a ladder:
// an easy like-for-like swap, a plant-based stand-in, and a whole-food change.
//
// Called only when a shopper TAPS one of their own heavy items on the Climate
// Mix page. That matters for cost as much as for tone: the call is gated behind
// a deliberate finger rather than fired for every row on a screen, so the ceiling
// is "items a person was curious enough to open", not "items they own".
//
// Every answer is cached in item_swaps by (folded term, locale), so the second
// household to wonder about beef pays nothing — and the cache is checked BEFORE
// the budget is reserved, because a cache hit is not an AI call and must not
// consume anyone's daily allowance.
//
// Deploy:  supabase functions deploy suggest-swaps
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (the same key the other functions use; nothing new to set)

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { EMOJI_ALLOWLIST, isAllowedEmoji, isShareableTerm } from '../_shared/emoji-allowlist.ts';
import { fold } from '../_shared/fold.ts';
import { offerToLexicon } from '../_shared/lexicon.ts';
import { clientIp, reserveBudget } from '../_shared/rate-limit.ts';

/** Mirrors packages/shared. Deno cannot import from the workspace. */
const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
const GROUPS = ['protein', 'carbs', 'produce', 'fats', 'other', 'nonfood'] as const;

/** The app's seven, mirrored by the CHECK in migration 0033. */
const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'nl', 'pl'] as const;
type Locale = (typeof LOCALES)[number];

const LANGUAGE: Record<Locale, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  nl: 'Dutch',
  pl: 'Polish',
};

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );
  }
  return admin;
}

/**
 * Which generation of the prompt below produced an answer.
 *
 * Part of item_swaps' key (migration 0034). BUMP THIS whenever a change to the
 * prompt would change the answers — every cached row from an older version
 * becomes invisible rather than wrong-but-served, and warms again on the next
 * reader. Leaving it alone after a real prompt change is the failure mode this
 * exists to prevent: the improvement ships and nobody who already asked ever
 * sees it.
 *
 *   1  first version. One worked example, beef mince, which anchored the model
 *      hard enough that a steak got mince suggested back.
 *   2  format-aware: read the FORM the shopper bought and keep it.
 *   3  form rule extended past meat — solid before liquid — and the dairy
 *      ladder named, because cheese was answering rung 2 with a seasoning
 *      (nutritional yeast) and rung 3 with a sauce (cashew cream). Neither is
 *      something you slice onto bread.
 */
const PROMPT_VERSION = 3;

/*
 * The three rungs are named in the prompt because they are a designed ladder,
 * not a ranked list of "greener foods". Asking for three alternatives without
 * saying what each rung is for reliably produced three versions of the same
 * answer — three kinds of bean for beef — which is useless to the one shopper
 * who will not eat beans and reads as a lecture to everyone else.
 *
 * The tone rules are load-bearing, not decoration. This app deleted a
 * suggestions feature once for being preachy (see lib/eco.ts), and a model
 * asked for "climate-friendly swaps" volunteers guilt unprompted.
 */
const SYSTEM_PROMPT = `You suggest lighter-footprint grocery alternatives.

Given one grocery item with a high climate footprint, reply with exactly three
alternatives a supermarket shopper could buy instead, as a ladder.

FIRST read the FORM the shopper bought, not just the food. "Steak", "ground
beef", "stewing beef", "beef roast", "sliced ham", "cheese block" and "grated
cheese" are different products that get bought for different meals, and an
alternative in the wrong form is useless however light it is. Nobody grills
mince, and nobody slices a sauce onto bread.

So: a solid stays a solid, sliced stays sliced, grated stays gratable, a spread
stays spreadable. Never answer a solid food with a liquid, a cream or a
seasoning while a solid alternative exists. Reach for a sauce or a sprinkle only
when the thing asked about was one.

Then, keeping that form:

1. The easy swap — the same kind of product in the SAME FORM, noticeably
   lighter. Steak becomes a chicken breast, not chicken mince. Ground beef
   becomes turkey mince. Stewing beef becomes diced chicken thigh. Hard cheese
   becomes a fresh, high-moisture cheese: ricotta, cottage cheese, feta.
2. The plant-based stand-in — a manufactured product that plays the same part,
   in the same form. This rung is a 1:1 REPLACEMENT and nothing else: if the
   shopper could not use it the same way, it does not belong here. Steak becomes
   a plant-based steak or seitan steak; ground beef becomes plant-based mince;
   sliced ham becomes plant-based deli slices; cheese becomes plant-based
   cheddar slices or a vegan mozzarella block — NOT nutritional yeast, which is
   a seasoning, and NOT cashew cream, which is a sauce.
3. The whole-food change — an unprocessed plant food or simple store-cupboard
   staple that fills the same place on the plate. This is the rung where a
   seasoning or a spread is finally the right answer. Steak becomes portobello
   mushrooms; ground beef becomes lentils; stewing beef becomes butter beans;
   cheese becomes nutritional yeast flakes; butter becomes olive oil.

Those examples are illustrations of the three rungs, not a menu to pick from.
The constraint that each rung be genuinely lighter than the item ASKED ABOUT
always wins: if a listed example is not lighter than what the shopper bought,
choose something else rather than using it.

If the item names no form at all ("beef", "cheese", "coffee"), do NOT invent
one: answer with the plainest common version of each rung.

Rules:
- Product names a shopper would write on a list, 1-3 words each.
- Every name in %{language}, spelled as a shopper in that country would write
  it. Do not answer in English unless %{language} is English.
- Each rung genuinely lighter than the item asked about, and rung 3 lighter
  than rung 1.
- Never repeat the item asked about, and never repeat a rung.
- No sentences, no reasons, no encouragement, no judgement. Names only.
- If the item is not food, or has no sensible lighter alternative, reply
  {"ok": false}.

For EACH rung also give the fields below. They cost a few tokens on a call
already being made, and without them the app has to ask a second time — once to
draw the row and again the moment somebody adds it to a list.

category is one of: ${CATEGORIES.join(', ')}.
group is the coarse food group, one of: ${GROUPS.join(', ')}.
emoji MUST be copied exactly from this list, nothing else:
${EMOJI_ALLOWLIST.join(' ')}
Pick the closest match for what the food IS.

Reply with JSON only, no prose:
{"ok": true, "tiers": [
  {"name": "...", "emoji": "...", "category": "...", "group": "..."},
  {"name": "...", "emoji": "...", "category": "...", "group": "..."},
  {"name": "...", "emoji": "...", "category": "...", "group": "..."}
]}`;

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

/**
 * A suggestion the table will accept.
 *
 * Length matches the CHECK in 0033 rather than being merely "sensible": a value
 * this rejects is one the insert would refuse anyway, and finding that out here
 * costs nothing while finding it out there loses the whole answer.
 */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) return null;
  return name;
}

/** One rung, as the client receives it. */
interface Rung {
  name: string;
  /** Null when the model gave something outside the allowlist. */
  emoji: string | null;
  category: string | null;
  group: string | null;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * Read one rung out of the model's answer.
 *
 * The NAME is required and everything else is optional, because they fail
 * differently. Without a name there is no rung. Without an emoji the client
 * falls back to its own category glyph, which is a slightly worse row rather
 * than a broken one — so a single out-of-allowlist emoji must not throw away a
 * ladder that is otherwise correct.
 */
function readRung(value: unknown): Rung | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const name = cleanName(raw.name);
  if (!name) return null;
  const emoji = typeof raw.emoji === 'string' && isAllowedEmoji(raw.emoji) ? raw.emoji : null;
  return {
    name,
    emoji,
    category: pick(raw.category, CATEGORIES),
    group: pick(raw.group, GROUPS),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const locale = (LOCALES as readonly string[]).includes(body?.locale)
    ? (body.locale as Locale)
    : 'en';

  if (!name) {
    return Response.json({ error: 'Body must be {"name": string}' }, { status: 400 });
  }

  const term = fold(name);
  // The same gate the lexicon uses. A term too long or too odd to share is one
  // that probably carries a person's own words ("beef for sarah's party"), and
  // it must not reach a table every household reads through.
  if (!isShareableTerm(term)) {
    return Response.json({ ok: false, reason: 'term' });
  }

  const db = adminClient();

  // Cache first, and BEFORE reserveBudget. A hit is not an AI call; charging a
  // caller's daily allowance for one would mean the more popular a term became,
  // the more it cost to look up.
  const { data: cached } = await db
    .from('item_swaps')
    .select('tier1, tier2, tier3')
    .eq('term', term)
    .eq('locale', locale)
    // Rows from an older prompt are not answers to the current question. See
    // PROMPT_VERSION.
    .eq('prompt_version', PROMPT_VERSION)
    .maybeSingle();

  if (cached) {
    /*
     * The names are cached here; their emoji, category and group are NOT, and
     * deliberately are not. item_lexicon is already the app's term → metadata
     * store and every client syncs it, so copying those three fields into
     * item_swaps as well would be the same facts in two tables, free to drift.
     *
     * One extra read fills them in, and it is a read rather than a model call —
     * which is the whole point of getting here.
     */
    const names: string[] = [cached.tier1, cached.tier2, cached.tier3];
    const terms = names.map(fold);
    const { data: known } = await db
      .from('item_lexicon')
      .select('term, emoji, category, food_group')
      .in('term', terms);

    const byTerm = new Map(
      (known ?? []).map((r) => [
        r.term as string,
        { emoji: r.emoji as string | null, category: r.category as string | null, group: r.food_group as string | null },
      ]),
    );

    return Response.json({
      ok: true,
      cached: true,
      tiers: names.map((n, i) => ({
        name: n,
        emoji: byTerm.get(terms[i])?.emoji ?? null,
        category: byTerm.get(terms[i])?.category ?? null,
        group: byTerm.get(terms[i])?.group ?? null,
      })),
    });
  }

  const system = SYSTEM_PROMPT.replace(/%\{language\}/g, LANGUAGE[locale]);

  // Three rungs of four short fields, plus JSON punctuation. Raised from 120
  // when the emoji, category and group were added: a truncated response parses
  // as nothing and costs the whole call, so the ceiling has to clear the
  // biggest honest answer with room to spare. Declared once, because the budget
  // guard has to know it before the call and the two must not drift apart.
  const MAX_TOKENS = 340;
  const guard = await reserveBudget(req, 'suggest-swaps', system + name, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: name }],
  });

  // Refund before anything below can throw: a parse failure must not leave the
  // caller charged the worst case for a call that cost a fraction of it.
  await guard.settle(message.usage);

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let tiers: [Rung, Rung, Rung] | null = null;
  try {
    const parsed = JSON.parse(extractJson(raw)) as { ok?: boolean; tiers?: unknown };
    if (parsed.ok !== false && Array.isArray(parsed.tiers)) {
      const rungs = parsed.tiers.map(readRung);
      // All three or none. Two rungs of a three-rung ladder is not a smaller
      // answer, it is a different and worse one — the shape is the meaning.
      if (rungs.length === 3 && rungs.every((r): r is Rung => r !== null)) {
        tiers = rungs as [Rung, Rung, Rung];
      }
    }
  } catch {
    // Falls through to the not-ok reply below.
  }

  if (!tiers) return Response.json({ ok: false, reason: 'no-answer' });

  /*
   * Fire-and-forget, and two separate writes because they answer to two
   * different tables with two different lifetimes.
   *
   * item_swaps is the ladder: which three foods stand in for this one, in this
   * language. ignoreDuplicates because two people can open the same item in the
   * same second.
   *
   * item_lexicon is what each suggested food IS — emoji, category, group. That
   * belongs there and nowhere else, so a suggestion the shopper adds to a list
   * arrives already classified and costs no second call to categorize. It goes
   * through the same publication gates as any other term; `generic: true`
   * because these names are ours, not something a user typed.
   */
  const writes = Promise.all([
    db
      .from('item_swaps')
      .upsert(
        {
          term,
          locale,
          prompt_version: PROMPT_VERSION,
          tier1: tiers[0].name,
          tier2: tiers[1].name,
          tier3: tiers[2].name,
        },
        { onConflict: 'term,locale,prompt_version', ignoreDuplicates: true },
      )
      .then(() => {}),
    ...tiers
      .filter((r) => r.emoji)
      .map((r) =>
        offerToLexicon(
          {
            term: r.name,
            emoji: r.emoji as string,
            category: r.category,
            generic: true,
            group: r.group,
          },
          `ip:${clientIp(req)}`,
        ),
      ),
  ]).then(() => {});

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(writes);
  else void writes;

  return Response.json({ ok: true, cached: false, tiers });
});
