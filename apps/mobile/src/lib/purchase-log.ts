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
  /** The size of ONE pack, when known — needed to compare like with like. */
  quantity: number | null;
  /**
   * How many packs were bought (migration 0036). Defaults to 1 for every row
   * written before it existed, which is what makes those rows' unit prices
   * identical under the new formula — see unitPrice below.
   */
  packs: number;
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
  /**
   * The manufacturer, when a receipt named one (migration 0038). Null on
   * everything logged by hand, which is nearly all of it.
   *
   * Kept on the purchase and deliberately out of `key`. See the column comment:
   * a brand inside item identity fragments one item's history into one per
   * brand, and a brand switch silently resets the burn rate.
   */
  brand?: string | null;
  /**
   * What the receipt called it, expanded (migration 0039). Null on anything
   * logged by hand.
   *
   * The purchase is filed under the shopper's own word — "Coffee" — so this is
   * the only surviving record that the coffee was a 200g dessert glass. Beside
   * `brand`, and out of the name for the same reason.
   */
  description?: string | null;
  /**
   * When this record was last written to, as opposed to when the purchase
   * happened. Absent on anything loaded from the server or from an older
   * cache; callers fall back to `at`.
   *
   * These are the same number until a re-tick, and the gap between them is a
   * bug this field exists to close. `foldPurchase` deliberately PINS `at` to
   * the first tick of a session, so a long shop cannot keep pushing its own
   * window forward. But the delete rule was reading the same `at`, which meant
   * the correction window ran out ten minutes after the FIRST tick and never
   * reset — so on the eleventh minute of tapping a row on and off, the record
   * became permanently un-undoable and the item stuck in the pantry.
   *
   * Splitting them lets each rule read the clock it actually meant: `at` is
   * when the shopping happened, `touchedAt` is when the user last touched it.
   */
  touchedAt?: number;
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

/**
 * The record an untick should DELETE, or null if the untick means "we need this
 * again" and the purchase stands.
 *
 * ---------------------------------------------------------------------------
 * Why this is not just recentRecordFor with the mistake window
 * ---------------------------------------------------------------------------
 *
 * It was, and it had two holes that produced the same visible bug: an item you
 * never bought sitting in the Pantry, labelled "bought today" and filed under
 * Running low — running low because unticking put it back on a list, and
 * bought today because the tick that created it was never undone.
 *
 *   1. The clock. `recentRecordFor` measures from `at`, which foldPurchase pins
 *      to the first tick of the session. Tap a row on and off past the ten
 *      minute mark and every untick from then on is outside a window that can
 *      no longer reset. `touchedAt` is the clock the user is actually acting
 *      against, so the window measures from the last tick.
 *
 *   2. The history. Elapsed time is the wrong question when the record is the
 *      only one the item has. An item bought every week, unticked three days
 *      later, is a restock and its history must survive — that rule is why the
 *      window exists and it is kept. An item with no other purchase has no
 *      history to protect: the tick is the entire reason it is in the pantry
 *      at all, so undoing the tick has to undo the item. Ten minutes or an
 *      hour, "I tapped this and then untapped it" cannot be a shopping cycle
 *      when there is no earlier cycle to be the second half of.
 *
 * Sole-purchase items are therefore undoable for as long as they stay ticked,
 * and everything else keeps the time rule exactly as it was.
 */
export function undoableRecordFor(
  purchases: Purchase[],
  key: string,
  now: number,
  window: number,
): Purchase | null {
  let latest: Purchase | null = null;
  let countForKey = 0;
  for (const p of purchases) {
    if (p.key !== key) continue;
    countForKey += 1;
    // Same jumped-clock guard as recentRecordFor, for the same reason.
    if (p.at > now) continue;
    if (!latest || p.at > latest.at) latest = p;
  }
  if (!latest) return null;
  if (countForKey === 1) return latest;
  return now - (latest.touchedAt ?? latest.at) <= window ? latest : null;
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
  /**
   * Most recent unit price, in cents, scaled to a unit somebody would quote.
   *
   * Scaled is the operative word. This used to be cents per whatever `unit`
   * happened to be, and for grams that is a number no shop has printed: 450g of
   * spinach at €2.29 is 0.509 cents per gram, which rounds to 1 — so a real 16%
   * fall was reported as "€0.01 vs €0.01". The percentage was right the whole
   * time, because it is computed before the rounding; only the evidence for it
   * was destroyed.
   */
  latestCents: number;
  /** Median of the earlier purchases, in the same scaled unit. */
  baselineCents: number;
  /**
   * What those cents are per — 'kg', 'l', 'pcs' — or null when the comparison
   * is between whole packs and there is no per-unit measure to quote.
   */
  unit: string | null;
  /**
   * The category at the time of purchase, carried so the card can draw the
   * item's own glyph rather than a generic one — the same thing the staples
   * card does. "Spinach" has a leaf of its own; fruit_veg's fallback is also a
   * leaf, and telling the two apart needs the category.
   */
  category: ItemCategory | null;
  /** Signed fraction: 0.25 = a quarter dearer than usual. */
  change: number;
  store: string | null;
  at: number;
  /** How many earlier purchases formed the baseline. */
  samples: number;
}

/** The parts of a purchase that decide whether two prices can be compared. */
export interface Priceable {
  /** The TOTAL paid, across every pack. Not the shelf price of one. */
  priceCents: number | null;
  /** The size of ONE pack — the number on the label. */
  quantity: number | null;
  unit: string | null;
  /**
   * How many packs. Optional on the type and treated as 1 when absent, because
   * this shape is read from rows written before migration 0036 and from callers
   * that legitimately have no count (a flat price with no size at all).
   */
  packs?: number | null;
}

/**
 * How much was bought, as a person would write it: "4 × 1 l", "500 g", "×3".
 *
 * The pack COUNT is the part that kept getting lost. `quantity` is the size of
 * one pack — the number on the label — so a row showing it alone says "1 l"
 * about four litres of milk, which is not a rounding error but a different
 * shopping. Every surface that showed an amount was doing exactly that: the
 * purchase ledger printed `quantity` and `unit` and nothing else, so a receipt
 * line reading "4 X 1L DLL VOLLE MELK" arrived in the history as "1 l".
 *
 * Numerals and "×" rather than words, deliberately. This is read in seven
 * languages and there is no sentence here to translate — "4 × 1 l" means the
 * same thing in all of them, where "4 packs" would need a plural rule per
 * locale to say something a multiplication sign already says.
 *
 * Null when there is genuinely nothing to say: one pack of an unmeasured thing
 * is just "a thing", and printing "1 ×" beside it would be noise dressed as
 * data.
 */
export function amountLabel(p: Pick<Priceable, 'quantity' | 'unit' | 'packs'>): string | null {
  const packs = p.packs != null && p.packs > 0 ? Math.round(p.packs) : 1;
  const size =
    p.quantity != null && p.quantity > 0
      ? `${Number(p.quantity.toFixed(2))}${p.unit ? ` ${p.unit}` : ''}`
      : null;
  if (packs > 1) return size ? `${packs} × ${size}` : `×${packs}`;
  return size;
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
  /*
   * quantity is ONE pack's size, so the total amount bought is quantity × packs
   * — four 250 ml pots is a litre, and its unit price is the total paid divided
   * by that litre, not by 250 ml. Getting this wrong by leaving packs out would
   * report the cream as four times its real price per ml.
   *
   * Absent or malformed packs falls back to 1, which reproduces the pre-0036
   * formula exactly. That is what keeps every row written before this existed
   * comparable with every row written after it.
   */
  const packs = p.packs != null && p.packs > 0 ? p.packs : 1;
  return p.priceCents / (p.quantity * packs);
}

/**
 * The price per unit, scaled to a unit somebody would actually quote.
 *
 * `unitPrice` above answers in cents per whatever `unit` happens to be, and for
 * grams and millilitres that is a number no shop has ever printed: 500 g of
 * toast at €4.99 is 0.499 cents per gram, which rounds to zero and renders as
 * "€0.00". The item sheet was doing exactly that.
 *
 * So grams become kilos and millilitres become litres, which is how the price
 * is written on the shelf edge and therefore the only form worth comparing
 * against it.
 *
 * This is the figure the whole brand/size split was for. "Is this one cheaper"
 * cannot be answered from a total — €0.89 for 1 L and €1.79 for 1.5 L is not a
 * comparison anybody does in their head — and it is the one number a history of
 * one item can put side by side down a column.
 *
 * Returns the parts rather than a string: the cents have to go through the
 * locale's own money(), and a unit is not a sentence.
 */
export interface UnitPriceParts {
  cents: number;
  /** 'kg', 'l', or whatever was measured — 'pcs' means per piece. */
  unit: string;
}

/**
 * How to turn a per-unit price into one somebody would quote.
 *
 * Only the sub-units need it; kg, l and pcs are already quotable. Shared rather
 * than written twice, because the two callers are the item sheet's history and
 * the insights tab's price-change card, and they had drifted: the sheet scaled
 * and the card did not, so the same spinach read "€5.09 / kg" in one place and
 * "€0.01" in the other.
 */
const QUOTABLE: Record<string, { factor: number; unit: string }> = {
  g: { factor: 1000, unit: 'kg' },
  ml: { factor: 1000, unit: 'l' },
  cl: { factor: 100, unit: 'l' },
};

export function quotableScale(unit: string | null): { factor: number; unit: string | null } {
  if (!unit) return { factor: 1, unit: null };
  const scaled = QUOTABLE[unit];
  return scaled ? scaled : { factor: 1, unit };
}

export function unitPriceParts(p: Priceable): UnitPriceParts | null {
  const per = unitPrice(p);
  if (per == null || !p.unit) return null;
  const scaled = quotableScale(p.unit);
  const cents = Math.round(per * scaled.factor);
  /*
   * Nothing useful left to say. A unit price that rounds to zero even after
   * scaling — a few cents of something sold by the kilo — is not a comparison,
   * it is a rounding artefact, and printing "€0.00 / kg" beside a real total
   * makes the whole row look wrong.
   */
  if (cents <= 0) return null;
  return { cents, unit: scaled.unit ?? p.unit };
}

/**
 * What the shopper actually hands over: the shelf price of one pack times how
 * many of them.
 *
 * The entry flow asks for the per-pack price because that is the number printed
 * on the label and on the receipt line, and doing the multiplication in the
 * shopper's head at the shelf is the specific thing this feature exists to
 * remove. Storage keeps the total, so nothing downstream has to know a pack
 * count existed.
 */
export function totalCents(perPackCents: number, packs: number): number {
  if (!Number.isFinite(perPackCents) || perPackCents < 0) return 0;
  const n = Number.isFinite(packs) && packs > 0 ? Math.floor(packs) : 1;
  return Math.round(perPackCents * n);
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

    /*
     * Scaled for DISPLAY only, and after `change` has been computed — the ratio
     * is unaffected by the scale, and computing it from rounded cents is what
     * would make a 16% fall look like no change at all.
     *
     * The unit comes from the latest purchase, which is safe because
     * comparisonBucket has already required every comparable purchase to share
     * it: litres are never being averaged against kilos here.
     */
    const scale = quotableScale(latest.quantity == null ? null : latest.unit);

    moves.push({
      key,
      name: latest.name,
      latestCents: Math.round(latestUnit * scale.factor),
      baselineCents: Math.round(baseline * scale.factor),
      unit: scale.unit,
      category: latest.category,
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
