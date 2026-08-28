// Supabase Edge Function: receipt-match
// Decides which row of a shopper's list each leftover receipt line is.
//
// Deploy:  supabase functions deploy receipt-match
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { z } from 'npm:zod@3.24.1';

import { reserveBudget } from '../_shared/rate-limit.ts';

/**
 * ---------------------------------------------------------------------------
 * Why this is not part of receipt-scan
 * ---------------------------------------------------------------------------
 *
 * It asks a different question of different data. receipt-scan reads a photo
 * and answers about the RECEIPT — true for anyone, cacheable, worth teaching to
 * the shared lexicon. This answers about one household's list, is disposable
 * the moment they edit it, and costs a fraction as much because it never sees
 * an image.
 *
 * The deciding reason is the gate between them. receipt-scan reconciles its own
 * output against the totals the receipt prints about itself, and a parse that
 * failed that check should not have a matching call spent on it. Two functions
 * make "do not pay for this one" the default rather than a flag.
 *
 * ---------------------------------------------------------------------------
 * A closed set, enforced rather than requested
 * ---------------------------------------------------------------------------
 *
 * The model is given ids and told to answer only with those ids. It will
 * occasionally answer with something else — a plausible-looking id, a name
 * instead of an id, the same id twice. So every answer is checked against the
 * set that was sent, here AND again on the device, and anything outside it is
 * dropped rather than corrected.
 *
 * Dropped, not corrected, because the failure mode of guessing is silent: a
 * price landing on the wrong row of somebody's list looks exactly like a price
 * landing on the right one, and it poisons every comparison that row is part of
 * from then on. An unmatched line is visible in the review; a mismatched one is
 * not.
 */

const answerSchema = z.object({
  matches: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        itemId: z.string().max(80).nullable().catch(null),
        confidence: z.enum(['high', 'medium', 'low']).catch('low'),
      }),
    )
    .max(120),
});

const requestSchema = z.object({
  language: z.string().min(2).max(12).catch('en'),
  lines: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        raw: z.string().min(1).max(200),
        expanded: z.string().max(200).nullable().default(null),
        translated: z.string().max(200).nullable().default(null),
        brand: z.string().max(80).nullable().default(null),
        section: z.string().max(80).nullable().default(null),
      }),
    )
    .min(1)
    .max(60),
  candidates: z
    .array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120) }))
    .min(1)
    .max(120),
});

const SYSTEM_PROMPT = `You match supermarket receipt lines to items on a shopping list.

Return ONLY a JSON object of this exact shape:

{"matches":[{"key":"...","itemId":"...","confidence":"high"}]}

WHAT EVERY FIELD MEANS.

- key: the key of the receipt line you are answering about, copied exactly from
  the input. One entry per line, and never a key that was not given to you.
- itemId: the id of the shopping-list item this line is, copied exactly from the
  candidates. It MUST be one of the ids given. If the line is not any of them,
  answer null — that is a correct answer, not a failure.
- confidence: how sure you are.

WHAT EACH RECEIPT LINE GIVES YOU.

- raw: the line exactly as the till printed it, abbreviated and often truncated.
- expanded: the same product written out, in the receipt's own language.
- translated: the same product in the reader's language.
- brand: the manufacturer, where the line names one.
- section: the printed aisle heading the line sat under, where the receipt has
  them. A line under "Tiernahrung" is pet food whatever its name looks like.

RULES.
- Each list item can be matched by AT MOST ONE receipt line. Two lines that
  both look like the same item are two separate purchases; match the better
  one and answer null for the other.
- A brand is not the product. "ALPRO kokosnootdrink" is a coconut drink that
  happens to be Alpro, and it matches a list item called "coconut milk". "BONI"
  and "EVERYDAY" are shop own-brands and say nothing about what the thing is.
- A pack size is not the product either. "450G", "X30", "1L" describe how much,
  not what.
- AN ADJECTIVE IS NOT THE PRODUCT. Colour, size, cut and flavour words qualify
  the noun; they do not name it. "Red vinegar" and "red onion" share the only
  word they have in common and are not the same thing. Before matching, ask
  what the NOUN is on each side and require those to agree: vinegar to vinegar,
  onion to onion. If the nouns do not agree, answer null however much of the
  rest of the line looks familiar.
- The same goes for a shared category. Two things from the same aisle are not
  each other. "Yoghurt" does not match a list item called "milk" merely because
  both are dairy.
- Answer null rather than guessing. An unmatched line is shown to the shopper
  and corrected in a second; a line matched to the wrong item quietly puts a
  price on the wrong product and is never noticed.
- confidence is "high" only when the nouns agree and you would defend the match
  out loud. Use "low" when you are matching on a resemblance you cannot name —
  and prefer null to a low-confidence guess, because the device may refuse it
  anyway and a refusal it has to make is a round trip nobody needed.`;

const MAX_TOKENS = 2048;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  const parsedReq = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedReq.success) {
    return Response.json(
      { error: 'Body must be {"lines": [...], "candidates": [...], "language"}' },
      { status: 400 },
    );
  }
  const { lines, candidates, language } = parsedReq.data;

  const payload = JSON.stringify({ language, lines, candidates });
  const guard = await reserveBudget(req, 'receipt-match', SYSTEM_PROMPT + payload, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  let answer: z.infer<typeof answerSchema>;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: payload }],
    });
    await guard.settle(message.usage);
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    answer = answerSchema.parse(JSON.parse(extractJson(raw)));
  } catch (_err) {
    /*
     * An empty answer, not an error. Every line stays unmatched, the review
     * sheet shows them as new items, and the shopper corrects the two that
     * matter — which is a worse afternoon than a working matcher and a much
     * better one than a failed import.
     */
    return Response.json({ matches: [] });
  }

  /*
   * The closed set, enforced. Anything the model invented is dropped, and so is
   * a second claim on an id it already used — the same one-claim rule the
   * offline rungs follow, applied here because the model cannot be relied on to
   * follow a rule it was merely told.
   */
  const known = new Set(candidates.map((c) => c.id));
  const keys = new Set(lines.map((l) => l.key));
  const claimed = new Set<string>();

  const matches = answer.matches.filter((m) => {
    if (!keys.has(m.key)) return false;
    if (m.itemId == null) return true;
    if (!known.has(m.itemId)) return false;
    if (claimed.has(m.itemId)) return false;
    claimed.add(m.itemId);
    return true;
  });

  return Response.json({ matches });
});
