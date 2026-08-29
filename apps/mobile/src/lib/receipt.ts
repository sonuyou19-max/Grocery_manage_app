import type { ItemCategory } from '@korb/shared';

import { canonicalize, emojiFor, fold, CATEGORY_EMOJI } from '@/lib/item-emoji';
import { samePlural } from '@/lib/item-plural';
import { normalizeKey } from '@/lib/pantry-intel';
import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

/**
 * What a scanned receipt turns into, before anybody looks at it.
 *
 * Two jobs live here, and they are separate on purpose:
 *
 *   GROUPING  turns printed LINES into purchases. A till prints what it prints
 *             — Aldi lists two avocados as two rows, Carrefour prints one row
 *             saying ×2 — and the same shopping must reach the pantry the same
 *             way whichever shop it came from.
 *
 *   MATCHING  decides which purchase is which row of the user's list. Free
 *             where it can be, and honest about the rest: a residue goes to a
 *             model, and the residue shrinks on its own as the shared lexicon
 *             learns what tills call things.
 *
 * Both are pure functions over data, tested directly in check-receipt-match.
 * The network call at the bottom is the only part that is not.
 */

/* -------------------------------------------------------------- the wire -- */

export type LineKind = 'item' | 'deposit' | 'discount' | 'rounding' | 'other';

/** One printed line, as receipt-scan returns it. */
export interface ScannedLine {
  raw: string;
  kind: LineKind;
  /** What it IS, list-sized. See productName. */
  product: string | null;
  expanded: string | null;
  translated: string | null;
  brand: string | null;
  section: string | null;
  multiplier: number | null;
  multiplierDp: number | null;
  unit: string | null;
  packSize: number | null;
  packUnit: string | null;
  unitPriceCents: number | null;
  unitPriceDp: number | null;
  totalCents: number;
  emoji: string | null;
  category: ItemCategory | null;
  confidence: 'high' | 'medium' | 'low';
}

/** A failed reconciliation check, for the review sheet to phrase itself. */
export type ReceiptProblem =
  | { code: 'line'; lines: number }
  | { code: 'goods'; got: number; printed: number }
  | { code: 'paid'; got: number; printed: number }
  | { code: 'count'; units: number; asLines: number; printed: number };

export interface ScannedReceipt {
  store: string | null;
  purchasedAt: string | null;
  /**
   * Whether this PAPER writes decimals with a comma, or null when nothing
   * printed settled it.
   *
   * The receipt's convention, not the reader's — see the note in the extractor.
   * Null falls back to the device's country, which is a guess but the only one
   * available.
   */
  decimalComma: boolean | null;
  currency: string;
  language: string | null;
  fingerprint: string;
  model: string;
  /** Did the parse agree with the totals the receipt prints about itself? */
  reconciled: boolean;
  /**
   * What failed, with its numbers — NOT a sentence.
   *
   * The server used to send prose: "items add up to 4827 but the receipt says
   * 5020". That put raw cent integers in front of somebody holding a receipt
   * that says €48.27, in English, on a phone that might be running in any of
   * seven languages. Both of those are the device's business, not a server's —
   * it is the only side that knows the reader's locale and has a `money()` that
   * respects it.
   */
  problems: ReceiptProblem[];
  badLines: number[];
  goodsCents: number;
  depositCents: number;
  discountCents: number;
  paidCents: number;
  articleCount: number | null;
  lines: ScannedLine[];
}

/* ------------------------------------------------------------- grouping -- */

/** One thing bought, however many lines the till spent printing it. */
export interface ReceiptPurchase {
  /** Stable within one scan, for React keys and the match map. */
  key: string;
  /** Every printed line this came from. Shown in the review, always. */
  raw: string[];
  name: string;
  product: string | null;
  expanded: string | null;
  translated: string | null;
  brand: string | null;
  section: string | null;
  packs: number;
  quantity: number | null;
  unit: string | null;
  /** Summed across the grouped lines. What was actually paid for them. */
  priceCents: number;
  emoji: string | null;
  category: ItemCategory | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * The name to put in front of a person.
 *
 * ---------------------------------------------------------------------------
 * Why `name` is the LAST choice
 * ---------------------------------------------------------------------------
 *
 * The extractor returns three renderings of every line and this app was showing
 * the wrong one. `name` is the product "as printed, with the till's
 * abbreviations left alone" — so the review sheet read
 *
 *     DOUNE EGBERTS opiosk, dessert glas 200g
 *     DOUNE EGBERTS OPIOSK, DESSERT GLAS 200G
 *
 * which is the same garbled string twice: once pretending to be a product name,
 * once as the printed evidence underneath it. The expansion was requested, paid
 * for, and then never read by anything except the AI matcher.
 *
 * So: the reader's own language first, the receipt's language next, and the
 * till's abbreviations only when the model could not do better. The raw line
 * still appears underneath — it is the evidence, and its whole job is to look
 * exactly like the paper.
 */
export function displayName(p: Pick<ReceiptPurchase, 'name' | 'expanded' | 'translated'>): string {
  const best = p.translated?.trim() || p.expanded?.trim() || p.name.trim();
  return best || p.name;
}

/**
 * What the thing IS, short enough to live in a pantry.
 *
 * ---------------------------------------------------------------------------
 * Why this is not displayName
 * ---------------------------------------------------------------------------
 *
 * displayName answers "what did I buy" and wants to be complete. This answers
 * "what is it" and wants to be short, and the two are genuinely different
 * questions — which the app learned by putting the first answer where the
 * second belonged. Unmatched receipt lines became pantry entries called
 *
 *     Provital toast 50 pieces
 *     1 litre Delhaize full fat milk
 *     Pink Lady apple 6 pieces
 *
 * Those are not things anybody buys again. `toast`, `milk` and `apples` are —
 * and they are what the burn-rate model needs, because next month's receipt
 * will print a different size from a different brand and has to land on the
 * same item.
 *
 * The brand, the size and the count are not lost. They ride on the purchase,
 * where they can be compared across brands precisely BECAUSE they are not part
 * of the name.
 *
 * Falls back to the full description when the model could not reduce it, which
 * is better than an empty pantry row — and the shopper can rename it.
 */
export function productName(
  p: Pick<ReceiptPurchase, 'name' | 'product' | 'expanded' | 'translated'>,
): string {
  return p.product?.trim() || displayName(p);
}

const isMeasure = (l: ScannedLine): boolean =>
  l.unit != null || (l.multiplier != null && !Number.isInteger(l.multiplier));

/**
 * Printed lines → purchases.
 *
 * ---------------------------------------------------------------------------
 * Why grouping happens HERE and not in the extractor
 * ---------------------------------------------------------------------------
 *
 * The model is told to transcribe every printing exactly once, and to merge
 * only what two overlapping photographs show twice. That is deliberate: two
 * `trs turmeric powder 100gr` lines on one receipt are two real purchases, and
 * the same line seen in two photos is one — and the article count can only
 * check the transcription if the transcription is literal.
 *
 * So merging happens after the arithmetic has passed, where it is reversible
 * and where being wrong costs a row in a review sheet rather than a failed
 * reconciliation nobody can explain.
 *
 * ---------------------------------------------------------------------------
 * Grouped on the RAW line, exactly
 * ---------------------------------------------------------------------------
 *
 * Not on the expansion, and not on any of the fuzzy keys used for matching. A
 * till prints one string per product, so exact equality is precisely right
 * here.
 *
 * The keys used for matching are lossy in exactly the way that would be wrong.
 * canonicalize strips store-tier words — basic, extra, premium — because for
 * MATCHING they are noise between a receipt line and a shopping list. For
 * GROUPING they are the whole difference: `EVERYDAY melk basic` and `EVERYDAY
 * melk extra` are two products at two prices, and merging them would invent a
 * unit price neither was sold at. Same for samePlural, which exists to collapse
 * a distinction the till never makes within one receipt.
 */
export function groupLines(lines: ScannedLine[]): ReceiptPurchase[] {
  const byKey = new Map<string, ReceiptPurchase>();
  const order: string[] = [];

  lines.forEach((line, i) => {
    // Deposits, discounts and rounding are money, not shopping. They belong to
    // the receipt row, never to the pantry.
    if (line.kind !== 'item') return;

    const measure = isMeasure(line);
    /*
     * The kind is part of the key, so a weighed line and a counted one never
     * merge even if a till somehow printed them identically. Summing a weight
     * into a pack count would produce a purchase of "1.9 packs".
     */
    const key = `${normalizeKey(line.raw)}|${measure ? 'm' : 'c'}`;
    const existing = byKey.get(key);

    if (!existing) {
      order.push(key);
      byKey.set(key, {
        key: `${key}#${i}`,
        raw: [line.raw],
        // The printing IS the name. The extractor used to return a separate
        // `name` field defined as "the product as printed", which is what `raw`
        // already is — a whole duplicated string per line, on a receipt where
        // every output token is time the shopper spends waiting.
        name: line.raw,
        product: line.product,
        expanded: line.expanded,
        translated: line.translated,
        brand: line.brand,
        section: line.section,
        packs: measure ? 1 : Math.max(1, Math.round(line.multiplier ?? 1)),
        quantity: measure ? line.multiplier : line.packSize,
        unit: measure ? line.unit : line.packUnit,
        priceCents: line.totalCents,
        emoji: line.emoji,
        category: line.category,
        confidence: line.confidence,
      });
      return;
    }

    existing.raw.push(line.raw);
    existing.priceCents += line.totalCents;
    if (measure) {
      // Two weighed rows of the same thing are one heavier purchase.
      existing.quantity = (existing.quantity ?? 0) + (line.multiplier ?? 0);
    } else {
      existing.packs += Math.max(1, Math.round(line.multiplier ?? 1));
    }
    // The least certain line decides: a purchase is only as trustworthy as the
    // worst row it was assembled from.
    if (line.confidence === 'low') existing.confidence = 'low';
    else if (line.confidence === 'medium' && existing.confidence === 'high') {
      existing.confidence = 'medium';
    }
  });

  return order.map((k) => byKey.get(k)!);
}

/* ------------------------------------------------------------- matching -- */

export interface ListCandidate {
  id: string;
  name: string;
  category: ItemCategory;
}

export type MatchOutcome =
  | { kind: 'matched'; itemId: string; how: string }
  /** More than one list row is equally plausible. A question, not an answer. */
  | { kind: 'ambiguous'; itemIds: string[] }
  | { kind: 'unmatched' };

/** Resolved glyph, or null when the name only reached its category fallback. */
function glyph(name: string, category: ItemCategory = 'other'): string | null {
  const e = emojiFor(name, category);
  return e === CATEGORY_EMOJI[category] ? null : e;
}

/**
 * The purchase's glyph: the extractor's, else resolved from its own names.
 *
 * Shared by the matching rung below and the veto further down, so the two
 * cannot end up with different ideas of what a line looks like — a veto reading
 * a different glyph from the rung it polices would refuse matches for reasons
 * the rung could never have had.
 */
function purchaseGlyph(p: ReceiptPurchase): string | null {
  return (
    p.emoji ??
    [p.name, p.expanded, p.translated]
      .filter((n): n is string => !!n)
      .map((n) => glyph(n, p.category ?? 'other'))
      .find((x): x is string => x != null) ??
    null
  );
}

/**
 * Is this match refuted by what we already know about both sides?
 *
 * ---------------------------------------------------------------------------
 * Why the model needs a second opinion at all
 * ---------------------------------------------------------------------------
 *
 * A real Delhaize scan matched `RODE AZIJN 750G` — red vinegar — to a list row
 * called `red onion`. Both are red; nothing else about them agrees. The prompt
 * warns the model off brands and off pack sizes and tells it to answer null
 * rather than guess, and it guessed anyway, because a shared adjective looks
 * like evidence when you are reading one line at a time.
 *
 * That failure is invisible after the fact. €1.89 lands on the onions, the
 * vinegar is never recorded, and the price history that feeds every comparison
 * in the app is quietly wrong about both — for as long as the history is kept.
 *
 * ---------------------------------------------------------------------------
 * Two signals, either of which may refuse
 * ---------------------------------------------------------------------------
 *
 * GLYPH. The curated table resolved 🧴 for the vinegar and 🧅 for the onion. It
 * does not know what a thing IS, but two confident and different glyphs is the
 * table saying these are not the same concept.
 *
 * CATEGORY. Shampoo is personal care and apples are fruit. The aisles disagree
 * even where the glyphs are silent — `toilet paper` resolves to the household
 * fallback, so it has no glyph of its own to compare.
 *
 * Either one is enough. They fail in different places, which is the point of
 * having both.
 *
 * ---------------------------------------------------------------------------
 * Why it cannot refuse the ordinary case
 * ---------------------------------------------------------------------------
 *
 * `glyph` returns null when a name only reaches its category's own fallback,
 * and that single rule is what keeps this quiet on the matches the feature
 * exists to make. 🍞 IS the bakery fallback, so a list row called `bread` has no
 * confident glyph and `baguette` 🥖 is free to match it. Same for `chicken`
 * against `chicken breast`, and `fish` against `smoked salmon`.
 *
 * This never PROPOSES a match. It only refuses one, and the asymmetry is the
 * whole argument: a refused match is a row in the review sheet somebody fixes
 * with one tap, and an accepted wrong one is a number nobody will ever question.
 */
export function refutes(p: ReceiptPurchase, candidate: ListCandidate): string | null {
  const pg = purchaseGlyph(p);
  const cg = glyph(candidate.name, candidate.category);
  if (pg && cg && pg !== cg) return `glyph ${pg}≠${cg}`;

  /*
   * 'other' is not an aisle, it is the absence of one — the value every item
   * carries before anything has categorised it. Treating it as a disagreement
   * would refuse most matches on most lists.
   */
  const pc = p.category;
  const cc = candidate.category;
  if (pc && pc !== 'other' && cc !== 'other' && pc !== cc) return `category ${pc}≠${cc}`;

  return null;
}

/** The three readings of a line, widest first. */
const namesOf = (p: ReceiptPurchase): string[] =>
  [p.name, p.expanded, p.translated].filter((n): n is string => !!n);

/**
 * The free rows the FIRST of a line's readings can reach.
 *
 * Name order is priority, not a union: the till's own wording is tried against
 * every row before the expansion is tried against any, and the expansion before
 * the translation. Unioning them would let a translation's match compete with a
 * raw-line match as though the two were equally good evidence, when the whole
 * reason for keeping three readings is that they are not.
 *
 * Within ONE reading, everything it reaches comes back — including more than
 * one row, which is what lets the caller refuse instead of guessing.
 */
function reachedByName(
  p: ReceiptPurchase,
  free: readonly ListCandidate[],
  test: (name: string, candidate: ListCandidate) => boolean,
): ListCandidate[] {
  for (const n of namesOf(p)) {
    const hit = free.filter((l) => test(n, l));
    if (hit.length > 0) return hit;
  }
  return [];
}

/** One rung of the ladder: how strong the evidence is, and what it reaches. */
interface Rung {
  how: (p: ReceiptPurchase) => string;
  reach: (p: ReceiptPurchase, free: readonly ListCandidate[]) => ListCandidate[];
}

/**
 * The rungs, strongest evidence first. Order in this array IS the priority.
 */
const RUNGS: readonly Rung[] = [
  {
    how: () => 'exact',
    reach: (p, free) => reachedByName(p, free, (n, l) => normalizeKey(n) === normalizeKey(l.name)),
  },
  {
    how: () => 'plural',
    reach: (p, free) => reachedByName(p, free, (n, l) => samePlural(n, l.name)),
  },
  {
    // canonicalize strips marketing and provenance words — organic, premium,
    // free-range — which is most of what a brand-heavy receipt line is.
    how: () => 'canonical',
    reach: (p, free) =>
      reachedByName(p, free, (n, l) => canonicalize(fold(n)) === canonicalize(fold(l.name))),
  },
  {
    how: (p) => `glyph ${purchaseGlyph(p)}`,
    reach: (p, free) => {
      const g = purchaseGlyph(p);
      return g ? free.filter((l) => glyph(l.name, l.category) === g) : [];
    },
  },
];

/**
 * Which list row is this purchase, if any.
 *
 * ---------------------------------------------------------------------------
 * Four free rungs, then a paid one somewhere else
 * ---------------------------------------------------------------------------
 *
 * Measured against twenty-four real lines from five receipts and a plausible
 * English list, these four settle a little over half. The rest go to the model,
 * and that share shrinks by itself: every high-confidence line the extractor
 * reads teaches the shared lexicon what the till calls things, so `CAR EIREN
 * X30` resolves to 🥚 offline once three households have scanned a Carrefour
 * receipt, and rung four then matches it for nothing.
 *
 * Each rung is tried against the raw line, the expansion AND the translation,
 * because they fail differently: `komkommer` is in the curated table and
 * `CAR EIREN` is not, while an expansion reaches an English list a raw Dutch
 * line never would.
 *
 * ---------------------------------------------------------------------------
 * A RUNG AT A TIME, NOT A LINE AT A TIME
 * ---------------------------------------------------------------------------
 *
 * The outer loop is the rung and the inner loop is the purchase, and that way
 * round is the whole point. It used to be the other way: every rung ran for one
 * line before the next line was looked at, which meant the ORDER LINES WERE
 * PRINTED IN decided who got a row, and a weak match reached first beat a strong
 * one reached later.
 *
 * Concretely, with `Milk` on the list: `CHOCOLATE MILK DRINK` printed first has
 * no exact, plural or canonical match, but its glyph is 🥛 and only one row
 * shares it — so it claimed Milk. `MILK`, printed fifth, then found the row
 * gone and fell through to the model or to "also bought". A receipt's print
 * order is not evidence about anything.
 *
 * Now every exact match is settled before any plural is considered, every
 * plural before any canonical, and so on. Within one rung the two lines are
 * equally good evidence and first-come still wins — that is a genuine tie, and
 * the loser drops to the next rung rather than out of the ladder.
 *
 * ---------------------------------------------------------------------------
 * EVERY RUNG CAN SAY "I DON'T KNOW"
 * ---------------------------------------------------------------------------
 *
 * Only the glyph rung used to return `ambiguous`; the other three took the
 * FIRST row they found and moved on, which is list order deciding a question
 * nobody answered.
 *
 * It bit on the canonical rung, which strips `salted` and `unsalted` alike. A
 * list with both `Salted butter` and `Unsalted butter` gives a bare `BOTER` two
 * equally good canonical matches, and one was picked by whichever came first —
 * with no way to tell afterwards, since 🧈 and dairy are identical on both and
 * the veto has nothing to object to.
 *
 * So a rung that reaches more than one row asks instead of picking, exactly as
 * the glyph rung always did. Ambiguity claims nothing, which leaves both rows
 * free for the model or for the shopper.
 */
export function matchPurchases(
  purchases: readonly ReceiptPurchase[],
  list: readonly ListCandidate[],
): Map<string, MatchOutcome> {
  const out = new Map<string, MatchOutcome>();
  /*
   * One list row can only be claimed once.
   *
   * Two receipt lines that both look like "Eggs" are two purchases, not one
   * matched twice — and letting the second overwrite the first would silently
   * discard a real purchase. First claim wins; the rest fall through.
   */
  const claimed = new Set<string>();

  // Still looking. A purchase leaves this list the moment it is settled, either
  // by a match or by an ambiguity the model has to resolve.
  let open: ReceiptPurchase[] = [...purchases];

  for (const rung of RUNGS) {
    const still: ReceiptPurchase[] = [];
    for (const p of open) {
      const free = list.filter((l) => !claimed.has(l.id));
      const reach = rung.reach(p, free);

      if (reach.length === 0) {
        still.push(p);
        continue;
      }
      if (reach.length > 1) {
        // A question, not an answer — and it claims nothing, so both rows stay
        // available to whoever can actually tell them apart.
        out.set(p.key, { kind: 'ambiguous', itemIds: reach.map((l) => l.id) });
        continue;
      }

      claimed.add(reach[0]!.id);
      out.set(p.key, { kind: 'matched', itemId: reach[0]!.id, how: rung.how(p) });
    }
    open = still;
  }

  for (const p of open) out.set(p.key, { kind: 'unmatched' });

  return out;
}

/** Everything the model still has to decide, and nothing it does not. */
export function residue(
  purchases: ReceiptPurchase[],
  matches: Map<string, MatchOutcome>,
): ReceiptPurchase[] {
  return purchases.filter((p) => matches.get(p.key)?.kind !== 'matched');
}

/* ------------------------------------------------- the model's answers ---- */

export interface AiMatch {
  key: string;
  itemId: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Fold the model's answers into the offline result.
 *
 * ---------------------------------------------------------------------------
 * Every rule here refuses something, and that is the design
 * ---------------------------------------------------------------------------
 *
 * The function already drops ids it never sent and second claims on ids it did.
 * This does the same again, on the device, and the repetition is deliberate: a
 * mismatched line is invisible. A price on the wrong row of a list looks
 * exactly like a price on the right one, and it goes on poisoning that item's
 * comparisons for as long as the history is kept. An UNMATCHED line, by
 * contrast, is a row in the review sheet somebody corrects in a second.
 *
 * So the asymmetry is priced in: refusing a good match costs one tap, accepting
 * a bad one costs a number nobody will ever question.
 *
 * The offline rungs win outright over the model. They are deterministic, they
 * were free, and — for exact and plural matches — they are not judgement calls
 * at all. A model disagreeing with `normalizeKey` equality is a model that is
 * wrong.
 *
 * And `refutes` is the last of those refusals: what the device already knows
 * about both sides, allowed to overrule what the model decided about them. See
 * that function for the receipt that made it necessary.
 *
 * `purchases` is required rather than optional on purpose. It is only needed for
 * the veto, so an optional parameter would let a caller silently switch the veto
 * off by forgetting it — the compiler catching that is worth the two words.
 */
export function applyAiMatches(
  matches: Map<string, MatchOutcome>,
  answers: readonly AiMatch[],
  list: readonly ListCandidate[],
  purchases: readonly ReceiptPurchase[],
): Map<string, MatchOutcome> {
  const out = new Map(matches);
  const known = new Map(list.map((l) => [l.id, l]));
  const byKey = new Map(purchases.map((p) => [p.key, p]));
  // Seeded with whatever the offline rungs already took, so the model cannot
  // hand a second line an item that is spoken for.
  const claimed = new Set(
    [...matches.values()].flatMap((m) => (m.kind === 'matched' ? [m.itemId] : [])),
  );

  for (const a of answers) {
    const current = out.get(a.key);
    if (!current) continue;
    if (current.kind === 'matched') continue;
    if (a.itemId == null) continue;
    const candidate = known.get(a.itemId);
    if (!candidate) continue;
    if (claimed.has(a.itemId)) continue;

    /*
     * The veto. A purchase this call was not given cannot be checked, and an
     * uncheckable match is refused rather than waved through — the one caller
     * passes every purchase, so a miss here means the wiring is wrong, and
     * accepting on a wiring fault is how a safety net goes quiet.
     */
    const p = byKey.get(a.key);
    if (!p || refutes(p, candidate)) continue;

    claimed.add(a.itemId);
    out.set(a.key, { kind: 'matched', itemId: a.itemId, how: `ai ${a.confidence}` });
  }

  return out;
}

/* ---------------------------------------------------------------- wire ---- */

/**
 * Send the photographs and get the receipt back.
 *
 * Returns null on anything at all — an unreachable function, a refusal from the
 * rate cap, a receipt the model could not read. The caller shows one message
 * for all of them, because the difference is not actionable at a till: the
 * answer is always to try a clearer photograph or to type it in.
 */
/**
 * How long to wait for a read before giving up, in ms.
 *
 * Stated rather than inherited, and that is the whole point of it. There was no
 * timeout here, which does not mean "wait forever" — it means whatever the
 * platform decides, which on iOS is a 60-second default nobody chose. The
 * function's own log shows what that looked like from the other end: booted,
 * then `shutdown ... reason: EarlyDrop` ninety-three seconds later, with 204ms
 * of CPU used. EarlyDrop is the runtime saying the caller went away. The phone
 * had already hung up on a read that was still being written, and the shopper
 * saw a failure with no reason and tried again — which is how one slow scan
 * becomes "several minutes".
 *
 * Two minutes because a four-photograph shop is genuinely a long read and
 * failing one that would have arrived is worse than waiting. It is a ceiling
 * for the pathological case, not a target: anything close to it is a bug in
 * this file's neighbours, and the server now logs its own read time the moment
 * it lands so the two can be compared rather than guessed at.
 */
const SCAN_TIMEOUT_MS = 120_000;

export async function scanReceipt(
  images: { media: string; data: string }[],
  language: string,
): Promise<ScannedReceipt | null> {
  /*
   * AbortController rather than Promise.race: racing leaves the request running
   * and the phone still uploading megabytes for an answer nobody will read.
   * This actually cancels it, which is also what tells the server to stop.
   */
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/receipt-scan`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({ images, language }),
      signal: abort.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ScannedReceipt;
  } catch {
    return null;
  } finally {
    // Always, including the success path: a two-minute timer left armed on a
    // scan that finished in twenty seconds keeps this module alive for the rest
    // of it, and fires an abort on a controller nobody is listening to.
    clearTimeout(timer);
  }
}

/**
 * Ask the model about whatever the free rungs could not settle.
 *
 * Returns an empty list on any failure, so a matcher that is down or refused by
 * the rate cap leaves every line unmatched rather than failing the import. The
 * review sheet shows them as new items and the shopper fixes the two that
 * matter.
 */
export async function matchResidue(
  purchases: readonly ReceiptPurchase[],
  list: readonly ListCandidate[],
  claimed: ReadonlySet<string>,
  language: string,
): Promise<AiMatch[]> {
  // Nothing to ask about, or nothing to choose from. Both are ordinary — a
  // receipt where every line matched, or a list already fully spoken for.
  const free = list.filter((l) => !claimed.has(l.id));
  if (purchases.length === 0 || free.length === 0) return [];

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/receipt-match`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({
        language,
        // Only what the matcher needs. The prices are not sent: they are
        // nothing to do with which item a line is, and a payload carrying a
        // household's spending to answer a naming question is a worse trade
        // than a slightly less informed model.
        lines: purchases.map((p) => ({
          key: p.key,
          raw: p.raw[0] ?? p.name,
          expanded: p.expanded,
          translated: p.translated,
          brand: p.brand,
          section: p.section,
        })),
        candidates: free.map((l) => ({ id: l.id, name: l.name })),
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches?: AiMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

/** The list rows the offline rungs have already taken. */
export function claimedIds(matches: Map<string, MatchOutcome>): Set<string> {
  return new Set([...matches.values()].flatMap((m) => (m.kind === 'matched' ? [m.itemId] : [])));
}
