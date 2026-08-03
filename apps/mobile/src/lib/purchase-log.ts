import type { ItemCategory } from '@korb/shared';

import { normalizeKey } from '@/lib/pantry-intel';

/**
 * Trends over the purchase log — spend across weeks, and whether an item costs
 * more than it used to.
 *
 * Pure and clock-injected, like lib/pantry-intel: the store owns persistence,
 * this owns the maths. Everything here reads a flat list of logged purchases, so
 * it works identically for the cloud table and the on-device mirror.
 *
 * The honesty constraint throughout: **prices are optional in this app.** Most
 * items are never priced, so every figure here is "of what you logged", never
 * "what you spent". Anything that would read as a complete total is either
 * labelled as partial by the caller or not computed at all.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/**
 * One logged purchase — an immutable transaction, not the item's current state.
 *
 * Checking an item off records what was true at that moment. Editing the row on
 * the list afterwards changes the list, never this. Buying the same thing again
 * next week writes a second Purchase; the two coexist, which is what makes
 * "Eggs at Aldi" and "Eggs at Carrefour" separately answerable.
 */
export interface Purchase {
  /**
   * Stable per-transaction identity.
   *
   * Required because a record can be *targeted* after it is written: corrected
   * inside the session window, or removed when a check-off turns out to have
   * been a mistap. Without an id the only way to address a row is by
   * (item, time), which stops being unique the moment two people shop at once.
   */
  id: string;
  /** Normalized item name — the identity across spellings. */
  key: string;
  /** Display spelling as logged. */
  name: string;
  store: string | null;
  /**
   * Null when the item was bought without a price.
   *
   * Pricing is optional in this app and most items never get one, so an
   * unpriced purchase still has to be a transaction — it happened, it belongs
   * in the history, and it feeds the burn-rate model. Only the money figures
   * skip it, and each of them filters explicitly rather than assuming a number.
   */
  priceCents: number | null;
  /** Epoch ms. */
  at: number;
  /** Amount bought, when known — needed to compare like with like. */
  quantity: number | null;
  unit: string | null;
  /**
   * The item's category at the time of purchase.
   *
   * On the log rather than looked up, because the log is the single source of
   * truth the pantry is rebuilt from — and a category the user chose by hand is
   * a decision, which is exactly what a log of events is otherwise bad at
   * keeping. Null on rows written before migration 0023; callers fall back to
   * their own categorisation, which is what they did before the field existed.
   */
  category: ItemCategory | null;
  /**
   * Whether the shopper flagged this purchase as organic or local.
   *
   * On the log for the same reason `category` is: it is a decision the user
   * made about a specific shop, not a property of the item's name, and the
   * eco history is rebuilt from this log after the list it came from is long
   * gone. False on rows written before migration 0027, which is the correct
   * reading — nobody could tick a box that did not exist.
   */
  bio: boolean;
}

/**
 * How long a just-written record stays correctable.
 *
 * Unticking inside this window means "I tapped the wrong row", so the record is
 * deleted rather than left as a purchase the user has to hunt down and clean up
 * later. Outside it, unticking means "we need this again" — a new shopping
 * cycle — and the past transaction stands.
 */
export const MISTAKE_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long an item's most recent record stays *open* to replacement.
 *
 * Mid-aisle corrections — untick, change the quantity, retick — should update
 * the transaction rather than append a second one, or a single trip inflates
 * the week's spend. Two hours comfortably covers one shop without reaching the
 * next one; beyond it a re-tick is a genuinely separate purchase.
 */
export const SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Purchases carrying a price. The only ones any money figure may count. */
export const priced = (purchases: Purchase[]): Purchase[] =>
  purchases.filter((p) => p.priceCents != null);

/**
 * The item's most recent record, if it is still inside `window`.
 *
 * One function serves both time rules — the caller supplies the window, so the
 * 10-minute delete and the 2-hour replace cannot drift apart in how they decide
 * what "most recent" means.
 */
export function recentRecordFor(
  purchases: Purchase[],
  key: string,
  now: number,
  window: number,
): Purchase | null {
  let best: Purchase | null = null;
  for (const p of purchases) {
    if (p.key !== key) continue;
    // Guard against a clock that jumped: a record stamped in the future is not
    // "recent", it is broken, and treating it as open would let it swallow
    // every subsequent purchase of that item.
    if (p.at > now) continue;
    if (now - p.at > window) continue;
    if (!best || p.at > best.at) best = p;
  }
  return best;
}

/* --------------------------------------------------------------- spend trend */

export interface WeekSpend {
  /** Epoch ms of the week's start (local midnight, Monday). */
  weekStart: number;
  cents: number;
  /** How many priced purchases fell in the week — 0 weeks are real, not gaps. */
  count: number;
}

/**
 * Local Monday midnight for a timestamp.
 *
 * Deliberately local rather than UTC: a Sunday-evening shop must land in the
 * week the user experienced it, and in UTC that slips into the next week for
 * anyone east of Greenwich. Monday-start because that is the convention in every
 * locale this app ships in.
 */
export function weekStartOf(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  // getDay() is 0=Sunday; shift so Monday is 0.
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d.getTime();
}

/**
 * Spend per week for the last `weeks` weeks, oldest first, **including weeks
 * with no purchases**. Empty weeks are the informative part of a trend — a gap
 * silently skipped would draw a smooth line through a fortnight you didn't shop.
 */
export function weeklySpend(purchases: Purchase[], now: number, weeks = 8): WeekSpend[] {
  const thisWeek = weekStartOf(now);
  const oldest = thisWeek - (weeks - 1) * WEEK;

  const buckets = new Map<number, { cents: number; count: number }>();
  for (let i = 0; i < weeks; i += 1) {
    // Walk from the oldest week forward via weekStartOf rather than adding a
    // fixed 7×24h, so a DST change doesn't drift the boundaries by an hour.
    buckets.set(weekStartOf(oldest + i * WEEK), { cents: 0, count: 0 });
  }

  for (const p of purchases) {
    // Unpriced purchases are real transactions but contribute no money. Adding
    // them to `count` would make an empty week look active and drag the
    // active-weeks average toward zero.
    if (p.priceCents == null) continue;
    const start = weekStartOf(p.at);
    const bucket = buckets.get(start);
    if (!bucket) continue; // outside the window
    bucket.cents += p.priceCents;
    bucket.count += 1;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, { cents, count }]) => ({ weekStart, cents, count }));
}

export interface SpendTrend {
  weeks: WeekSpend[];
  /** Mean cents/week across weeks that had at least one priced purchase. */
  averageCents: number;
  /** The busiest week in the window, or null when nothing was logged. */
  peak: WeekSpend | null;
  /**
   * Change from the previous complete week to the one before it, as a signed
   * fraction (0.2 = 20% more). Null when either week is empty, because a jump
   * from nothing to something is not a percentage.
   */
  weekOverWeek: number | null;
}

/**
 * Averages over *active* weeks only. Dividing by all 8 weeks would quietly
 * halve the figure for someone who logs prices fortnightly, making the number
 * describe our window rather than their shopping.
 */
export function spendTrend(purchases: Purchase[], now: number, weeks = 8): SpendTrend {
  const series = weeklySpend(purchases, now, weeks);
  const active = series.filter((w) => w.count > 0);
  const averageCents =
    active.length > 0 ? Math.round(active.reduce((sum, w) => sum + w.cents, 0) / active.length) : 0;
  const peak = active.length > 0 ? active.reduce((a, b) => (b.cents > a.cents ? b : a)) : null;

  // Compare the two most recent *complete* weeks. The current week is partial
  // by definition, so including it would report a fall every Monday morning.
  const complete = series.slice(0, -1);
  const last = complete[complete.length - 1];
  const prior = complete[complete.length - 2];
  const weekOverWeek =
    last && prior && last.count > 0 && prior.count > 0 && prior.cents > 0
      ? (last.cents - prior.cents) / prior.cents
      : null;

  return { weeks: series, averageCents, peak, weekOverWeek };
}

/* ------------------------------------------------------------ price movement */

export interface PriceMove {
  key: string;
  name: string;
  /** Most recent unit price, in cents. */
  latestCents: number;
  /** Median unit price of the earlier purchases it's compared against. */
  baselineCents: number;
  /** Signed fraction: 0.25 = a quarter dearer than usual. */
  change: number;
  store: string | null;
  at: number;
  /** How many earlier purchases formed the baseline. */
  samples: number;
}

/** The parts of a purchase that decide whether two prices can be compared. */
export interface Priceable {
  priceCents: number | null;
  quantity: number | null;
  unit: string | null;
}

/**
 * Per-unit price, so €2/1L and €4/2L compare equal.
 *
 * Returns null rather than guessing when the quantity is missing or zero: a
 * price with no amount attached can't be normalized, and silently treating it
 * as a unit price is how "milk doubled!" gets reported for a 2L bottle.
 *
 * Exported, and typed on the structural shape rather than on Purchase, because
 * the cheaper-elsewhere card needs exactly this and used to do without it —
 * comparing €1.20 for 1L at one shop against €2.00 for 2L at another and
 * announcing the first as cheaper. Two cards answering price questions from
 * two different notions of "comparable" is the bug; one definition is the fix.
 */
export function unitPrice(p: Priceable): number | null {
  if (p.priceCents == null) return null;
  if (p.quantity == null) return null;
  if (p.quantity <= 0) return null;
  return p.priceCents / p.quantity;
}

/**
 * Comparable purchases must share a unit as well as a name. Litres against
 * kilos is meaningless, and an unpriced-per-unit entry (no quantity) can only
 * be compared with other entries that also lack one.
 *
 * Shared with price-intel for the same reason as unitPrice above: whether two
 * prices may be set side by side is one question, and it should have one
 * answer wherever it is asked.
 */
export const comparisonBucket = (p: Pick<Priceable, 'unit' | 'quantity'>): string =>
  `${p.unit ?? ''}|${p.quantity == null ? 'flat' : 'unit'}`;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * Items whose latest price differs from what you usually pay.
 *
 * Median, not mean, for the baseline: one multipack or one premium substitute
 * would drag a mean far enough to make the next ordinary purchase look like a
 * saving. Median shrugs those off.
 *
 * Requires `minSamples` earlier purchases in the same unit bucket, so a second
 * ever purchase can't announce a trend.
 */
export function priceMoves(
  purchases: Purchase[],
  { minSamples = 2, threshold = 0.1 }: { minSamples?: number; threshold?: number } = {},
): PriceMove[] {
  const byKey = new Map<string, Purchase[]>();
  for (const p of purchases) {
    if (!p.key || p.priceCents == null) continue;
    const existing = byKey.get(p.key);
    if (existing) existing.push(p);
    else byKey.set(p.key, [p]);
  }

  const moves: PriceMove[] = [];
  for (const [key, all] of byKey) {
    // Newest first, then keep only those comparable with the newest.
    const sorted = [...all].sort((a, b) => b.at - a.at);
    const latest = sorted[0];
    const bucket = comparisonBucket(latest);
    const comparable = sorted.filter((p) => comparisonBucket(p) === bucket);
    if (comparable.length < minSamples + 1) continue;

    const latestUnit = unitPrice(latest) ?? (latest.priceCents as number);
    const earlier = comparable
      .slice(1)
      .map((p) => unitPrice(p) ?? (p.priceCents as number))
      .filter((n) => n > 0);
    if (earlier.length < minSamples) continue;

    const baseline = median(earlier);
    if (baseline <= 0) continue;
    const change = (latestUnit - baseline) / baseline;
    if (Math.abs(change) < threshold) continue;

    moves.push({
      key,
      name: latest.name,
      latestCents: Math.round(latestUnit),
      baselineCents: Math.round(baseline),
      change,
      store: latest.store,
      at: latest.at,
      samples: earlier.length,
    });
  }

  // Biggest movement first — that's what's worth a glance.
  return moves.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/* ------------------------------------------------------------------- history */

/**
 * Every purchase of one item, newest first.
 *
 * This is the whole drill-down: it powers the ledger behind a Pantry item, and
 * it is the only per-item history in the app. Insights briefly had a second
 * one grouped by item-and-store; it was the same data a second time and grew a
 * row per shop, so it's gone.
 *
 * Newest first because it's read as a ledger — the most recent purchase is the
 * one being checked ("did I really pay that much last time?").
 */
export function historyFor(purchases: Purchase[], name: string): Purchase[] {
  const key = normalizeKey(name);
  return purchases.filter((p) => p.key === key).sort((a, b) => b.at - a.at);
}

/** Total logged spend in the window, for the "of what you logged" caveat. */
export function totalLogged(purchases: Purchase[]): { cents: number; count: number } {
  let cents = 0;
  let count = 0;
  for (const p of purchases) {
    if (p.priceCents == null) continue;
    cents += p.priceCents;
    count += 1;
  }
  // `count` is the number of PRICED purchases, not of all of them: it exists to
  // qualify the total ("across 34 priced buys"), and counting unpriced ones
  // there would describe a total they contributed nothing to.
  return { cents, count };
}
