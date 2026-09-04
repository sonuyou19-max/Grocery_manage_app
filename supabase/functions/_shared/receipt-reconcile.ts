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

/**
 * Which check failed, for callers that must branch on it.
 *
 * `line` — a line's own multiplier × unit price ≠ its total.
 * `goods` — the item lines do not add up to the printed goods subtotal.
 * `paid`  — everything together does not add up to what was paid.
 * `count` — the article count disagrees with both ways of counting.
 */
export type ProblemCode = 'line' | 'goods' | 'paid' | 'count';

/** The failures that mean a NUMBER was misread, rather than a convention. */
export const MONEY_CODES: readonly ProblemCode[] = ['line', 'goods', 'paid'];

/**
 * A failed check with its numbers, for the screen to phrase itself.
 *
 * ---------------------------------------------------------------------------
 * Why the sentences do not come from here
 * ---------------------------------------------------------------------------
 *
 * They used to. This file wrote "items add up to 4827 but the receipt says
 * 5020" and the review sheet printed it verbatim — which put raw cent integers
 * in front of a shopper looking at €48.27 on a piece of paper, in English, on a
 * phone that might be running in any of seven languages.
 *
 * Neither is fixable here. A server has no business deciding how money looks:
 * the decimal separator, the currency symbol and its position all belong to the
 * reader's locale, and the app already has a `money()` that knows them. The
 * language is the same argument. So this reports WHAT failed and WITH WHICH
 * NUMBERS, in cents, and the sentence is assembled where both are known.
 */
export type Problem =
  | { code: 'line'; lines: number }
  | { code: 'goods'; got: number; printed: number }
  | { code: 'paid'; got: number; printed: number }
  | { code: 'count'; units: number; asLines: number; printed: number };

export interface ReconcileResult {
  ok: boolean;
  /** One entry per failed check, in the order they were run. */
  problems: string[];
  /**
   * Things worth recording that are NOT failures.
   *
   * Kept apart from `problems` because `ok` is derived from that array, and the
   * first version of the implausible-count rule pushed its note there — which
   * would have made a receipt that adds up perfectly report as not reconciled,
   * and shown the shopper a warning banner about arithmetic that was correct.
   * Strictly worse than the false warning it was written to remove, and caught
   * by the invariant that every problem must carry a code.
   *
   * Nothing here reaches the screen. A note is the app saying it declined to
   * use something, which is worth being able to count and is not something
   * anybody can act on.
   */
  notes: string[];
  /**
   * The same failures, with their numbers, for the client to phrase.
   *
   * One list, not two. `codes` used to sit beside `problems` and the pair could
   * drift — a check that pushed a sentence and forgot a code would go on
   * looking fine. Callers that only want the codes read them off this.
   */
  details: Problem[];
  /** Indices of lines whose own arithmetic did not hold. */
  badLines: number[];
  /**
   * Indices of discount lines dropped as the same reduction counted twice.
   *
   * Reported rather than merely acted on, because this is a correction made to
   * a model's answer without asking it: it has to be visible in the log and it
   * has to be countable, or there is no way to know whether it fires on one
   * receipt in a thousand or on half of them.
   */
  doubledDiscounts: number[];
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

/**
 * The same reduction, printed twice and read twice.
 *
 * ---------------------------------------------------------------------------
 * What the receipt actually looks like
 * ---------------------------------------------------------------------------
 *
 * Belgian and German tills routinely show a reduction against the product AND
 * again in a savings block near the total:
 *
 *     COCA COLA 1,5L            2,49
 *       KORTING 3+1            -0,62
 *     ...
 *     TOTAAL KORTINGEN         -0,62
 *
 * Both are printed, both are negative, and both are honestly reported by a
 * reader asked to transcribe what it sees. Summed, the shopper is credited with
 * twice the saving they got — and because the money moves in the goods and paid
 * columns together it reads as two ordinary total mismatches rather than as the
 * specific, fixable thing it is.
 *
 * ---------------------------------------------------------------------------
 * Why this is arithmetic and not another sentence in the prompt
 * ---------------------------------------------------------------------------
 *
 * There already is a sentence in the prompt telling the model to take the
 * reduction from the item block and never from the summary. It shipped, and the
 * receipts came back doubled anyway. A second, firmer sentence is the same fix
 * again — and the model is not doing anything unreasonable: it is looking at a
 * piece of paper with two minus signs on it and reporting two minus signs.
 * Which of them is the duplicate is not a fact about the text. It is a fact
 * about the ARITHMETIC, and the arithmetic is something this side can do
 * exactly.
 *
 * ---------------------------------------------------------------------------
 * MEASURED BETWEEN THE TWO PRINTED TOTALS, not against the lines
 * ---------------------------------------------------------------------------
 *
 * This is the second version, and the first one failed on a real receipt for a
 * reason worth writing down.
 *
 * It measured the gap as `printedPaid - sum(everything read)`. That is correct
 * only while every line was read correctly — and on the receipt that broke it,
 * one item had also been missed. The missing €3,15 moved the gap to €15,14,
 * which is not the value of any discount line, so nothing was dropped and the
 * shopper was credited twice. Two independent faults, and the second one
 * disabled the fix for the first.
 *
 * A receipt prints TWO totals that bracket its adjustments: the goods subtotal
 * before them and the amount paid after. Their difference is what every
 * deposit, discount and rounding line must add up to, and it is a fact about
 * the PAPER — a model that drops an item line cannot change it. So that is the
 * comparison:
 *
 *     (paid - goods)  is what the adjustments should come to
 *     deposit + discount + rounding  is what was read
 *     the excess between them is what was counted twice
 *
 * On the receipt above: 104,96 - 116,95 = -11,99 expected, -23,98 read, so
 * 11,99 too much was taken off — which is exactly one of the two identical
 * coupon lines, whether or not the kiwi was ever read.
 *
 * The old comparison survives as the fallback for a receipt that prints only
 * one of the two totals, where it is the best available and better than
 * nothing.
 *
 * That is what keeps it safe. It never removes money on a hunch — only when
 * doing so makes the parse agree with a number the shopper can read off the
 * paper, which is a stronger claim than any heuristic about where a line sat.
 * Two genuine identical reductions are indistinguishable from one printed twice
 * BY EYE; they are not indistinguishable to the total, which either wants both
 * or does not.
 *
 * At most two lines, deliberately. One is the real case — a summary line, or a
 * line transcribed twice from overlapping photographs; two covers a till that
 * prints two separate savings blocks. Past that the risk inverts: with eight
 * discount lines some combination sums to almost any gap, and a coincidence
 * that happens to balance the books is the kind of wrong answer nobody would
 * ever catch.
 *
 * ---------------------------------------------------------------------------
 * WHICH line was the copy is not a question that has to be answered
 * ---------------------------------------------------------------------------
 *
 * This first refused to act whenever more than one line could close the gap, on
 * the reasoning that it could not tell which was the duplicate. That was wrong,
 * and it disabled the fix on the commonest receipt there is: one discounted
 * item, its reduction printed against the product and again in the savings
 * block — two lines of -0,62 that are indistinguishable to the eye.
 *
 * They are also indistinguishable to the arithmetic, and that is the point.
 * Every candidate must equal the gap exactly, so every candidate holds the same
 * amount; dropping any one of them yields the same total, the same saving on
 * the review sheet and the same purchases. There is nothing there to get wrong.
 *
 * The LAST is dropped rather than the first, which is cosmetic and only reaches
 * the log: a savings block is printed near the total, so the later of two equal
 * reductions is more often the summary, and the logged index is then the line
 * somebody would find if they went looking at the paper.
 */
function doubledDiscountsIn(
  lines: readonly ReceiptLine[],
  computedPaid: number,
  reportedAdjustments: number,
  totals: ReceiptTotals,
  subtotalUnusable: boolean,
): number[] {
  const { goodsCents: printedGoods, paidCents: printedPaid } = totals;
  if (printedPaid == null) return [];

  /*
   * How much too much was taken off.
   *
   * Preferring the two printed totals, because their difference is a property
   * of the paper and survives a line the model failed to read — see the note
   * above, where exactly that combination shipped a doubled discount. Falling
   * back to the line sum only when the goods subtotal was not printed or not
   * legible.
   */
  /*
   * The two printed totals when the subtotal is usable, the line sum when it is
   * not. A subtotal the GOODS check has just refused must not be trusted here
   * either — it would move the gap by twenty euros and match nothing.
   */
  const gap =
    printedGoods != null && !subtotalUnusable
      ? round(printedPaid) - round(printedGoods) - round(reportedAdjustments)
      : round(printedPaid) - round(computedPaid);

  // A doubled reduction can only ever subtract too much, so a gap the other way
  // is a different fault entirely.
  if (gap <= 0) return [];

  const discounts: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind === 'discount') discounts.push(i);
  });
  /*
   * One discount line cannot be a duplicate of anything. Dropping it would be
   * this rule deciding a receipt's only reduction never happened, on the
   * strength of a total that disagrees for some other reason entirely.
   */
  if (discounts.length < 2) return [];

  const at = (i: number) => round(lines[i]!.totalCents);

  // A single line: a summary, or a line read twice. Last match — see above.
  const singles = discounts.filter((i) => -at(i) === gap);
  if (singles.length > 0) return [singles[singles.length - 1]!];

  // A pair: two savings blocks, or two products each duplicated.
  for (let a = discounts.length - 1; a >= 1; a -= 1) {
    for (let b = a - 1; b >= 0; b -= 1) {
      if (-(at(discounts[a]!) + at(discounts[b]!)) === gap) {
        return [discounts[b]!, discounts[a]!];
      }
    }
  }

  return [];
}

export function reconcile(lines: ReceiptLine[], totals: ReceiptTotals): ReconcileResult {
  const problems: string[] = [];
  const badLines: number[] = [];
  /*
   * The same failures, in prose, for the SERVER LOG only.
   *
   * It used to go to the review sheet as well, which put raw cent integers and
   * untranslated English in front of a shopper — see Problem above. The screen
   * now phrases itself from `details`; these sentences survive because a
   * function log is read by one person, in one language, who wants the numbers
   * exactly as the reconciler saw them.
   */
  const details: Problem[] = [];
  /* Declined checks and corrections, for the log only. See ReconcileResult. */
  const notes: string[] = [];

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
    details.push({ code: 'line', lines: badLines.length });
  }

  /* --------------------------------------------------- GOODS ------------- */

  const sumOf = (rows: readonly ReceiptLine[], kind: LineKind) =>
    rows.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.totalCents, 0);

  /*
   * A SUBTOTAL FAR BELOW WHAT WAS PAID IS NOT THE GOODS SUBTOTAL.
   *
   * goods + adjustments = paid, and adjustments are deposits (a few euro at
   * most) and discounts (which make goods LARGER than paid, not smaller). So a
   * printed "subtotal" that sits well under the amount paid cannot be the
   * subtotal of the goods — it is one of the other totals a receipt prints: a
   * VAT band, a department, or what one card covered.
   *
   * On the Colruyt receipt that prompted this, TOTAAL GOEDEREN was €116,95 and
   * the reader took €86,93 — the food-only subtotal, which is also exactly what
   * the meal vouchers paid, so the number appeared twice and looked confirmed.
   * Every correctly-read line was then reported as wrong.
   *
   * Ignoring it costs one check on a receipt whose subtotal could not be read.
   * Believing it costs every line on the screen.
   */
  const impossibleGap = Math.max(1500, Math.round(0.15 * (totals.paidCents ?? 0)));
  const subtotalUnusable =
    totals.goodsCents != null &&
    totals.paidCents != null &&
    round(totals.paidCents) - round(totals.goodsCents) > impossibleGap;

  if (subtotalUnusable) {
    notes.push(
      `ignored an implausible goods subtotal: ${round(totals.goodsCents ?? 0)} against ${round(totals.paidCents ?? 0)} paid`,
    );
  }

  /*
   * THE SAME REDUCTION, TWICE — settled before any total below is computed.
   *
   * A doubled discount does not fail one check, it fails GOODS and PAID
   * together, which reads as "the model misread two numbers" rather than as the
   * one fixable thing it is. Correcting it here means the shopper sees the
   * right saving on the review sheet AND stops being warned about arithmetic
   * that is now correct.
   */
  const adjustments =
    sumOf(lines, 'deposit') + sumOf(lines, 'discount') + sumOf(lines, 'rounding');
  const doubled = doubledDiscountsIn(
    lines,
    sumOf(lines, 'item') + adjustments,
    adjustments,
    totals,
    subtotalUnusable,
  );
  const kept = lines.filter((_, i) => !doubled.includes(i));

  const sum = (kind: LineKind) => sumOf(kept, kind);

  const goodsCents = sum('item');
  const depositCents = sum('deposit');
  const discountCents = sum('discount');
  const roundingCents = sum('rounding');


  if (!subtotalUnusable && totals.goodsCents != null && round(goodsCents) !== round(totals.goodsCents)) {
    problems.push(
      `items add up to ${goodsCents} but the receipt says ${totals.goodsCents}`,
    );
    details.push({ code: 'goods', got: round(goodsCents), printed: round(totals.goodsCents) });
  }

  /* ---------------------------------------------------- PAID ------------- */

  const paidCents = goodsCents + depositCents + discountCents + roundingCents;

  if (totals.paidCents != null && round(paidCents) !== round(totals.paidCents)) {
    problems.push(`the lines total ${paidCents} but ${totals.paidCents} was paid`);
    details.push({ code: 'paid', got: round(paidCents), printed: round(totals.paidCents) });
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
    /*
     * `kept`, not `lines`. It changes nothing today — a dropped duplicate is
     * negative and this counts positives — and it is the honest expression of
     * what is being counted: the lines this parse believes in. A later rule
     * that dropped a positive line would otherwise leave this silently counting
     * one that had been ruled out.
     */
    const positive = kept.filter((l) => l.totalCents > 0);
    // Units: multipliers for counts, one per weighed line — you cannot buy
    // 0.9 articles.
    const asUnits = positive.reduce(
      (acc, l) => acc + (l.multiplierKind === 'measure' ? 1 : l.multiplier ?? 1),
      0,
    );
    const asLines = positive.length;

    /*
     * A NUMBER THAT IS NOWHERE NEAR EITHER READING WAS NEVER AN ARTICLE COUNT.
     *
     * Most receipts do not print one, and a bare number in the header — a till
     * number, a ticket number, an operator code — is the thing a reader
     * mistakes for one. On the Colruyt receipt that prompted this, 64 was read
     * against 45 articles and 35 lines, and the result was a warning about
     * arithmetic that was perfectly correct.
     *
     * That is worse than no check at all. This one exists to catch a line
     * DUPLICATED across two overlapping photographs, which moves the count by
     * one or two; a figure nineteen away from the nearest reading is not that
     * fault, it is a different number entirely. So the check runs only inside a
     * band wide enough for what it is looking for and narrow enough to exclude
     * what it keeps finding instead.
     */
    const nearest = Math.min(
      Math.abs(asUnits - totals.articleCount),
      Math.abs(asLines - totals.articleCount),
    );
    const band = Math.max(3, Math.round(0.25 * Math.max(asUnits, asLines)));

    if (nearest > band) {
      // A NOTE, not a problem. `ok` is derived from `problems`, so recording
      // this there would fail a receipt that adds up perfectly.
      notes.push(
        `ignored an implausible article count: ${totals.articleCount} against ${asUnits} articles / ${asLines} lines`,
      );
    } else if (asUnits !== totals.articleCount && asLines !== totals.articleCount) {
      problems.push(
        `counted ${asUnits} articles (or ${asLines} lines), the receipt says ${totals.articleCount}`,
      );
      details.push({ code: 'count', units: asUnits, asLines, printed: totals.articleCount });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    notes,
    details,
    badLines,
    doubledDiscounts: doubled,
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

/**
 * How wrong an answer is, as three numbers that can be compared.
 *
 * ---------------------------------------------------------------------------
 * Why `problems.length` could not do this job
 * ---------------------------------------------------------------------------
 *
 * The retry in receipt-scan keeps its second answer only if it is better than
 * the first, and "better" was `problems.length` plus the money gap. Both are
 * blind to the improvement the retry is MOST likely to produce.
 *
 * `problems` carries one entry for every failed CHECK, not for every failed
 * row: three lines that do not multiply out push exactly one string, the same
 * as one line does. So a repair that fixes two of three bad lines leaves the
 * count at one, and the money gap is 0 on both sides because a `line` problem
 * moves neither total. Neither test can see it, so the better answer is thrown
 * away and the shopper waits for nothing. Observed: a six-item receipt with
 * badLines [3,4,8] spent twelve seconds on a repair and shipped the first
 * reading.
 *
 * `lines` was in the Problem type the whole time and nothing read it.
 *
 * ---------------------------------------------------------------------------
 * The order is the priority, and it is deliberate
 * ---------------------------------------------------------------------------
 *
 * MONEY FIRST, because it is the number the shopper is looking at and the one
 * the banner is about. Then BAD LINES, the rows that do not multiply out. Then
 * the count of failed checks, which only separates answers the first two call
 * equal.
 *
 * Compared lexicographically rather than summed into a score: a weighted sum
 * would let a big improvement in rows pay for a worse total, and a worse total
 * is not something a repair may buy.
 */
export interface Outcome {
  /** The worst gap between a printed total and the lines, in cents. */
  gapCents: number;
  /** Rows whose own arithmetic does not hold. */
  badLines: number;
  /** Failed checks, as a tie-break only. */
  problems: number;
}

export function outcomeOf(result: ReconcileResult): Outcome {
  return {
    gapCents: result.details.reduce(
      (worst, d) =>
        d.code === 'paid' || d.code === 'goods'
          ? Math.max(worst, Math.abs(d.got - d.printed))
          : worst,
      0,
    ),
    badLines: result.badLines.length,
    problems: result.problems.length,
  };
}

/**
 * Whether `candidate` is worth keeping over `incumbent`.
 *
 * Strictly better on the first thing they disagree about, so an answer that is
 * merely DIFFERENT loses. The incumbent has already been paid for; a tie means
 * the retry bought nothing and there is no reason to prefer a second guess.
 */
export function isBetter(candidate: Outcome, incumbent: Outcome): boolean {
  if (candidate.gapCents !== incumbent.gapCents) {
    return candidate.gapCents < incumbent.gapCents;
  }
  if (candidate.badLines !== incumbent.badLines) {
    return candidate.badLines < incumbent.badLines;
  }
  return candidate.problems < incumbent.problems;
}
