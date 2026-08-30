/**
 * Days, as a calendar reads them.
 *
 * ---------------------------------------------------------------------------
 * A picked day becomes local NOON, never local midnight
 * ---------------------------------------------------------------------------
 *
 * Everything downstream of a purchase stores an instant — `Purchase.at`, the
 * `recorded_at` column, the burn-rate gaps — while what the shopper picked was
 * a DAY. Turning one into the other is where days get lost, and midnight is the
 * worst possible choice of instant to do it at, because it is the boundary
 * itself: an hour of DST, a phone whose clock is a few minutes fast, a row
 * written on one device and read on another in a neighbouring zone, and a
 * purchase made on the 4th is filed on the 3rd. Noon is twelve hours from
 * either edge, which is more slack than any of those can produce.
 *
 * `check-purchase-log:tz` runs the log's own tests under five zones from
 * Kiritimati to Los Angeles for the same reason. This is that discipline
 * applied at the point the timestamp is MINTED rather than only where it is
 * read.
 *
 * ---------------------------------------------------------------------------
 * Local, deliberately
 * ---------------------------------------------------------------------------
 *
 * Every function here reads the device's own zone rather than UTC. That is
 * correct for this app and not a shortcut: shopping happens where the shopper
 * is, and "yesterday" means the day they lived through, not the day it was in
 * Greenwich. A user who flies somewhere is better served by their new local
 * calendar than by the one they packed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monday.
 *
 * Not a field on `Region` beside `decimal`, and this is the one place worth
 * saying why: every one of the twenty countries Korb ships in starts its week
 * on a Monday, so a per-region column would be twenty identical values — noise
 * that reads as a decision each time it is copied. `decimal` earned its column
 * because the countries genuinely disagree (Switzerland writes a point among
 * neighbours who write commas). The day this list gains a country that starts
 * on a Sunday, this constant becomes that field.
 */
export const WEEK_STARTS_ON = 1;

/** One day in the month grid. */
export interface DayCell {
  /** Local noon on this day — see the note at the top of this file. */
  ms: number;
  /** Day of the month, 1-based, for the label. */
  day: number;
}

/** The instant a picked day becomes. `month` is 0-based, like `Date`. */
export function dayStamp(year: number, month: number, day: number): number {
  return new Date(year, month, day, 12, 0, 0, 0).getTime();
}

/** Local noon on whichever day contains `ms`. */
export function noonOn(ms: number): number {
  const d = new Date(ms);
  return dayStamp(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whether two instants fall on the same local day. */
export function isSameDay(a: number, b: number): boolean {
  return noonOn(a) === noonOn(b);
}

/**
 * Whole calendar days from `from` to `to`, counting day boundaries rather than
 * elapsed hours.
 *
 * Both ends are pulled to noon first, so a DST week — which contains a 23-hour
 * and a 25-hour day — still counts seven days between two Mondays. Dividing raw
 * milliseconds would give 6.96 and 7.04, and `Math.floor` turns the first of
 * those into six.
 */
export function dayDiff(from: number, to: number): number {
  return Math.round((noonOn(to) - noonOn(from)) / DAY_MS);
}

/** Step a (year, month) pair by whole months, carrying across the year. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * One month as rows of seven, padded with nulls to the week boundary.
 *
 * Nulls rather than the neighbouring months' days. A grid that shows the 29th
 * of August greyed out beside the 1st of September invites a tap on the wrong
 * one, and the tap that misses is silent — you get a purchase filed a month off
 * with nothing on screen having looked wrong. Blank cells cannot be mistapped.
 */
export function monthGrid(year: number, month: number): (DayCell | null)[] {
  const lead = (new Date(year, month, 1).getDay() - WEEK_STARTS_ON + 7) % 7;
  // Day 0 of the NEXT month is the last day of this one — the standard trick,
  // and the only one that gets February right in a leap year without a table.
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push({ ms: dayStamp(year, month, d), day: d });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * The seven column headings, in the reader's own language and starting on the
 * app's first weekday.
 *
 * Built by formatting real dates rather than from a table of strings: a table
 * would need seven entries in each of seven locales, all of them the kind of
 * thing that gets copied wrong once and stays wrong. The first week of January
 * 2024 began on a Monday, so it is a fixed run of seven consecutive days to
 * point the formatter at.
 */
export function weekdayLabels(language: string): string[] {
  const fmt = new Intl.DateTimeFormat(language, { weekday: 'narrow' });
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    out.push(fmt.format(new Date(2024, 0, 1 + ((i + WEEK_STARTS_ON - 1 + 7) % 7))));
  }
  return out;
}

/** "August 2026", in the reader's own language. */
export function monthLabel(year: number, month: number, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1),
  );
}

/** "Saturday, 30 August", in the reader's own language. */
export function longDayLabel(ms: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(ms));
}
