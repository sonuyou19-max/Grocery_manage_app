import type { ListCandidate, MatchOutcome, ReceiptPurchase } from '@/lib/receipt';

/**
 * What the shopper decided about a scanned receipt.
 *
 * ---------------------------------------------------------------------------
 * Separate from the screen, because the screen is not where this can be checked
 * ---------------------------------------------------------------------------
 *
 * Every rule in here is a rule about money landing on the right row of somebody
 * else's data, and every one of them fails silently. A price on the wrong item
 * looks exactly like a price on the right item. So the rules live in functions
 * that can be broken on purpose and shown to complain, rather than in a
 * component where the only test available is looking at it.
 *
 * The state is a Map keyed by purchase, rebuilt on every change rather than
 * mutated. That is not ceremony: `assign` has to reach into ANOTHER entry to
 * release a claim, and doing that in place while React holds the same object is
 * how a screen ends up showing one thing and importing another.
 */

export interface Decision {
  /** Import this line, or leave it out entirely. */
  include: boolean;
  /**
   * What was paid, in cents, across every pack of it.
   *
   * The printed total rather than a unit price, because the printed total is
   * the part the receipt is actually evidence of. A unit price is arithmetic we
   * would be doing on the shopper's behalf and then storing as if they had
   * checked it.
   */
  priceCents: number;
  /**
   * The list row this is, or null for "not on the list".
   *
   * Null is an ordinary answer, not a missing one — most of a real shop is not
   * on the list. It means: import it as its own thing, don't tick anything off.
   */
  itemId: string | null;
}

export type Decisions = ReadonlyMap<string, Decision>;

/**
 * The starting point: everything in, prices as printed, matches as found.
 *
 * `ambiguous` deliberately starts UNASSIGNED. It is the matcher saying two list
 * rows are equally plausible, and picking one to pre-fill would convert a
 * question into an answer that nobody was asked — the shopper would have to
 * notice a decision had been made for them in order to disagree with it.
 */
export function initialDecisions(
  purchases: readonly ReceiptPurchase[],
  matches: ReadonlyMap<string, MatchOutcome>,
): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const p of purchases) {
    const m = matches.get(p.key);
    out.set(p.key, {
      include: true,
      priceCents: p.priceCents,
      itemId: m?.kind === 'matched' ? m.itemId : null,
    });
  }
  return out;
}

/**
 * Fold in matches that arrived after the sheet was already on screen.
 *
 * The AI matcher is a second round trip and the shopper used to wait through it
 * before seeing anything. It runs beside the review now, so its answers land on
 * a sheet somebody may already be working in — which makes "do not undo what
 * they just did" the entire specification.
 *
 * Two rules, and both are refusals:
 *
 *   A purchase that already has an itemId is left alone. Either the matcher
 *   settled it offline before the sheet opened, or the shopper assigned it by
 *   hand; in both cases a late answer is stale by definition, since it was
 *   composed from a question asked before that happened.
 *
 *   A list row already spoken for is not handed out twice. `assign` moves a
 *   claim rather than duplicating it, so an unchecked late answer could silently
 *   take a row off the line the shopper had just put it on — the one edit they
 *   would be most sure they had made.
 *
 * Everything else is a blank being filled, which is all this was ever for.
 */
export function mergeLateMatches(
  d: Decisions,
  matches: ReadonlyMap<string, MatchOutcome>,
): Map<string, Decision> {
  const out = new Map(d);
  const taken = new Set<string>();
  for (const [, decision] of out) {
    if (decision.itemId != null) taken.add(decision.itemId);
  }
  for (const [key, m] of matches) {
    if (m.kind !== 'matched') continue;
    const current = out.get(key);
    if (!current || current.itemId != null) continue;
    if (taken.has(m.itemId)) continue;
    out.set(key, { ...current, itemId: m.itemId });
    taken.add(m.itemId);
  }
  return out;
}

export function setInclude(d: Decisions, key: string, include: boolean): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, include });
  return out;
}

export function setPrice(d: Decisions, key: string, priceCents: number): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, priceCents });
  return out;
}

/**
 * Point a receipt line at a list row — and take it off whatever line held it.
 *
 * ---------------------------------------------------------------------------
 * The move, and why it is not an add
 * ---------------------------------------------------------------------------
 *
 * One list row can be claimed once. The matcher enforces that; so does the
 * function; and it has to hold here too, where a PERSON is doing the assigning
 * and the obvious implementation — set this line's itemId — quietly breaks it.
 *
 * Picture the correction that actually happens. The scan put `CAR EIREN X30` on
 * "Eggs" and the shopper knows the eggs are really the line below it. They tap
 * the line below and choose Eggs. If that only sets a field, the receipt now
 * says two different lines are both the eggs, and the import ticks one item off
 * twice with two different prices — from a gesture that meant "not that one,
 * this one".
 *
 * So choosing an already-claimed row MOVES it. The line that had it is left
 * unassigned, which is visible in the sheet as a row that has become "not on
 * your list" and can be corrected in turn. Nothing is lost and nothing is
 * duplicated.
 */
export function assign(d: Decisions, key: string, itemId: string | null): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (!current) return out;

  if (itemId != null) {
    for (const [otherKey, other] of out) {
      if (otherKey !== key && other.itemId === itemId) {
        out.set(otherKey, { ...other, itemId: null });
      }
    }
  }

  out.set(key, { ...current, itemId });
  return out;
}

/* ----------------------------------------------------------- the groups -- */

export interface ReviewGroups {
  /** Receipt lines pointed at a list row. */
  matched: ReceiptPurchase[];
  /** Receipt lines that are not on the list — most of a real shop. */
  extra: ReceiptPurchase[];
}

export function groupPurchases(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): ReviewGroups {
  const matched: ReceiptPurchase[] = [];
  const extra: ReceiptPurchase[] = [];
  for (const p of purchases) {
    // Excluded lines stay in their group rather than vanishing. A row that
    // disappears when you untick it takes its own untick button with it, and
    // the only way back is to remember what it said.
    if (decisions.get(p.key)?.itemId != null) matched.push(p);
    else extra.push(p);
  }
  return { matched, extra };
}

/**
 * List rows nothing on the receipt claimed.
 *
 * Two quite different things wearing one face — something you did not buy, and
 * something you bought that the scan failed to recognise — and the sheet cannot
 * tell them apart, so it does not try. It shows them and lets the shopper point
 * a line at one.
 */
export function unclaimed(
  list: readonly ListCandidate[],
  decisions: Decisions,
): ListCandidate[] {
  const taken = new Set<string>();
  for (const d of decisions.values()) {
    if (d.itemId != null) taken.add(d.itemId);
  }
  return list.filter((l) => !taken.has(l.id));
}

/**
 * What the import will actually add up to.
 *
 * Only the included lines, because that is the question the footer is
 * answering. It is deliberately NOT compared against the receipt's total to
 * produce a warning: excluding a line is a legitimate thing to do and would
 * trip any such check immediately. The reconciliation warning is about whether
 * the SCAN agrees with the receipt, which is a different claim and has its own
 * banner.
 */
export function includedTotal(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): number {
  let total = 0;
  for (const p of purchases) {
    const d = decisions.get(p.key);
    if (d?.include) total += d.priceCents;
  }
  return total;
}

export function includedCount(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): number {
  let n = 0;
  for (const p of purchases) if (decisions.get(p.key)?.include) n += 1;
  return n;
}

/**
 * The rows this line may be pointed at.
 *
 * Free rows, plus the one it already holds. Exported for the guard, because the
 * second half is the part that looks redundant and is not: drop it and the
 * picker on a matched line shows every option except the current one, which
 * reads as the app having lost it.
 */
export function pickerOptions(
  candidates: readonly ListCandidate[],
  decisions: Decisions,
  key: string | null,
): ListCandidate[] {
  const mine = key != null ? decisions.get(key)?.itemId ?? null : null;
  const free = new Set(unclaimed(candidates, decisions).map((c) => c.id));
  return candidates.filter((c) => free.has(c.id) || c.id === mine);
}

/**
 * Does the import add up to what the paper says was paid?
 *
 * ---------------------------------------------------------------------------
 * The hole this closes
 * ---------------------------------------------------------------------------
 *
 * The server reconciles the model's lines against the model's own reading of
 * the printed total — which is a real check right up until the model gets both
 * wrong in the same direction. A Delhaize receipt came back with every price
 * from the seventh line onward shifted onto the product above it: every amount
 * genuinely appeared on the paper, the arithmetic was internally consistent,
 * and nothing flagged it. €45.49 was offered for a €48.02 shop.
 *
 * So the last comparison happens here, against the number in front of the
 * shopper, using the amounts they can actually see.
 *
 * It is deliberately silent unless EVERY line is included. Unticking one is a
 * normal thing to do and would trip this on the first tap, which is exactly the
 * reasoning that kept the footer from comparing anything at all until now. The
 * fix is not to compare less; it is to compare only when the comparison means
 * something.
 */
export function offBy(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
  paidCents: number | null,
  depositCents: number,
  discountCents: number,
): number | null {
  if (paidCents == null) return null;
  // Anything left out makes the sums legitimately differ.
  if (includedCount(purchases, decisions) !== purchases.length) return null;

  /*
   * Deposits and discounts are money on the receipt and never purchases, so
   * they are added back before the comparison. Leaving them out would report a
   * gap on every receipt that carried a bottle deposit — a false alarm on a
   * warning whose whole value is that it is rare.
   */
  const expected = paidCents - depositCents - discountCents;
  const diff = includedTotal(purchases, decisions) - expected;
  // A cent or two is rounding on a weighed line, not a misread row.
  return Math.abs(diff) <= 2 ? null : diff;
}
