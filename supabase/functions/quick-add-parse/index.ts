// Supabase Edge Function: quick-add-parse
// Turns a free-text (or transcribed voice) utterance into structured grocery
// items via Claude. The Anthropic key lives server-side only — the mobile app
// never talks to the AI provider directly.
//
// Deploy:  supabase functions deploy quick-add-parse
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { z } from 'npm:zod@3.24.1';

import { EMOJI_ALLOWLIST } from '../_shared/emoji-allowlist.ts';
import { offerToLexicon } from '../_shared/lexicon.ts';
import { clientIp, reserveBudget } from '../_shared/rate-limit.ts';

// Keep in sync with packages/shared/src/schemas.ts. Lenient on purpose: bad
// units/quantities become null rather than failing the whole parse.
const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
// Named once and interpolated into the prompt below, so the list the model is
// shown and the list the parser accepts cannot drift — they used to be two
// hand-written copies of the same ten words.
const itemCategorySchema = z.enum(CATEGORIES);

const quickAddResultSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: itemCategorySchema.catch('other'),
        quantity: z.coerce.number().positive().nullable().catch(null),
        unit: z.enum(['g', 'kg', 'ml', 'L', 'pcs']).nullable().catch(null),
        /*
         * The glyph, and it has to come from HERE rather than from a later
         * categorize call, because a successful parse is exactly what stops that
         * call happening: the client only upgrades an item whose category came
         * back 'other'. So a quick-added "salad mix" was classified correctly as
         * fruit_veg and, for that reason, never learned an emoji — it drew the
         * category's generic leaf while the same words typed straight into a list
         * got the salad bowl. The one route that always used AI was the only one
         * that never learned anything.
         *
         * Nullable and dropped if it is not in the allowlist, like everywhere
         * else: a bad glyph costs a generic icon, not the parse.
         */
        emoji: z.string().nullable().catch(null),
        /*
         * Whether this term may be SHARED, judged by the model in the same words
         * categorize uses. Not optional politeness: offerToLexicon refuses
         * anything that is not generic, so without this field nothing a quick-add
         * produced could ever publish — and quick-add is the route most likely to
         * carry a private phrasing, because it takes whatever the person said out
         * loud ("milk for gran's tea"). Defaults to false, so a model that omits
         * it keeps the term local rather than sharing it.
         */
        generic: z.boolean().catch(false),
      }),
    )
    .min(1)
    .max(30),
  language: z.string().min(2).max(12).catch('en'),
});

const SYSTEM_PROMPT = `You convert casual grocery utterances (any European language) into structured shopping list items.
Return ONLY a JSON object, no prose, no code fences: {"items": [{"name", "category", "quantity", "unit", "emoji", "generic"}], "language"}.
- name: singular, capitalized, in the user's language ("we're out of milk" -> "Milk").
- category: one of ${CATEGORIES.join(', ')}.
- quantity: a NUMBER when stated ("two" -> 2, "a dozen" -> 12); else null.
- unit: one of g, kg, ml, L, pcs. Map words: kilo/kilos/kilogram/kgs -> kg; gram/grams -> g; litre/liter/litres -> L; millilitre/ml -> ml; piece/pieces/count/dozen -> pcs. If no unit, null.
- emoji: the closest match for what the item IS, copied EXACTLY from this list and nothing else:
${EMOJI_ALLOWLIST.join(' ')}
  Pick by the food itself, not by its category. If nothing fits, null.
- generic is a boolean: true if this is an ordinary grocery product that any
  shopper in Europe might write on a list, in any language. false for anything
  personal, one-off, or not really a product — a person's name, a note to self, a
  specific shop or address, a medication brand, a gift description, gibberish.
  When in doubt, false.
- language: BCP 47 tag of the utterance.
Never invent items that were not mentioned.`;

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || text.length === 0 || text.length > 1000) {
    return Response.json({ error: 'Body must be {"text": string} (1-1000 chars)' }, { status: 400 });
  }

  // Sized for the schema's own ceiling, not picked loosely: the parser accepts
  // at most 30 items, and one item serialises to roughly 32 tokens with the
  // emoji field, so a full 30-item list plus JSON framing lands just under this.
  // Cutting it would truncate a legitimate long list into unparseable JSON — a
  // call paid for and wasted — which is why the answer to this endpoint being
  // expensive is the spend cap below rather than a smaller ceiling.
  const MAX_TOKENS = 1152;
  const guard = await reserveBudget(req, 'quick-add-parse', SYSTEM_PROMPT + text, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  // Settle before parsing: this endpoint reserves by far the largest worst case
  // of the three, and a validation failure below must not leave that standing.
  await guard.settle(message.usage);

  const rawText = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const jsonStr = extractJson(rawText);

  try {
    const parsed = quickAddResultSchema.parse(JSON.parse(jsonStr));

    /*
     * Offer each glyph to the shared dictionary, on the way out.
     *
     * Same gates as every other writer — the allowlist for the emoji, the
     * shareable-term shape for the name, and three independent callers before
     * anything publishes (migration 0019) — so a quick-add cannot push somebody's
     * private wording into a table every household reads.
     *
     * Fire-and-forget behind waitUntil, because the person waiting for their
     * list must not wait for a dictionary write. A failure here costs a generic
     * icon on one row, which is why nothing below is awaited or reported.
     */
    const offers = Promise.all(
      parsed.items
        .filter((i) => i.emoji != null)
        .map((i) =>
          offerToLexicon(
            {
              term: i.name,
              emoji: i.emoji as string,
              category: i.category,
              // The model's own judgement, passed through rather than assumed.
              // Hardcoding true here would hand the shared table every phrase
              // anyone ever spoke at the quick-add box.
              generic: i.generic,
              // quick-add-parse does not ask for a food group; the swap engine and
              // categorize do. Absent rather than guessed, and the lexicon fills a
              // null once some later answer knows it.
              group: null,
            },
            `ip:${clientIp(req)}`,
          ),
        ),
    ).then(() => {});
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(offers);
    else void offers;

    return Response.json(parsed);
  } catch (_err) {
    return Response.json({ error: 'Could not parse items from that input' }, { status: 422 });
  }
});
