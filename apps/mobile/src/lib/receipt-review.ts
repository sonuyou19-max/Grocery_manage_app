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
