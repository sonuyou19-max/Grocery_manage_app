// Supabase Edge Function: receipt-scan
// Reads a till receipt from one to four photographs and returns structured
// lines: what was printed, what it means, and what it cost.
//
// Deploy:  supabase functions deploy receipt-scan
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { z } from 'npm:zod@3.24.1';

import { clientIp, reserveBudget } from '../_shared/rate-limit.ts';
import { offerToLexicon } from '../_shared/lexicon.ts';
import {
  fingerprint,
  MONEY_CODES,
  reconcile,
  type ReceiptLine,
} from '../_shared/receipt-reconcile.ts';

/**
 * ---------------------------------------------------------------------------
 * One call, not a chain of agents
 * ---------------------------------------------------------------------------
 *
 * The obvious design is a pipeline — read, then expand the abbreviations, then
 * translate, then parse the numbers — with a call for each stage. It is worse
 * in two ways that matter.
 *
 * Context dies at every hop. `CAR EIREN X30` is only expandable because the
 * header says Carrefour and the receipt is in Dutch; a stage handed the bare
 * string has lost both and is guessing where the previous stage knew.
 *
 * And errors gain authority as they travel. A misread character becomes a
 * confident expansion, becomes a translation, becomes a match — four layers of
 * plausibility on one bad glyph, and nothing downstream can see the original.
 * A single pass that has the pixels while deciding all four can contradict
 * itself; a chain can only propagate.
 *
 * So the stages are FIELDS in one structured answer. Reasoning as schema.
 *
 * The one real seam is matching against the user's shopping list, and that is
 * deliberately not here: it depends on different data with a different
 * lifetime, it is text-only and cheap where this is vision and expensive, and
 * — the deciding reason — the reconciliation below gates it. There is no point
 * spending a matching call on numbers we already know were misread.
 *
 * ---------------------------------------------------------------------------
 * Why the model is told to transcribe rather than tidy
 * ---------------------------------------------------------------------------
 *
 * Two lines of `trs turmeric powder 100gr` on one receipt are two purchases;
 * the same line appearing in two overlapping photographs is one. The model
 * cannot always tell these apart, and neither can we — but the arithmetic can.
 * So it transcribes everything it sees exactly once per PRINTING, merges only
 * across photo overlaps, and the article count catches it if it gets that
 * wrong in either direction. Grouping duplicates into a single purchase happens
 * afterwards, in the client, where it is reversible.
 */

const LINE_KINDS = ['item', 'deposit', 'discount', 'rounding', 'other'] as const;
// Interpolated into the prompt below, so the aisles the model is offered and
// the aisles the parser accepts cannot drift apart.
const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
const UNITS = ['g', 'kg', 'ml', 'l', 'cl', 'pcs'] as const;

/**
 * Lenient on purpose, in one direction only.
 *
 * A malformed field becomes null and the line survives, because a line with a
 * total and no unit price is a real thing German tills print — but the TOTAL is
 * required, since a line without one is not a line, and letting it default to
 * zero would quietly break the reconciliation that the whole design rests on.
 */
const lineSchema = z.object({
  raw: z.string().min(1).max(200),
  kind: z.enum(LINE_KINDS).catch('item'),
  expanded: z.string().max(200).nullable().optional().default(null).catch(null),
  translated: z.string().max(200).nullable().optional().default(null).catch(null),
  brand: z.string().max(80).nullable().optional().default(null).catch(null),
  section: z.string().max(80).nullable().optional().default(null).catch(null),
  multiplier: z.coerce.number().finite().nullable().optional().default(null).catch(null),
  multiplierDp: z.coerce.number().int().min(0).max(4).nullable().optional().default(null).catch(null),
  unit: z.enum(UNITS).nullable().optional().default(null).catch(null),
  packSize: z.coerce.number().positive().nullable().optional().default(null).catch(null),
  packUnit: z.enum(UNITS).nullable().optional().default(null).catch(null),
  unitPriceCents: z.coerce.number().finite().nullable().optional().default(null).catch(null),
  unitPriceDp: z.coerce.number().int().min(0).max(4).nullable().optional().default(null).catch(null),
  totalCents: z.coerce.number().finite(),
  /**
   * The glyph and aisle for the product, so the shared dictionary learns
   * something the offline matcher can USE.
   *
   * Teaching it the expansion would be the obvious move and is not what helps:
   * the matcher compares resolved glyphs, not prose. `CAR EIREN X30` scoring
   * 🥚 is precisely what lets it meet a list item called "Eggs" next time,
   * with no call at all. Both nullable — a line the model cannot place should
   * teach nothing rather than teach a guess.
   */
  emoji: z.string().min(1).max(8).nullable().optional().default(null).catch(null),
  category: z.enum(CATEGORIES).nullable().optional().default(null).catch(null),
  /** The model's own doubt about the EXPANSION, which nothing else can check. */
  confidence: z.enum(['high', 'medium', 'low']).catch('medium'),
});

const receiptSchema = z.object({
  store: z.string().max(120).nullable().optional().default(null).catch(null),
  purchasedAt: z.string().max(40).nullable().optional().default(null).catch(null),
  currency: z.string().length(3).catch('EUR'),
  language: z.string().min(2).max(12).nullable().optional().default(null).catch(null),
  goodsCents: z.coerce.number().finite().nullable().optional().default(null).catch(null),
  paidCents: z.coerce.number().finite().nullable().optional().default(null).catch(null),
  articleCount: z.coerce.number().int().nullable().optional().default(null).catch(null),
  lines: z.array(lineSchema).min(1).max(120),
});

const SYSTEM_PROMPT = `You transcribe supermarket till receipts from photographs.

The images are sections of ONE receipt, in order, and they OVERLAP. A line
visible in two images is one printing and must appear once. A line genuinely
printed twice on the paper — the same product on two separate rows — must
appear twice. Do not tidy, merge or reorder anything else.

Return ONLY a JSON object of this exact shape:

{"store":"...","purchasedAt":"...","currency":"EUR","language":"nl",
 "goodsCents":6110,"paidCents":6110,"articleCount":23,
 "lines":[
  {"raw":"4 X 1L DLL VOLLE MELK","kind":"item","expanded":"volle melk",
   "brand":"Delhaize","multiplier":4,"multiplierDp":0,"packSize":1,
   "packUnit":"l","unitPriceCents":167,"unitPriceDp":2,"totalCents":668,
   "emoji":"🥛","category":"dairy_eggs","confidence":"high"},
  {"raw":"DRUIF ITALIA/VIT","kind":"item","expanded":"witte druiven",
   "translated":"white grapes","section":"GROENTEN&FRUIT",
   "multiplier":1.094,"multiplierDp":3,"unit":"kg",
   "unitPriceCents":499,"unitPriceDp":2,"totalCents":546,
   "emoji":"🍇","category":"fruit_veg","confidence":"high"}]}

Two lines, because they are the two shapes: one COUNTED in packs, one WEIGHED.
Between them they name every field you can use — and notice that neither writes
a single null. The first has no section and no unit; the second has no brand and
no pack size. Those keys are simply absent.

That example is a Dutch receipt for an English reader, which is why "translated"
appears on it. Read by a Dutch reader it would be absent from both lines.

WHAT EVERY FIELD MEANS. Read this before writing anything.

- raw: the line EXACTLY as printed, abbreviations and all. Never cleaned up.
  The person reviewing this recognises the till's own wording, not your
  English, so this is the field they check against.
- kind: "item" for something bought. "deposit" for Pfand, Leergut, statiegeld,
  leeggoed — a bottle deposit is NOT groceries, and a returned one is negative.
  "discount" for a Korting, Rabatt, coupon or multibuy reduction. "rounding"
  for a cash-rounding adjustment of a few cents. "other" for anything else.
  ANY line whose total is negative is a discount or a deposit return, never an
  item.
- expanded: the same product with abbreviations opened out, in the receipt's OWN
  language, WITHOUT the brand and without the pack size. "CAR EIREN X30" ->
  "eieren". "DOUWE EGBERTS oplosk. dessert glas 200g" -> "oploskoffie". The
  brand has its own field and the size has two of its own; repeating them here
  puts them into the product's identity, and "milk" then stops being the same
  item as "Alpro milk 1L".
  This is also where you FIX what the camera got wrong. Till printing is small
  and receipts crease, so the raw line will contain scanning slips — DOUNE for
  DOUWE, opiosk for oplosk., rn for m. You know what real products are called;
  the raw field keeps the mistake for the reader to check against, and this
  field is the corrected reading. Correct only what you are confident about: a
  well-known brand or a common product word, never a number.
  If you cannot tell what the product is, leave it null rather than inventing
  one — a wrong expansion cannot be detected by any check here.
- translated: expanded, rendered in the target language given in the request.
- brand: the manufacturer, where the line names one, spelled correctly rather
  than as the camera read it — "DOUNE EGBERTS" is Douwe Egberts. Own-brand
  counts (BONI, EVERYDAY, CAR). Null for loose produce.
- section: the printed aisle heading this line sits under, if the receipt has
  them ("Obst&Gemüse", "SB - Fleisch", "GEWICHTSARTIKELEN"). Null otherwise.
- multiplier: how many, or how much. The number the line total is the unit price
  TIMES. A count of packs, or a weight. Never both.
- multiplierDp: decimal places the multiplier was PRINTED to. "0,49" is 2 even
  when the true weight had three. This is how the checks know how much rounding
  to forgive, so report what is on the paper, not what you think it means.
- unit: the multiplier's unit when it is a weight or volume — kg, g, l, ml, cl.
  Null when the multiplier is a count of packs.
- packSize / packUnit: the size of ONE pack, from the product name. "1L" -> 1
  and "l". "450G" -> 450 and "g". "X30" or "12st" -> 30 or 12 and "pcs".
  "15x10g" means fifteen pieces of ten grams, so 150 and "g". If the line is
  weighed, leave both null: the measured weight is the multiplier, and a
  nominal "±1kg" in the name is not the amount bought.
- unitPriceCents: price per pack, or per kg, in whole cents. 1,67 -> 167. Null
  when the receipt prints only a line total, which some tills do.
- unitPriceDp: decimal places it was printed to. Colruyt prints 0,523 — that is
  3, and reporting 2 would make the line fail a check it should pass.
- totalCents: the line's own money as printed, in whole cents. Negative for
  discounts and deposit returns. This field is required on every line.
- store: the shop's name from the header, as printed. "Carrefour Market
  Heverlee", "ALDI SÜD", "EVEREST BVBA". Not the street, not the company number.
- purchasedAt: the date and time PRINTED on the receipt, as ISO 8601. Not today.
  This is what decides which of the shopper's purchases the receipt amends, so a
  receipt scanned the next morning still lands on yesterday's shop.
  A receipt cannot be dated in the future, and today's date is given to you in
  the request. If what you read comes out later than today, you have misread a
  digit — 2026 scanned as 2028 is the common one — so look again. If it is still
  unreadable, answer null; a missing date is handled, a wrong one is not.
- currency: the ISO code the receipt is denominated in, "EUR" for these.
- language: the language the receipt is PRINTED in, as a two-letter code. Not
  the target language, and not the country's main language — a Leuven receipt
  can be in French. This is what tells the reader which expansions to trust.
- goodsCents: the printed subtotal for goods, before discounts and deposits.
  READ IT OFF THE PAPER. Never add up your own lines to produce it. It is the
  one number here that can contradict you, and that is its entire job — a
  subtotal derived from your own answer agrees with your own answer no matter
  how wrong the answer is.
- paidCents: the amount actually paid, also READ OFF THE PAPER and never
  computed. Where payment is split across two tenders, this is their sum, or
  the printed "total paid".
- articleCount: the printed count of articles, if there is one. Do not compute
  it yourself — report only what is printed, or null.
- emoji: one emoji for the product, from the app's own set. Null if unsure.
- category: the aisle, one of: ${CATEGORIES.join(', ')}. Use the printed section
  heading when the receipt has one — "Tiernahrung" is household, whatever the
  abbreviated product name looks like. Null if unsure.
- confidence: your own doubt about the EXPANSION, not about the numbers.

HOW TO KEEP THE ANSWER SHORT. A long receipt is a long answer, and the
shopper is standing there waiting for it. Two rules, neither of which loses
anything:

- OMIT any field you would answer null. Do not write "unit":null — leave the
  key out. Most lines have no brand, no section, no unit and no unit price, so
  this removes about a third of what you would otherwise type.
- Omit "translated" when the receipt is ALREADY in the reader's language. It
  would be the same string as "expanded" twice, and the reader falls back to
  the expansion on its own.

RULES.
- READ ACROSS EACH ROW, NEVER DOWN THE COLUMNS. A till prints the description on
  the left and the amount on the right, often with a wide empty gap between
  them. Take one row at a time and carry its name and its amount together
  before moving to the next. Reading the names down one side and then the
  prices down the other is how a single missed row silently shifts every
  remaining price onto the wrong product — the receipt still adds up, every
  amount is real, and each one is against the wrong thing.
  If a row's amount is far from its name, follow the row, not the nearest
  number.
- BEFORE YOU ANSWER, ADD UP THE LINES YOU HAVE WRITTEN AND COMPARE THE SUM WITH
  THE PRINTED TOTAL. They must agree. If they do not, you have misread a line —
  go back and find which, while you can still see the receipt. Do not adjust the
  printed total to fit your lines: the paper is right and you are not.
- Numbers use a decimal comma in these countries. 1,67 is one euro sixty-seven,
  and 1.234,56 is a thousand two hundred and thirty four euros.
- Dates are day-month-year, ALWAYS, on every receipt here. 08-05-2026 is the
  eighth of May. 12/08/26 is the twelfth of August 2026 — not the eighth of
  December, and not June. The middle number is the month.
- Every line's multiplier times its unit price must equal its total. If they do
  not, you have read one of the three wrongly — look again before answering.
- Points balances, loyalty totals, VAT breakdowns, card numbers and anything
  printed AFTER the total are not lines. Do not include them.
- Never invent a line, a price or a total. A field you cannot read is null.`;

const MODEL_FAST = 'claude-haiku-4-5-20251001';
/**
 * The escalation, and the only place a second model earns its keep.
 *
 * Not as a checker — a model checking a model is strictly worse than
 * arithmetic that cannot be talked round. As a RETRY: read cheaply, and if the
 * receipt's own totals say the read was wrong, read again with something
 * stronger. That costs nothing on the receipts that reconcile first time, and
 * it turns "which model" from a guess into a measurement.
 */
const MODEL_CAREFUL = 'claude-sonnet-5';

/** Roughly 1.6k tokens per image, plus the prompt, plus a long receipt's JSON. */
const MAX_TOKENS = 8192;
/** Four sections is a very long receipt; beyond that the photos are the problem. */
const MAX_IMAGES = 4;
/** ~1.4MB of base64 per image, so four fit comfortably inside the body limit. */
const MAX_IMAGE_CHARS = 1_900_000;

const MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const;

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

  const body = await req.json().catch(() => ({}));
  const images = Array.isArray(body?.images) ? body.images : null;
  const language = typeof body?.language === 'string' ? body.language.slice(0, 12) : 'en';

  if (!images || images.length === 0 || images.length > MAX_IMAGES) {
    return Response.json(
      { error: `Body must be {"images": [{media, data}], "language"} with 1-${MAX_IMAGES} images` },
      { status: 400 },
    );
  }

  const content: Anthropic.ImageBlockParam[] = [];
  for (const img of images) {
    const media = typeof img?.media === 'string' ? img.media : '';
    const data = typeof img?.data === 'string' ? img.data : '';
    // Checked here rather than trusted: this endpoint is the most expensive in
    // the app, and an unbounded base64 string is the cheapest way to spend
    // somebody else's budget.
    if (!(MEDIA as readonly string[]).includes(media) || !data || data.length > MAX_IMAGE_CHARS) {
      return Response.json({ error: 'Each image must be a JPEG, PNG or WebP under 1.4MB' }, { status: 400 });
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: media as typeof MEDIA[number], data } });
  }

  /*
   * The reservation counts the images, because they are most of the cost.
   * reserveBudget estimates from the text it is given, and a prompt-only
   * estimate would under-reserve by roughly an order of magnitude here — the
   * one endpoint where that matters.
   */
  const estimate = SYSTEM_PROMPT + 'x'.repeat(images.length * 6_400);
  const guard = await reserveBudget(req, 'receipt-scan', estimate, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const ask = async (model: string) => {
    const message = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...content,
            { type: 'text', text: `Target language for "translated": ${language}` },
            /*
             * The model has no clock, so without this it cannot tell a receipt
             * dated in the future from one it misread — and it does misread
             * them: a Colruyt receipt printed 30/07/2026 came back as 2028,
             * twice. purchaseInstant catches an impossible date on the device
             * and falls back to now, but catching it HERE means the right date
             * lands rather than a substituted one.
             *
             * Server time, not the device's: it is the one clock in this
             * exchange that a wrong phone setting cannot move.
             */
            {
              type: 'text',
              text: `Today is ${new Date().toISOString().slice(0, 10)}. A receipt cannot be dated after this.`,
            },
          ],
        },
      ],
    });
    await guard.settle(message.usage);
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    return receiptSchema.parse(JSON.parse(extractJson(raw)));
  };

  const check = (parsed: z.infer<typeof receiptSchema>) => {
    const lines: ReceiptLine[] = parsed.lines.map((l) => ({
      raw: l.raw,
      kind: l.kind,
      multiplier: l.multiplier,
      // The extractor reports the unit; the classification itself lives in
      // _shared so the reviewer and the checks cannot disagree with it.
      multiplierKind: l.unit ? 'measure' : Number.isInteger(l.multiplier ?? 1) ? 'count' : 'measure',
      multiplierDp: l.multiplierDp,
      unitPriceCents: l.unitPriceCents,
      unitPriceDp: l.unitPriceDp,
      totalCents: l.totalCents,
    }));
    return reconcile(lines, {
      goodsCents: parsed.goodsCents,
      paidCents: parsed.paidCents,
      articleCount: parsed.articleCount,
    });
  };

  let parsed: z.infer<typeof receiptSchema>;
  let result;
  let model = MODEL_FAST;
  const started = Date.now();
  let readMs = 0;
  let retryMs = 0;

  try {
    parsed = await ask(MODEL_FAST);
    result = check(parsed);
  } catch (_err) {
    return Response.json({ error: 'Could not read that receipt' }, { status: 422 });
  }
  readMs = Date.now() - started;

  /*
   * ---------------------------------------------------------------------------
   * When a second reading is worth the wait
   * ---------------------------------------------------------------------------
   *
   * This used to retry on ANY failed check, and the retry is a whole second
   * vision call on a slower model — the single largest thing a shopper waits
   * for. A seventeen-line Delhaize receipt took over two minutes, and most of
   * that was reading it twice.
   *
   * The COUNT check does not justify that. It already accepts two different
   * conventions because the chains do not agree with each other, so a receipt
   * that satisfies neither is usually a THIRD convention nobody has catalogued
   * — not a misread digit. Re-reading the pixels cannot fix a counting rule.
   *
   * The money checks are the opposite: a line that does not multiply out, or a
   * total that does not add up, IS evidence that a number was read wrong, and a
   * number read wrong is exactly what a better look at the image fixes.
   *
   * So the retry is gated on money. A count-only disagreement still reaches the
   * review sheet as a warning — the shopper is told, and decides — it just does
   * not cost them a second call first.
   */
  const worthRetrying = result.details.some((d) => MONEY_CODES.includes(d.code));

  if (!result.ok && worthRetrying) {
    /*
     * One retry, never a loop. A receipt that will not reconcile twice is
     * usually a bad photograph rather than a weak model, and the user is
     * waiting — a third attempt spends their money to tell them the same thing
     * a second time. The client shows what did not add up and lets them import
     * anyway.
     */
    const retryAt = Date.now();
    try {
      const careful = await ask(MODEL_CAREFUL);
      const better = check(careful);
      if (better.ok || better.problems.length < result.problems.length) {
        parsed = careful;
        result = better;
        model = MODEL_CAREFUL;
      }
    } catch (_err) {
      // Keep the first answer. A failed retry is not worse than no retry.
    }
    retryMs = Date.now() - retryAt;
  }

  /*
   * Logged, not guessed at. "The scan took two minutes" is a report nobody can
   * act on without knowing which half of it was slow, and this is the only
   * place that knows. It goes to the function log rather than the response
   * because it is a fact about the server, and a shopper has no use for it.
   */
  console.log(
    JSON.stringify({
      at: 'receipt-scan',
      images: images.length,
      lines: parsed.lines.length,
      model,
      readMs,
      retryMs,
      ok: result.ok,
      codes: result.details.map((d) => d.code),
      // In prose, because a log is read by one person in one language.
      problems: result.problems,
    }),
  );

  /*
   * Teach the shared dictionary what the till calls things.
   *
   * This is the part that compounds. `CAR EIREN` means nothing to the offline
   * matcher today, so it costs an AI call every time somebody scans a Carrefour
   * receipt. Published once — after three unrelated households have seen it,
   * per migration 0019 — it is free and offline for everyone thereafter.
   *
   * Only high-confidence expansions, and only where the model believed the term
   * was generic enough to share. Nothing here is awaited: the shopper waiting
   * on their receipt must not wait on a dictionary write.
   */
  const offers = Promise.all(
    parsed.lines
      .filter((l) => l.kind === 'item' && l.confidence === 'high' && l.emoji)
      .map((l) =>
        offerToLexicon(
          {
            /*
             * The RAW printed line is the term, not the expansion.
             *
             * The point is to teach the offline matcher the till's own wording,
             * which is the string it will meet again on the next Carrefour
             * receipt. Filing it under the expanded English would teach it a
             * phrase no receipt ever prints.
             */
            term: l.raw,
            emoji: l.emoji as string,
            category: l.category,
            // The model's own judgement, passed through. Hardcoding true would
            // hand the shared table every oddity on every independent's till.
            generic: l.confidence === 'high',
            unit: null,
            carbon: null,
            group: null,
          },
          `ip:${clientIp(req)}`,
        ).catch(() => {}),
      ),
  ).then(() => {});
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(offers);
  else void offers;

  return Response.json({
    ...parsed,
    /*
     * Computed here rather than on the device, so there is one implementation.
     * A client mirror would be a second thing to keep in step, and the one
     * thing this value must never do is differ between two scans of the same
     * paper — which is exactly what a drifting copy would cause, on the
     * re-scan it exists to catch.
     */
    fingerprint: fingerprint(parsed.store, result.paidCents, parsed.purchasedAt),
    model,
    reconciled: result.ok,
    problems: result.details,
    badLines: result.badLines,
    goodsCents: parsed.goodsCents ?? result.goodsCents,
    depositCents: result.depositCents,
    discountCents: result.discountCents,
    paidCents: result.paidCents,
  });
});
