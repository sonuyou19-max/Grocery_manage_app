/**
 * The regulars: what this household actually buys, often enough to be worth
 * one tap.
 *
 * ---------------------------------------------------------------------------
 * Frequency, not urgency
 * ---------------------------------------------------------------------------
 *
 * The strip this feeds used to show what was DUE — the pantry's burn-rate
 * prediction, surfaced on the list. That is a different question from the one
 * its heading asks. "You usually buy" is about how often something is bought,
 * and a prediction about running low can put an item there that was bought once
 * and is merely overdue by the category default.
 *
 * So the rule is counting, and it is deliberately blunt: bought at least twice,
 * and among the most-bought. Nothing here reads an interval or a due date.
 *
 * ---------------------------------------------------------------------------
 * Ties are not broken, they are included
 * ---------------------------------------------------------------------------
 *
 * "Top five" with three items tied on the fifth place has no honest answer that
 * shows two of them. They are the same by the only measure this uses, and
 * picking between them by alphabet or by luck would present an arbitrary
 * ordering as a judgement.
 *
 * So the cut is on the COUNT, not on the position: everything with at least as
 * many buys as the fifth-placed item stays. Five items normally, more when the
 * data genuinely does not distinguish them, and the strip scrolls.
 */

/** Bought fewer times than this and it is not a regular, it is a purchase. */
export const USUAL_MIN_BUYS = 2;

/** How many make the strip, before ties. See above for why that is a floor. */
export const USUAL_TOP_N = 5;

/**
 * How many times each item appears in the log.
 *
 * Counted from the purchase log rather than read from `sampleCount`, which
 * counts observed GAPS — one fewer than the purchases, and only when they were
 * far enough apart to be believed. "Bought twice" should mean bought twice.
 */
export function purchaseCounts(purchases: readonly { key: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of purchases) {
    if (!p.key) continue;
    counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The regulars among `candidates`, most-bought first.
 *
 * The caller decides what may be a candidate — which list, what is already on
 * it — because those are facts about a screen. This only ranks.
 */
export function usualBuys<T extends { key: string; display: string; lastPurchasedAt: number }>(
  candidates: readonly T[],
  counts: ReadonlyMap<string, number>,
): T[] {
  const ranked = candidates
    .filter((c) => (counts.get(c.key) ?? 0) >= USUAL_MIN_BUYS)
    .sort((a, b) => {
      const byCount = (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0);
      if (byCount !== 0) return byCount;
      /*
       * Equal regulars, most recently bought first — the one you reached for
       * last week is the likelier of two. Then by name, so the order is total
       * and the strip does not reshuffle between renders on a coin toss.
       */
      const byRecency = b.lastPurchasedAt - a.lastPurchasedAt;
      return byRecency !== 0 ? byRecency : a.display.localeCompare(b.display);
    });

  if (ranked.length <= USUAL_TOP_N) return ranked;

  /*
   * Cut on the count, not the position. See the note above: three items tied on
   * fifth place are the same by the only measure here, and showing two of them
   * would dress a coin toss as a ranking.
   */
  const cutoff = counts.get(ranked[USUAL_TOP_N - 1].key) ?? 0;
  return ranked.filter((c) => (counts.get(c.key) ?? 0) >= cutoff);
}
