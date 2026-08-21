import type { ItemCategory } from '@korb/shared';

// Type-only, so the cycle with purchase-log (which imports normalizeKey from
// here) erases at compile time and never exists at runtime.
import type { Purchase } from '@/lib/purchase-log';

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
   * When the user said they had stopped buying this, or null while it is
   * tracked normally.
   *
   * The FIELD is still called archivedAt because it is a database column
   * (pantry_items.archived_at) and renaming it would be a migration for a word.
   * The concept it carries is "Stopped buying" everywhere the user can see it;
   * `hasStopped` is the predicate to read it through.
   *
   * A resting item keeps all of its history but is not predicted: it's out of
   * the Vibe Check deck, out of Running low and In stock, and out of the weekly
   * list builder. A timestamp rather than a flag because the Pantry shows
   * "Resting since …", which is what tells you whether to bring it back.
   */
  archivedAt?: number | null;
  /**
   * The list this item belongs on, shared across the household (migration
   * 0037), or null when nobody has homed it yet.
   *
   * Undefined and null mean the same thing to every reader — "ask" — but they
   * arrive differently: undefined is a stat built by a client that predates the
   * column, null is the database saying it does not know. Neither is worth
   * distinguishing at a call site, so both fall back to lib/item-home-list.
   */
  homeList?: string | null;
}

/** Retired from prediction — see `archivedAt`. */
export function hasStopped(stat: ItemStat): boolean {
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

/**
 * Whitespace, as POSTGRES defines it — which is not what JavaScript does.
 *
 * `item_key` on list_items is a generated column using `[[:space:]]`, and that
 * resolves through glibc's iswspace, which is false for every NON-BREAKING
 * space. JavaScript's `\s` is true for all of them. Measured against a real
 * Postgres 16, the two classes agree on every whitespace codepoint except
 * exactly four:
 *
 *   U+00A0 no-break space          U+2007 figure space
 *   U+202F narrow no-break space   U+FEFF zero-width no-break space (BOM)
 *
 * Using `\s` here therefore made the client normalise MORE than the database:
 * a name pasted from a web page — where U+00A0 is everywhere, and the recipe
 * importer takes pasted text by design — read as one item to the pantry and a
 * different one to the unique index. This class is `\s` minus those four, so
 * both sides now answer identically.
 *
 * Which behaviour is nicer is a separate question: collapsing a no-break space
 * would let pasted text match typed text, and that would be an improvement.
 * It also means changing a generated column and rewriting the table, so it is
 * not this. Agreeing is the property that prevents silent failures; agreeing on
 * the prettier rule is an upgrade on top of it.
 *
 * check-item-identity asserts the boundary, so a future edit that reintroduces
 * `\s` fails rather than drifting.
 */
const PG_SPACE = /[\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/g;

export const normalizeKey = (name: string): string =>
  name.replace(PG_SPACE, ' ').replace(/^ +| +$/g, '').toLowerCase();

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
 * "I've stopped buying this", and the way back from it.
 *
 * Resuming restarts the clock (`lastPurchasedAt = now`, snooze cleared) instead
 * of picking up the old one. An item stopped six months ago would otherwise
 * come back wildly overdue and shout on the very first Vibe Check — the
 * opposite of what resuming sounds like. The learned interval and sample count
 * survive untouched, so the rate it had is the rate it resumes with; only the
 * countdown starts fresh.
 *
 * This is the manual door. The other one is recordPurchase, which clears the
 * flag on its own when the item is bought again — and refuses the long gap for
 * exactly the reason above. Two doors, one behaviour.
 *
 * ---------------------------------------------------------------------------
 * `restartClock: false` is for undo, and it is not the same as resuming
 * ---------------------------------------------------------------------------
 *
 * Resuming is a decision: you are buying this again, so the countdown should
 * start from now. Undo is the opposite — you did not mean to press the button,
 * and the item should go back to exactly what it was a second ago. Restarting
 * the clock there would quietly destroy the one thing the stop was supposed to
 * preserve, which is when you last bought it, and it would do so on the tap the
 * user reached for to prevent any change at all.
 *
 * So the toast's Undo passes false and nothing else does. The default is the
 * decision, because that is what every deliberate caller means.
 */
export function applyStopped(
  stats: StatMap,
  key: string,
  stopped: boolean,
  now: number = Date.now(),
  options: { restartClock?: boolean } = {},
): StatMap {
  const s = stats[key];
  if (!s) return stats;
  if (stopped) return { ...stats, [key]: { ...s, archivedAt: now } };
  if (options.restartClock === false) return { ...stats, [key]: { ...s, archivedAt: null } };
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
  if (hasStopped(stat)) return false;
  return stat.lastPurchasedAt > 0 && now >= dueAt(stat);
}

/** Fraction of an item's lifespan still remaining (1 = just bought, 0 = out). */
/**
 * Below this fraction of an item's usual interval, it counts as running low.
 *
 * Lived in the Pantry screen as a local constant until the recipe importer
 * needed the same judgement — and a second copy of a threshold is how two
 * screens end up disagreeing about whether you have garlic. One number, one
 * home, both callers.
 */
export const LOW_THRESHOLD = 0.35;

export function lifeRemaining(stat: ItemStat, now: number): number {
  if (!stat.lastPurchasedAt) return 1;
  const span = effectiveInterval(stat) * DAY;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - (now - stat.lastPurchasedAt) / span));
}

/**
 * Is this item running low?
 *
 * Being on a shopping list counts, and that is the whole subtlety. Putting
 * something on a list IS the user saying they are running out, so the Pantry
 * counts it as low even when the burn-rate maths has not caught up yet.
 *
 * The Vibe Check deck does the opposite and EXCLUDES queued items, because
 * there is nothing left to decide about something already on a list. Both
 * rules are right for their screen, and the two numbers legitimately differ.
 *
 * They live here together so that difference stays deliberate. It has already
 * caused one bug: the dashboard said "nothing running low yet" while the Pantry
 * said "15 running low", because the dashboard was reading the deck's count and
 * describing it in the Pantry's words.
 */
export function isLowStat(stat: ItemStat, queued: Set<string>, now: number): boolean {
  return queued.has(stat.key) || lifeRemaining(stat, now) < LOW_THRESHOLD;
}

/**
 * The two numbers the Pantry header shows, computed the way the Pantry shows
 * them: resting items excluded, queued items counted as low.
 *
 * Exported so the dashboard can describe the same state without re-deriving it
 * — see the bug in isLowStat above.
 */
export function pantryCounts(
  stats: StatMap,
  queued: Set<string>,
  now: number,
): { tracked: number; low: number } {
  const active = Object.values(stats).filter((s) => !hasStopped(s));
  return {
    tracked: active.length,
    low: active.filter((s) => isLowStat(s, queued, now)).length,
  };
}

/** The two fields the queue rule below reads. Structural, so both the store's
 *  Item and any list-shaped row can be passed without adapting either. */
export interface QueueableItem {
  name: string;
  checked: boolean;
}

/**
 * Items the user has said they need — the keys the Pantry treats as running low
 * regardless of what the model predicts.
 *
 * ---------------------------------------------------------------------------
 * Why a tick beats an untick, across all lists
 * ---------------------------------------------------------------------------
 *
 * Putting something on a list IS the user saying they are low on it, so an
 * unticked row is a statement of need and the model should not argue with it.
 * Deriving that from the lists rather than storing a flag means every add path
 * agrees for free — pantry swipe, Vibe Check, typing it straight in.
 *
 * But the first version only looked at unticked rows, and one item can sit on
 * two lists. Ticking gnocchi off the weekly shop while the same gnocchi is
 * still unticked on a recipe list left the Pantry insisting it was running low
 * on something bought ten minutes earlier — the row read "On a list · Last
 * bought today · ~7 days left" with a full green bar, three statements that
 * cannot all be advice.
 *
 * A tick is the later statement and the more concrete one: the unticked row is
 * a plan, the ticked row is a purchase. So a tick ANYWHERE cancels the queue
 * signal for that item, and the model — which now knows about the purchase —
 * takes over.
 *
 * This is only sound because the lists passed in are the SWEPT ones (see
 * lib/list-sweep): a ticked row that survives the sweep was ticked today, so
 * "ticked somewhere" really does mean "bought today". Yesterday's ticks are
 * already gone, and an item genuinely needed again gets unticked or re-added,
 * which puts it straight back here.
 */
/**
 * The lists that currently hold an item, in the order the lists are given.
 *
 * Ticked rows count. A bought item has not left the list — it sits in the
 * "added to pantry" section at its foot until the day ends — and the question
 * this answers is "where does this live", not "do I still need it". The Pantry
 * uses it to tag an item with its lists, which is a navigation aid, not advice.
 *
 * Matched with normalizeKey for the usual reason: the pantry is keyed by it, so
 * anything comparing raw names would miss "Olive  oil" against "olive oil" and
 * quietly show no tag on exactly the items whose duplicates are most confusing.
 */
export function listsHolding<
  L extends { items: readonly { name: string }[] },
>(lists: readonly L[], key: string): L[] {
  return lists.filter((l) => l.items.some((it) => normalizeKey(it.name) === key));
}

export function queuedKeys(
  lists: readonly { items: readonly QueueableItem[] }[],
): Set<string> {
  const wanted = new Set<string>();
  const bought = new Set<string>();
  for (const list of lists) {
    for (const item of list.items) {
      (item.checked ? bought : wanted).add(normalizeKey(item.name));
    }
  }
  for (const key of bought) wanted.delete(key);
  return wanted;
}

/** A translate function (from the locale store), passed in so this pure lib
 * stays i18n-agnostic while still producing localized strings. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Short status for a pantry row: learning / ~N days left / due now / N over.
 *
 * ---------------------------------------------------------------------------
 * Why this no longer says "Running low"
 * ---------------------------------------------------------------------------
 *
 * It used to, and inside a section already headed "Running low" that read as
 * the app contradicting itself: the section is drawn from LOW_THRESHOLD (0.35
 * of the lifespan remaining) and this line from DUE_FRACTION (0.9 elapsed), so
 * between 65% and 90% a row sat under "Running low" saying "~2 days left",
 * and past 90% it sat under "Running low" saying "Running low".
 *
 * The instinct is to make the two numbers one number. That would be wrong —
 * they answer different questions and both answers are used elsewhere:
 *
 *   LOW_THRESHOLD  "should I flag this?"  — the section, the bar's colour, and
 *                  the recipe importer deciding whether you have enough garlic.
 *   DUE_FRACTION   "should I ASK about this?" — the Vibe Check deck, the list
 *                  screen's suggestions, the recap's what's-coming-up.
 *
 * Collapsing them means either flooding the deck with things that are merely
 * getting low, or waiting until 90% to colour the bar. The contradiction was
 * never in the thresholds; it was in this function borrowing the section's
 * words. A row now states its own urgency, which is information the header does
 * not already carry.
 */
export function statusLabel(stat: ItemStat, now: number, t: Translate): string {
  if (!stat.lastPurchasedAt) return t('status.learning');
  const days = Math.ceil((dueAt(stat) - now) / DAY);
  if (days > 0) return t('status.daysLeft', { count: days });
  // `days` is 0 for anything from exactly due to 23 hours past — Math.ceil of a
  // small negative is -0, and -0 === 0. "Due now" is right for all of it.
  if (days === 0) return t('status.dueNow');
  return t('status.daysOver', { count: -days });
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
 * How much one shop is allowed to move the learned interval.
 *
 * ---------------------------------------------------------------------------
 * What was wrong with a flat EMA
 * ---------------------------------------------------------------------------
 *
 * The rate used to be `interval * 0.6 + gap * 0.4` on every purchase, forever.
 * Two problems, and they are opposite ends of the same missing idea:
 *
 *   No damping. The fiftieth shop moved the estimate exactly as hard as the
 *   second, though by then the app has fifty observations and the shop has one.
 *
 *   No ceiling. A fortnight away from home is a 21-day gap on a 7-day item, and
 *   it is indistinguishable, in a single number, from "we now buy milk
 *   fortnightly". The old rule believed it immediately: 7 days became 12.6, and
 *   the item then went quiet for a week and a half at exactly the moment the
 *   user came home and needed milk.
 *
 * ---------------------------------------------------------------------------
 * The two mechanisms
 * ---------------------------------------------------------------------------
 *
 * `alpha` decays with the sample count — 1/(n+1), which is a running mean while
 * evidence is scarce — and stops decaying at ALPHA_FLOOR so a household whose
 * rhythm genuinely changes is never permanently anchored to its old one.
 *
 * `MAX_STEP` caps how far a single gap may drag the estimate, as a fraction of
 * the estimate itself.
 *
 * ---------------------------------------------------------------------------
 * Why the two constants are equal, which is not a coincidence
 * ---------------------------------------------------------------------------
 *
 * The step is `(gap - interval) * alpha`, so the cap binds when
 * `gap > interval * (1 + MAX_STEP / alpha)`. With MAX_STEP === ALPHA_FLOOR that
 * is exactly `gap > 2 * interval`, which is the rule in one sentence:
 *
 *     no single shop may count as more than a doubling.
 *
 * And it only ever binds UPWARD. A gap cannot be less than zero, so a
 * shorter-than-usual gap moves the estimate by at most `alpha * interval` on
 * its own — always inside the cap. That asymmetry is the right one and is worth
 * stating plainly: a long gap is ambiguous (we did not need it, or we were not
 * home, or we forgot), while a short gap is not — you actually bought the
 * thing sooner. So long gaps are capped and short gaps are believed.
 *
 * Measured over the scenarios in check-pantry-intel: one holiday now moves a
 * 7-day item to 8.8 days instead of 12.6, while a genuine move to a fortnight
 * still converges — six shops gets it to 12.8 against the old rule's 13.7.
 * Nearly all of the noise removed for almost none of the responsiveness.
 */
const ALPHA_FLOOR = 0.25;
const MAX_STEP = 0.25;

export function blendInterval(interval: number, gapDays: number, sampleCount: number): number {
  const alpha = Math.max(ALPHA_FLOOR, 1 / (sampleCount + 1));
  const target = interval * (1 - alpha) + gapDays * alpha;
  const cap = interval * MAX_STEP;
  return Math.min(interval + cap, Math.max(interval - cap, target));
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

  /*
   * Buying it again is how a stopped item comes back.
   *
   * "I've stopped buying this" is a statement about intent, and the purchase
   * contradicts it — so there is nothing to ask and nothing to tap. The flag is
   * cleared below, on the same write that records the purchase.
   *
   * The gap is deliberately NOT learned, which is the half that would go wrong
   * silently. An item stopped in March and bought again in December produces a
   * nine-month gap, and blending that into the burn rate would tell the app you
   * buy this once a year — from one purchase, permanently, with no way for the
   * user to see why their milk stopped being predicted. applyStopped's wake
   * path has refused that gap since it was written, for exactly this reason;
   * the automatic return has to refuse it too or the two doors into the same
   * state behave differently.
   *
   * What survives is the rate it had before it stopped, which is the best
   * available guess and the one a user who resumes an old staple would expect.
   */
  const returning = prev?.archivedAt != null;

  if (!returning && prev?.lastPurchasedAt) {
    const gapDays = (now - prev.lastPurchasedAt) / DAY;
    if (gapDays >= 1) {
      if (sampleCount === 0) {
        // Nothing to blend with. The first real gap IS the estimate.
        intervalDays = gapDays;
      } else {
        intervalDays = blendInterval(intervalDays, gapDays, sampleCount);
      }
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
      // Unconditional, not `returning ? null : prev.archivedAt`: the spread
      // above carries the old value forward, and this is the one line that
      // brings the item back into every count it was hidden from.
      archivedAt: null,
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

/**
 * Rebuild the whole pantry model from a purchase log.
 *
 * This is what lets the log be the single source of truth. Restock cadence
 * stops being state that has to be migrated, merged or reconciled and becomes a
 * computation: hand over the purchases, get the pantry back. A guest who signs
 * up brings a year of shopping and their pantry appears fully formed, rather
 * than starting to learn from zero on the day they created an account.
 *
 * ---------------------------------------------------------------------------
 * It replays rather than recalculates
 * ---------------------------------------------------------------------------
 *
 * The intervals could be computed directly — sort the gaps, blend them — but
 * that would be a SECOND implementation of the learning rule, and the two would
 * drift the first time either was tuned. A household rebuilt from its log would
 * then predict differently from one that learned live, and nobody would ever
 * notice because both look plausible. So this folds recordPurchase over the
 * purchases in order, which is by construction the same answer live recording
 * would have reached.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately cannot reproduce
 * ---------------------------------------------------------------------------
 *
 * snoozeUntil, keepStocked, cadenceDays and archivedAt are absent from the
 * result, and that is correct rather than a limitation. Those are DECISIONS —
 * "still good", "always keep this", "every 14 days", "stop asking" — not
 * purchase events, and no log of events can contain them. They exist only for
 * users who reached the Pantry controls, which is exactly the surface an
 * account unlocks. A rebuild therefore never destroys one, because a rebuild
 * only happens for someone who could not have set any.
 *
 * The caller must still merge rather than overwrite when a row already exists
 * — another member's decisions are none of this function's business.
 *
 * @param categoryFor fallback for purchases logged before migration 0023, which
 *        carry no category of their own. Injected rather than imported so this
 *        module stays pure and the check script can run it.
 */
export function statsFromPurchases(
  purchases: Purchase[],
  categoryFor: (name: string) => ItemCategory = () => 'other',
): StatMap {
  // Oldest first: recordPurchase measures each gap against the previous
  // purchase it has seen, so out-of-order input would produce negative gaps
  // and a nonsense rate. The log is stored newest-first everywhere else, which
  // makes this sort the single most important line in the function.
  const chronological = [...purchases].sort((a, b) => a.at - b.at);
  let stats: StatMap = {};
  for (const p of chronological) {
    if (!p.name?.trim()) continue;
    stats = recordPurchase(stats, p.name, p.category ?? categoryFor(p.name), p.at);
  }
  return stats;
}

/**
 * Undo one item's purchase, rebuilding its stat from what is left of the log.
 *
 * Ticking an item does two things — it writes a transaction AND it moves the
 * item's burn rate on. Unticking within the mistake window undid only the
 * first, so the pantry went on insisting the item was bought today: it appeared
 * under Running low, "on a list", and "Last bought today" simultaneously, which
 * is three statements that cannot all be true.
 *
 * The stat cannot simply be decremented, because the interval is an EMA — there
 * is no arithmetic that removes one sample from it. So this replays the item's
 * REMAINING purchases through the same learning code, which is by construction
 * the state it would have been in had the mistaken tick never happened.
 *
 * Only that one item is rebuilt. Replaying the whole pantry on every untick
 * would be work proportional to a year of shopping for a correction that
 * touches one row.
 *
 * @param remaining the log AFTER the mistaken purchase was removed
 */
export function revertPurchase(
  stats: StatMap,
  key: string,
  remaining: Purchase[],
  categoryFor?: (name: string) => ItemCategory,
): StatMap {
  const prev = stats[key];
  if (!prev) return stats;

  const mine = remaining.filter((p) => p.key === key);
  if (mine.length === 0) {
    // That was its only purchase, so the item was created BY the mistake.
    // Removing it restores exactly the state before the tick — leaving it with
    // lastPurchasedAt 0 would keep a ghost row in the pantry that can never
    // come due and that the user never asked to track.
    const { [key]: _gone, ...rest } = stats;
    return rest;
  }

  const rebuilt = statsFromPurchases(mine, categoryFor)[key];
  if (!rebuilt) return stats;
  // Spread the previous row first so the user's own settings survive — a staple
  // flag or a pinned cadence is not a consequence of the purchase being undone.
  return { ...stats, [key]: { ...prev, ...rebuilt } };
}
