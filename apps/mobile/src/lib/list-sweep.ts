/**
 * When a bought item stops being part of the list.
 *
 * ---------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------
 *
 * Ticking an item moved it into a section at the foot of the list and left it
 * there permanently. Buy ten things a week and by the end of a month the list
 * carries a hundred and twenty rows, of which ten matter. The counter beside
 * the bag said "10/120 bought", which is a true statement about a list nobody
 * would recognise as theirs.
 *
 * ---------------------------------------------------------------------------
 * The rule
 * ---------------------------------------------------------------------------
 *
 * A ticked item settles at the end of the local day it was ticked on. Until
 * then it stays visible and untickable — the whole shopping trip remains one
 * undoable unit, so a mistake found at the checkout is still a mistake you can
 * fix. After that it is gone from the list, because it is in the kitchen.
 *
 * Unticked items never settle, however old. A list is a set of intentions and
 * an unmet intention does not expire on its own.
 *
 * The local day, not a rolling 24 hours: "yesterday's shop" is a thing people
 * can point at, and a boundary at midnight is one everybody can predict without
 * being told. A rolling window would clear items at whatever time of day they
 * happened to be ticked, which is the same rule and impossible to anticipate.
 *
 * ---------------------------------------------------------------------------
 * What settling is NOT
 * ---------------------------------------------------------------------------
 *
 * It is not deletion of the purchase. The transaction lives in the purchase log
 * (price_entries), which is what Insights reads and what the pantry model is
 * rebuilt from; sweeping the list row away touches none of it. What is lost is
 * only the ability to untick — which is the correct trade, because after
 * midnight an untick would mean "we need this again" rather than "that was a
 * mistap", and that is what putting it back on the list is for.
 *
 * A checked row with no `checkedAt` is treated as settled. Those exist only in
 * data written before this rule did — precisely the accumulated backlog this
 * is meant to clear — so the alternative would be leaving them on the list
 * forever, which is the bug.
 */

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** The shape this works on — anything with the two fields, so both the store's
 *  Item and a raw DB row can be passed without adapting either. */
export interface Settleable {
  checked: boolean;
  checkedAt: number | null;
}

export function isSettled(item: Settleable, now: number): boolean {
  if (!item.checked) return false;
  if (item.checkedAt == null) return true;
  /*
   * A clock that jumped backwards would otherwise settle a row ticked "in the
   * future", removing an item the user just bought. Strictly-earlier-day means
   * a future timestamp fails the test and the row stays, which is the safe way
   * to be wrong: a stale row is visible and fixable, a swept one is not.
   */
  return startOfLocalDay(item.checkedAt) < startOfLocalDay(now);
}

/** The list as the user should see it. Identity-stable when nothing settled, so
 *  this can sit in the store's render path without invalidating every memo
 *  downstream on each tick. */
export function liveItems<T extends Settleable>(items: T[], now: number): T[] {
  return items.some((it) => isSettled(it, now)) ? items.filter((it) => !isSettled(it, now)) : items;
}

/**
 * Ids of rows the sweep may actually DELETE — deliberately stricter than
 * `isSettled`, and this gap is load-bearing.
 *
 * Hiding a row and destroying it are not the same decision and must not share a
 * predicate. `isSettled` returns true for a ticked row with NO stamp, because
 * that is how the pre-0029 backlog gets cleared from the display. But since
 * migration 0030 the database guarantees `checked = (checked_at is not null)`,
 * so a ticked row arriving here without a stamp cannot be real data — it can
 * only mean the client failed to READ the column.
 *
 * Which is exactly what happened. `checked_at` was missing from the list
 * fetch's select string, every ticked row came back with `checkedAt: null`,
 * every one of them looked settled, and the sweep deleted them from the server
 * a second after they were ticked. Fifteen rows in one afternoon, permanently,
 * while the purchases they logged survived — so the damage was invisible in
 * Insights and total on the list.
 *
 * So: no stamp, no delete. A row we cannot date stays on the server. The worst
 * case becomes a row that lingers where the user can see and remove it, which
 * is recoverable, instead of one that is gone, which is not.
 */
export function settledIds<T extends Settleable & { id: string }>(
  items: T[],
  now: number,
): string[] {
  return items
    .filter((it) => it.checkedAt != null && isSettled(it, now))
    .map((it) => it.id);
}

/** Lists with their settled items removed. Preserves the identity of every list
 *  that had nothing to sweep, and of the array itself when no list did — so
 *  this can sit between the store's state and its context value without making
 *  every consumer re-render once a day for nothing. */
export function liveLists<L extends { items: T[] }, T extends Settleable>(
  lists: L[],
  now: number,
): L[] {
  let changed = false;
  const next = lists.map((l) => {
    const items = liveItems(l.items, now);
    if (items === l.items) return l;
    changed = true;
    return { ...l, items };
  });
  return changed ? next : lists;
}
