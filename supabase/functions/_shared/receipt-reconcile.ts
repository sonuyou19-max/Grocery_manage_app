/**
 * Does the parse agree with the paper?
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * Receipt scanning writes money into the price history, and there is no way to
 * assert that a language model read a photo correctly. Prose can be checked by
 * a person; a column of numbers cannot, because nobody re-adds their shopping.
 *
 * But a receipt is a document that checks itself. It prints its own total, and
 * usually its own article count, and every line prints the two factors of its
 * own product. So the model's output can be tested against numbers the model
 * also had to read — and a misreading has to be consistent across all of them
 * to survive, which is a much higher bar than being individually plausible.
 *
 * Five real receipts from three countries — Carrefour BE, a Leuven independent,
 * Colruyt, Kaufland DE, Aldi Süd — all reconcile to the cent under these rules,
 * with no per-chain special cases. See scripts/check-receipt.
 *
 * ---------------------------------------------------------------------------
 * What is checked, and what each one catches
 * ---------------------------------------------------------------------------
 *
 *   LINE     multiplier × unitPrice = lineTotal
 *            Catches a misread digit in either factor, and — more valuably —
 *            catches the multiplier being classified as the wrong KIND. A
 *            weight read as a pack count fails its own arithmetic.
 *
 *   GOODS    Σ positive item lines = the printed goods subtotal
 *            Catches a line missed entirely, or one invented.
 *
 *   PAID     goods + deposits + discounts + rounding = the amount paid
 *            Catches an adjustment misread or missed. Separate from GOODS so a
 *            failure says WHERE it is: goods right and paid wrong means the
 *            items were read correctly and a discount was not.
 *
 *   COUNT    the printed article count, read either as units or as lines
 *            Optional — two of five receipts print it, and they disagree about
 *            what it counts, so both readings are accepted. Weaker than one
 *            rule, and still the check that catches a line double-counted
 *            across two overlapping photos when the duplicate is too cheap to
 *            move the money noticeably.
 */

/** What a line multiplier means. See classify() for how the two are told apart. */
export type Multiplier = 'count' | 'measure';

export type LineKind = 'item' | 'deposit' | 'discount' | 'rounding' | 'other';

export interface ReceiptLine {
  /** Exactly as printed, for the review sheet. Never shown alone. */
  raw: string;
  kind: LineKind;
  /**
   * How many, or how much. A count for packs, a measure for weight or volume.
   * Null where the receipt prints none, which means one — Kaufland prints no
   * quantity column at all.
   */
  multiplier: number | null;
  multiplierKind: Multiplier;
  /**
   * Decimal places the multiplier was PRINTED to, which is not the precision it
   * was computed at. An independent in Leuven prints `0,49 x` for a weight of
   * 0,488 kg — so `0.49 × 8,95` misses the printed line total by 1.5 cents, and
   * a flat tolerance would reject a perfectly good line. Null when absent.
   */
  multiplierDp: number | null;
  /** Per pack, or per kg. Null where the receipt prints only a total. */
  unitPriceCents: number | null;
  unitPriceDp: number | null;
  /** The line's own money, as printed. Negative for discounts and returns. */
  totalCents: number;
}

export interface ReceiptTotals {
  /** The printed subtotal for goods, before adjustments. Null when absent. */
  goodsCents: number | null;
  /** What was actually paid. The authority; every other figure is a check. */
  paidCents: number | null;
  /** The printed article count, where the receipt prints one. */
  articleCount: number | null;
}

export interface ReconcileResult {
  ok: boolean;
  /** One entry per failed check, in the order they were run. */
  problems: string[];
  /** Indices of lines whose own arithmetic did not hold. */
  badLines: number[];
  /** Derived, for the receipts row. */
  goodsCents: number;
  depositCents: number;
  discountCents: number;
  paidCents: number;
}

/**
 * Half of the last printed place, in cents.
 *
 * A value shown to 2dp could be anything within half a hundredth of what is
 * shown, and that uncertainty multiplies through the product. Null decimal
 * places mean the figure was not printed at all, so it contributes no error.
 */
function halfUlp(value: number | null, dp: number | null): number {
  if (value == null || dp == null) return 0;
  return 0.5 * Math.pow(10, -dp);
}

/**
 * Is this multiplier a count of packs, or a measure of one?
 *
 * The receipts disagree about where the multiplier is printed and agree about
 * nothing else, so the classification cannot be positional. What holds across
 * all five is the shape of the number and the unit attached to it: an integer
 * against a per-piece price is a count; anything fractional, or carrying kg / g
 * / l, is a measure.
 *
 * Exported because the extractor and the reviewer must agree, and because the
 * check pins it directly.
 */
export function classify(multiplier: number | null, unit: string | null): Multiplier {
  if (unit && /^(kg|g|l|ml|cl)$/i.test(unit)) return 'measure';
  if (multiplier == null) return 'count';
  return Number.isInteger(multiplier) ? 'count' : 'measure';
}

/** Cents, rounded the way a till rounds — half away from zero. */
const round = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));

export function reconcile(lines: ReceiptLine[], totals: ReceiptTotals): ReconcileResult {
  const problems: string[] = [];
  const badLines: number[] = [];

  /* ---------------------------------------------------- LINE ------------- */

  lines.forEach((line, i) => {
    const { multiplier: m, unitPriceCents: p } = line;
    // Nothing to contradict: a line printing only a total is common on German
    // receipts and is not evidence of anything.
    if (m == null || p == null) return;

    const expected = m * p;
    /*
     * Both factors contribute their own display uncertainty, plus half a cent
     * for the till rounding the product it printed. Written out rather than
     * folded into a constant because each term is a different receipt's
     * behaviour: Everest rounds the quantity, Colruyt rounds the unit price to
     * three places, and every till rounds the product.
     *
     * A COUNT contributes nothing, and that is not an optimisation — it is the
     * difference between a tolerance of half a cent and one of eighty-four. Four
     * packs is exactly four; it is not "4 ± 0.5" the way a weight printed to
     * zero decimals would be. Treating the two alike made the tolerance scale
     * with the unit price, so a €1,67 line could be wrong by 84 cents and still
     * pass. The fixtures caught it on the first run.
     */
    const measureError =
      line.multiplierKind === 'measure' ? Math.abs(p) * halfUlp(m, line.multiplierDp) : 0;
    const tolerance = 0.5 + Math.abs(m) * halfUlp(p, line.unitPriceDp) + measureError;

    if (Math.abs(expected - line.totalCents) > tolerance) badLines.push(i);
  });

  if (badLines.length) {
    problems.push(`${badLines.length} line(s) do not multiply out`);
  }

  /* --------------------------------------------------- GOODS ------------- */

  const sum = (kind: LineKind) =>
    lines.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.totalCents, 0);

  const goodsCents = sum('item');
  const depositCents = sum('deposit');
  const discountCents = sum('discount');
  const roundingCents = sum('rounding');

  if (totals.goodsCents != null && round(goodsCents) !== round(totals.goodsCents)) {
    problems.push(
      `items add up to ${goodsCents} but the receipt says ${totals.goodsCents}`,
    );
  }

  /* ---------------------------------------------------- PAID ------------- */

  const paidCents = goodsCents + depositCents + discountCents + roundingCents;

  if (totals.paidCents != null && round(paidCents) !== round(totals.paidCents)) {
    problems.push(`the lines total ${paidCents} but ${totals.paidCents} was paid`);
  }

  /* --------------------------------------------------- COUNT ------------- */

  if (totals.articleCount != null) {
    /*
     * Positive lines only — a refund is not an article. Aldi prints "8 Artikel"
     * against nine lines and the excluded one is its −1,00 deposit return; the
     * same rule drops Colruyt's −10,00 discount.
     *
     * ---------------------------------------------------------------------
     * Two conventions, because the chains do not agree with each other
     * ---------------------------------------------------------------------
     *
     * Carrefour counts UNITS: sixteen lines, "23 Artikelen", and the difference
     * is exactly the multipliers — four cartons of milk are four articles, and
     * each weighed line counts as one.
     *
     * Aldi counts LINES: nine lines, one of them a refund, "8 Artikel" — and
     * its `Pfand 6 x EUR 0,25` counts once despite the six.
     *
     * Neither is wrong and nothing on the paper says which is in use, so this
     * accepts either. That is weaker than one rule would be, and still worth
     * having: a line duplicated by an overlap between two photos shifts BOTH
     * counts, which is the error this check exists to catch and the one the
     * money checks can miss when the duplicate is cheap.
     */
    const positive = lines.filter((l) => l.totalCents > 0);
    // Units: multipliers for counts, one per weighed line — you cannot buy
    // 0.9 articles.
    const asUnits = positive.reduce(
      (acc, l) => acc + (l.multiplierKind === 'measure' ? 1 : l.multiplier ?? 1),
      0,
    );
    const asLines = positive.length;

    if (asUnits !== totals.articleCount && asLines !== totals.articleCount) {
      problems.push(
        `counted ${asUnits} articles (or ${asLines} lines), the receipt says ${totals.articleCount}`,
      );
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    badLines,
    goodsCents,
    depositCents,
    discountCents,
    paidCents: totals.paidCents ?? paidCents,
  };
}

/**
 * What makes a receipt THIS receipt.
 *
 * Store, printed total and printed time — three things printed ON the paper, so
 * two scans of it agree however differently the photos parsed. Deliberately not
 * derived from the lines: a blurrier second photo can split a line differently,
 * and a fingerprint that moved with the parse would let a duplicate through on
 * exactly the re-scan it exists to catch.
 */
export function fingerprint(
  store: string | null,
  paidCents: number | null,
  purchasedAt: string | null,
): string {
  const s = (store ?? '?').toLowerCase().replace(/[^a-z0-9]+/g, '');
  // To the minute. Seconds are printed by some tills and not others, and a
  // household paying the same total at the same shop within one minute is not a
  // case worth engineering around.
  const t = purchasedAt ? purchasedAt.slice(0, 16) : '?';
  return `${s}|${paidCents ?? '?'}|${t}`;
}
