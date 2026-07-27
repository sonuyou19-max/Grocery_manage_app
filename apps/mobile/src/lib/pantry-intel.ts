import type { ItemCategory } from '@korb/shared';

/**
 * Pantry Vibe Check — the silent learning engine.
 *
 * The app never asks for data: every time an item is checked off a list we log
 * a purchase, and the gap between purchases becomes that item's "burn rate".
 * When an item passes 90% of its expected lifespan it becomes "due" and joins
 * the Vibe Check deck. Swiping teaches the model (see applyStillGood / applyAlmostOut).
 *
 * v1 is device-local (persisted to AsyncStorage by the store). Shared-household
 * stats via the cloud `pantry_items` table are the natural next phase.
 */

const DAY = 24 * 60 * 60 * 1000;

/** When an item reaches this fraction of its lifespan it's flagged as due. */
const DUE_FRACTION = 0.9;

/** Fun stays fast: the deck is capped so it's always a 10-second ritual. */
export const DECK_CAP = 10;

/**
 * Sensible restock intervals (days) per category, so a brand-new user gets a
 * useful Vibe Check on day one. Personal history overrides these as it accrues.
 */
export const DEFAULT_INTERVALS: Record<ItemCategory, number> = {
  fruit_veg: 7,
  dairy_eggs: 7,
  meat_fish: 6,
  bakery: 4,
  pantry: 45,
  frozen: 30,
  drinks: 10,
  household: 45,
  personal_care: 45,
  other: 21,
};

export interface ItemStat {
  /** Normalized name — the stable identity across spellings/casing. */
  key: string;
  /** Most recent display spelling. */
  display: string;
  category: ItemCategory;
  /** Epoch ms of the last logged purchase; 0 before any purchase. */
  lastPurchasedAt: number;
  /** Learned interval in days (EMA of observed gaps); 0 until first sample. */
  intervalDays: number;
  /** How many gaps we've observed — 0 means we're still on the category default. */
  sampleCount: number;
  /** "Still good" pushes this out so the item leaves the deck for a while. */
  snoozeUntil: number | null;
  /**
   * A staple: something the household wants to always have. Doesn't change when
   * the item comes due — only how prominently it's surfaced once it does.
   */
  keepStocked?: boolean;
  /**
   * A user-stated restock interval in days, which overrides whatever we learned.
   * Null/undefined means "keep learning" — the absence of an override, not zero.
   */
  cadenceDays?: number | null;
  /**
   * Resting since this moment, or null/undefined while actively tracked.
   *
   * A resting item keeps all of its history but is not predicted: it's out of
   * the Vibe Check deck, out of Running low and In stock, and out of the weekly
   * list builder. A timestamp rather than a flag because the Pantry shows
   * "Resting since …", which is what tells you whether to bring it back.
   */
  archivedAt?: number | null;
}

/** Retired from prediction — see `archivedAt`. */
export function isResting(stat: ItemStat): boolean {
  return stat.archivedAt != null;
}

export type StatMap = Record<string, ItemStat>;

export interface DeckCard {
  key: string;
  display: string;
  category: ItemCategory;
  /** When it was last bought — rendered to a localized subtitle by the caller. */
  lastPurchasedAt: number;
  /** Marked as a staple, so the card can say so. */
  keepStocked: boolean;
}

export const normalizeKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The interval to predict against, in days, most authoritative first:
 *
 *   1. a cadence the user set — they know their household better than we do;
 *   2. the rate we learned from their own check-offs;
 *   3. the category default, for an item with no history yet.
 *
 * This one function is the whole mechanism behind recurring staples: the due
 * date, the Vibe Check deck, the pantry bar and the weekly list builder all read
 * the interval through here, so a user-set cadence reaches every one of them
 * without any of them knowing the feature exists.
 */
export function effectiveInterval(stat: ItemStat): number {
  if (stat.cadenceDays != null && stat.cadenceDays > 0) return stat.cadenceDays;
  if (stat.sampleCount > 0 && stat.intervalDays > 0) return stat.intervalDays;
  return DEFAULT_INTERVALS[stat.category] ?? DEFAULT_INTERVALS.other;
}

/** Whether the interval came from the user rather than from learning. */
export function hasUserCadence(stat: ItemStat): boolean {
  return stat.cadenceDays != null && stat.cadenceDays > 0;
}

/** Cadence presets offered in the UI, in days. */
export const CADENCE_PRESETS = [3, 7, 14, 30] as const;

/**
 * Mark (or unmark) a staple, and optionally pin its cadence.
 *
 * Setting a cadence clears any active snooze: the user has just told us the
 * interval, and leaving a "still good" snooze in place would suppress the very
 * prediction they came here to correct.
 */
export function applyStaple(
  stats: StatMap,
  key: string,
  patch: { keepStocked?: boolean; cadenceDays?: number | null },
): StatMap {
  const s = stats[key];
  if (!s) return stats;
  const next: ItemStat = { ...s };
  if (patch.keepStocked !== undefined) next.keepStocked = patch.keepStocked;
  if (patch.cadenceDays !== undefined) {
    next.cadenceDays = patch.cadenceDays;
    next.snoozeUntil = null;
  }
  return { ...stats, [key]: next };
}

/**
 * Put an item to rest, or bring it back.
 *
 * Bringing it back restarts the clock (`lastPurchasedAt = now`, snooze cleared)
 * instead of resuming the old one. An item asleep for six months would
 * otherwise wake up wildly overdue and shout on the very first Vibe Check —
 * the opposite of what "bring it back" sounds like. The learned interval and
 * sample count survive untouched, so the rate it had is the rate it resumes
 * with; only the countdown starts fresh.
 */
export function applyResting(
  stats: StatMap,
  key: string,
  resting: boolean,
  now: number = Date.now(),
): StatMap {
  const s = stats[key];
  if (!s) return stats;
  if (resting) return { ...stats, [key]: { ...s, archivedAt: now } };
  return { ...stats, [key]: { ...s, archivedAt: null, lastPurchasedAt: now, snoozeUntil: null } };
}

/** Epoch ms at which the item becomes due (90% of lifespan, respecting snooze). */
export function dueAt(stat: ItemStat): number {
  const base = stat.lastPurchasedAt + DUE_FRACTION * effectiveInterval(stat) * DAY;
  return stat.snoozeUntil ? Math.max(base, stat.snoozeUntil) : base;
}

export function isDue(stat: ItemStat, now: number): boolean {
  // Resting items never come due — that is the whole point of resting, and
  // enforcing it here means every caller inherits it for free.
  if (isResting(stat)) return false;
  return stat.lastPurchasedAt > 0 && now >= dueAt(stat);
}

/** Fraction of an item's lifespan still remaining (1 = just bought, 0 = out). */
export function lifeRemaining(stat: ItemStat, now: number): number {
  if (!stat.lastPurchasedAt) return 1;
  const span = effectiveInterval(stat) * DAY;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - (now - stat.lastPurchasedAt) / span));
}

/** A translate function (from the locale store), passed in so this pure lib
 * stays i18n-agnostic while still producing localized strings. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Short status for a pantry row: learning / ~N days left / running low. */
export function statusLabel(stat: ItemStat, now: number, t: Translate): string {
  if (!stat.lastPurchasedAt) return t('status.learning');
  const days = Math.ceil((dueAt(stat) - now) / DAY);
  if (days <= 0) return t('status.runningLow');
  return t('status.daysLeft', { count: days });
}

/** Human "last bought" label for the card subtitle. */
export function lastBoughtLabel(lastPurchasedAt: number, now: number, t: Translate): string {
  if (!lastPurchasedAt) return t('lastBought.never');
  const days = Math.floor((now - lastPurchasedAt) / DAY);
  if (days <= 0) return t('lastBought.today');
  if (days === 1) return t('lastBought.yesterday');
  if (days < 7) return t('lastBought.days', { count: days });
  if (days < 14) return t('lastBought.weekAgo');
  if (days < 56) return t('lastBought.weeks', { count: Math.round(days / 7) });
  return t('lastBought.months', { count: Math.round(days / 30) });
}

/**
 * Build the capped, urgency-sorted deck. Items already sitting on an active
 * shopping list are excluded — no point reminding you to buy what's queued.
 */
export function buildDeck(stats: StatMap, excludeKeys: Set<string>, now: number): DeckCard[] {
  return (
    Object.values(stats)
      .filter((s) => isDue(s, now) && !excludeKeys.has(s.key))
      .map((s) => ({ stat: s, overdue: now - dueAt(s) }))
      // Staples first, then by how overdue. Running out of something the user
      // explicitly said to always keep is the failure they asked us to prevent,
      // so it outranks a merely-more-overdue incidental item — and the deck is
      // capped, so without this a staple can be pushed off the end entirely.
      .sort((a, b) => {
        const staple = Number(b.stat.keepStocked ?? false) - Number(a.stat.keepStocked ?? false);
        return staple !== 0 ? staple : b.overdue - a.overdue;
      })
      .slice(0, DECK_CAP)
      .map(({ stat }) => ({
        key: stat.key,
        display: stat.display,
        category: stat.category,
        lastPurchasedAt: stat.lastPurchasedAt,
        keepStocked: stat.keepStocked ?? false,
      }))
  );
}

/**
 * Log a purchase (an item was checked off). Establishes/updates the burn rate
 * from the gap since the previous purchase. Same-day repeats are ignored so a
 * check/uncheck/check doesn't distort the rate.
 */
export function recordPurchase(
  stats: StatMap,
  name: string,
  category: ItemCategory,
  now: number = Date.now(),
): StatMap {
  const key = normalizeKey(name);
  if (!key) return stats;
  const prev = stats[key];
  let intervalDays = prev?.intervalDays ?? 0;
  let sampleCount = prev?.sampleCount ?? 0;

  if (prev?.lastPurchasedAt) {
    const gapDays = (now - prev.lastPurchasedAt) / DAY;
    if (gapDays >= 1) {
      // First real gap seeds the rate; later gaps blend in (EMA) so one odd
      // shop doesn't swing it wildly.
      intervalDays = sampleCount === 0 ? gapDays : intervalDays * 0.6 + gapDays * 0.4;
      sampleCount += 1;
    }
  }

  return {
    ...stats,
    [key]: {
      // Spread the previous row first: this runs on *every* check-off, and
      // rebuilding the stat from scratch would silently wipe the user's own
      // settings (staple flag, pinned cadence) the first time they bought the
      // item — the feature quietly undoing itself.
      ...prev,
      key,
      display: name.trim(),
      category,
      lastPurchasedAt: now,
      intervalDays,
      sampleCount,
      snoozeUntil: null,
    },
  };
}

/**
 * Swipe right — "Still Good". The user consumes this slower than we thought:
 * stretch the burn rate and snooze it out of the deck for a few days.
 */
export function applyStillGood(stats: StatMap, key: string, now: number = Date.now()): StatMap {
  const s = stats[key];
  if (!s) return stats;
  const stretched = Math.round(effectiveInterval(s) * 1.15) + 2;
  return {
    ...stats,
    [key]: {
      ...s,
      intervalDays: stretched,
      sampleCount: Math.max(1, s.sampleCount), // this feedback counts as learning
      snoozeUntil: now + 3 * DAY,
    },
  };
}

/**
 * Swipe left — "Almost Out". It's added to the shopping list by the caller.
 * We tighten the rate toward the observed lifespan and snooze it until the
 * eventual re-purchase (check-off) resets the clock.
 */
export function applyAlmostOut(stats: StatMap, key: string, now: number = Date.now()): StatMap {
  const s = stats[key];
  if (!s) return stats;
  const observed = (now - s.lastPurchasedAt) / DAY;
  let intervalDays = s.intervalDays;
  let sampleCount = s.sampleCount;
  if (observed >= 1) {
    intervalDays =
      sampleCount === 0 ? observed : Math.min(effectiveInterval(s), s.intervalDays * 0.6 + observed * 0.4);
    sampleCount = Math.max(1, sampleCount);
  }
  return { ...stats, [key]: { ...s, intervalDays, sampleCount, snoozeUntil: now + 2 * DAY } };
}
