/**
 * Purchase-log trend check.
 *
 * The failure mode here is quiet and plausible: a week boundary off by a day
 * moves a Sunday shop into next week, a partial current week reports a "fall"
 * every Monday, and a mean baseline lets one multipack announce that milk
 * doubled in price. None of that looks wrong on a chart — it just tells the user
 * something untrue about their own spending. So the boundaries, the
 * active-week averaging, and the unit-price comparison are all asserted
 * directly.
 *
 * Run with `pnpm --filter mobile check:purchase-log`. Exits non-zero on any
 * problem.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'purchase-log.ts');

// Let the real compiler strip the types — hand-rolled regexes choke on things
// like a typed destructured parameter default, and a check that can't load the
// module it's checking is worse than no check.
const source = readFileSync(SRC, 'utf8')
  // The single `@/` import (normalizeKey) can't resolve outside Metro, so drop
  // it and supply the same implementation below.
  .replace(/^import .*from '@\/.*';$/gm, '');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

const prelude = `const normalizeKey = (name) => name.trim().toLowerCase().replace(/\\s+/g, ' ');\n`;
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(prelude + outputText).toString('base64')
);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso).getTime();
const buy = (name, priceCents, iso, extra = {}) => ({
  key: name.trim().toLowerCase(),
  name,
  store: extra.store ?? null,
  priceCents,
  at: at(iso),
  quantity: extra.quantity ?? null,
  unit: extra.unit ?? null,
});

/* ------------------------------------------------------------ week boundaries */

// Monday must map to itself, and every other day back to that Monday.
// 2026-07-20 is a Monday.
const monday = mod.weekStartOf(at('2026-07-20T09:00:00'));
check('Monday maps to itself', mod.weekStartOf(at('2026-07-20T00:00:00')), monday);
for (const [label, iso] of [
  ['Mon 09:00', '2026-07-20T09:00:00'],
  ['Wed noon', '2026-07-22T12:00:00'],
  ['Sat 23:59', '2026-07-25T23:59:00'],
  ['Sun 23:30', '2026-07-26T23:30:00'],
]) {
  check(`${label} -> same Monday`, mod.weekStartOf(at(iso)), monday);
}
// The Sunday-evening trap: a Sunday shop must NOT roll into the next week.
check(
  'Sun 23:30 is not next Monday',
  mod.weekStartOf(at('2026-07-26T23:30:00')) === mod.weekStartOf(at('2026-07-27T09:00:00')),
  false,
);
// Monday 00:00 starts a new bucket.
check(
  'next Monday is a new week',
  mod.weekStartOf(at('2026-07-27T00:00:00')) - monday,
  7 * DAY,
);
// weekStartOf must be idempotent, or bucket keys won't match on lookup.
check('weekStartOf idempotent', mod.weekStartOf(monday), monday);

// Boundaries are local midnight, so the value must be a local-midnight instant.
const mondayDate = new Date(monday);
check(
  'week start is local midnight Monday',
  [mondayDate.getHours(), mondayDate.getMinutes(), mondayDate.getDay()],
  [0, 0, 1],
);

/* --------------------------------------------------------------- weeklySpend */

const now = at('2026-07-22T12:00:00'); // a Wednesday
const series = mod.weeklySpend(
  [
    buy('Milk', 200, '2026-07-22T10:00:00'), // this week
    buy('Bread', 150, '2026-07-21T10:00:00'), // this week
    buy('Cheese', 500, '2026-07-15T10:00:00'), // last week
    buy('Ancient', 999, '2020-01-01T10:00:00'), // outside the window
  ],
  now,
  4,
);
check('weeklySpend returns every week in the window', series.length, 4);
check('weeks are oldest first', series.map((w) => w.weekStart < series[series.length - 1].weekStart ? 1 : 0).slice(0, 3), [1, 1, 1]);
check('current week totals', series[3].cents, 350);
check('current week count', series[3].count, 2);
check('previous week totals', series[2].cents, 500);
check('empty weeks are present with zero', [series[0].cents, series[0].count], [0, 0]);
check('out-of-window purchase excluded', series.reduce((s, w) => s + w.cents, 0), 850);

// Every bucket must be exactly one week apart — the DST-safe stepping check.
const gaps = series.slice(1).map((w, i) => Math.round((w.weekStart - series[i].weekStart) / DAY));
check('buckets are 7 days apart', gaps, [7, 7, 7]);

// Across a real DST transition (EU clocks go back 2026-10-25), buckets must
// still be 7 local days apart, not 7×24h.
const dstSeries = mod.weeklySpend([], at('2026-11-04T12:00:00'), 4);
const dstGaps = dstSeries.slice(1).map((w, i) => Math.round((w.weekStart - dstSeries[i].weekStart) / DAY));
check('buckets stay 7 days across a DST change', dstGaps, [7, 7, 7]);
check(
  'every DST-window bucket is a local Monday midnight',
  dstSeries.every((w) => {
    const d = new Date(w.weekStart);
    return d.getDay() === 1 && d.getHours() === 0;
  }),
  true,
);

/* ---------------------------------------------------------------- spendTrend */

// Average must divide by ACTIVE weeks, not the window: someone who logs
// fortnightly would otherwise see half their real weekly spend.
const fortnightly = mod.spendTrend(
  [buy('A', 1000, '2026-07-15T10:00:00'), buy('B', 1000, '2026-07-01T10:00:00')],
  now,
  4,
);
check('average over active weeks only', fortnightly.averageCents, 1000);
check('peak is the busiest week', fortnightly.peak.cents, 1000);

// The partial-current-week trap: week-over-week must compare the two most
// recent COMPLETE weeks, so a Monday morning doesn't report a collapse.
const mondayMorning = at('2026-07-27T08:00:00');
const wow = mod.spendTrend(
  [
    buy('LastWeek', 1000, '2026-07-22T10:00:00'), // complete week
    buy('WeekBefore', 500, '2026-07-15T10:00:00'), // complete week
    buy('Today', 10, '2026-07-27T07:00:00'), // partial current week
  ],
  mondayMorning,
  4,
);
check('week-over-week ignores the partial current week', wow.weekOverWeek, 1);
check('no week-over-week without two active weeks', mod.spendTrend([buy('A', 100, '2026-07-15T10:00:00')], now, 4).weekOverWeek, null);
check('empty log has no peak', mod.spendTrend([], now, 4).peak, null);
check('empty log averages zero', mod.spendTrend([], now, 4).averageCents, 0);

/* ---------------------------------------------------------------- priceMoves */

// Needs enough history: a second-ever purchase must not announce a trend.
check(
  'two purchases is not a trend',
  mod.priceMoves([buy('Milk', 100, '2026-07-01T10:00:00'), buy('Milk', 200, '2026-07-08T10:00:00')]).length,
  0,
);

// A genuine rise, with 3 prior samples.
const rise = mod.priceMoves([
  buy('Milk', 100, '2026-06-01T10:00:00'),
  buy('Milk', 100, '2026-06-08T10:00:00'),
  buy('Milk', 100, '2026-06-15T10:00:00'),
  buy('Milk', 150, '2026-07-01T10:00:00'),
]);
check('detects a 50% rise', [rise.length, rise[0].change], [1, 0.5]);
check('baseline is the usual price', rise[0].baselineCents, 100);
check('latest price reported', rise[0].latestCents, 150);

// Median baseline: one outlier multipack must not become the baseline.
const withOutlier = mod.priceMoves([
  buy('Rice', 200, '2026-06-01T10:00:00'),
  buy('Rice', 200, '2026-06-08T10:00:00'),
  buy('Rice', 2000, '2026-06-15T10:00:00'), // bulk sack
  buy('Rice', 210, '2026-07-01T10:00:00'),
]);
check('median shrugs off an outlier (no false alarm)', withOutlier.length, 0);

// Small movements are noise, not news.
check(
  'ignores movement under the threshold',
  mod.priceMoves([
    buy('Eggs', 300, '2026-06-01T10:00:00'),
    buy('Eggs', 300, '2026-06-08T10:00:00'),
    buy('Eggs', 300, '2026-06-15T10:00:00'),
    buy('Eggs', 310, '2026-07-01T10:00:00'),
  ]).length,
  0,
);

// Unit prices: €2/1L then €4/2L is the SAME price and must not be flagged.
check(
  'same unit price across different sizes is not a change',
  mod.priceMoves([
    buy('Juice', 200, '2026-06-01T10:00:00', { quantity: 1, unit: 'l' }),
    buy('Juice', 200, '2026-06-08T10:00:00', { quantity: 1, unit: 'l' }),
    buy('Juice', 200, '2026-06-15T10:00:00', { quantity: 1, unit: 'l' }),
    buy('Juice', 400, '2026-07-01T10:00:00', { quantity: 2, unit: 'l' }),
  ]).length,
  0,
);
// ...but a real per-unit rise still is.
const unitRise = mod.priceMoves([
  buy('Juice', 200, '2026-06-01T10:00:00', { quantity: 1, unit: 'l' }),
  buy('Juice', 200, '2026-06-08T10:00:00', { quantity: 1, unit: 'l' }),
  buy('Juice', 200, '2026-06-15T10:00:00', { quantity: 1, unit: 'l' }),
  buy('Juice', 600, '2026-07-01T10:00:00', { quantity: 2, unit: 'l' }),
]);
check('real per-unit rise is flagged', [unitRise.length, unitRise[0].change], [1, 0.5]);

// Mixed units must not be compared: litres vs kilos is meaningless.
check(
  'different units are not compared',
  mod.priceMoves([
    buy('Yoghurt', 100, '2026-06-01T10:00:00', { quantity: 1, unit: 'kg' }),
    buy('Yoghurt', 100, '2026-06-08T10:00:00', { quantity: 1, unit: 'kg' }),
    buy('Yoghurt', 100, '2026-06-15T10:00:00', { quantity: 1, unit: 'kg' }),
    buy('Yoghurt', 500, '2026-07-01T10:00:00', { quantity: 1, unit: 'l' }),
  ]).length,
  0,
);

// A zero/absent quantity must not be treated as a unit price.
check(
  'zero quantity does not divide',
  mod.priceMoves([
    buy('Odd', 100, '2026-06-01T10:00:00', { quantity: 0, unit: 'l' }),
    buy('Odd', 100, '2026-06-08T10:00:00', { quantity: 0, unit: 'l' }),
    buy('Odd', 100, '2026-06-15T10:00:00', { quantity: 0, unit: 'l' }),
    buy('Odd', 100, '2026-07-01T10:00:00', { quantity: 0, unit: 'l' }),
  ]).length,
  0,
);

// Biggest mover sorts first.
const many = mod.priceMoves([
  ...['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => buy('Small', 100, `${d}T10:00:00`)),
  buy('Small', 120, '2026-07-01T10:00:00'),
  ...['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => buy('Big', 100, `${d}T10:00:00`)),
  buy('Big', 300, '2026-07-01T10:00:00'),
]);
check('biggest mover first', many.map((m) => m.name), ['Big', 'Small']);

// A fall is reported as a negative change.
const fall = mod.priceMoves([
  ...['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => buy('Pasta', 200, `${d}T10:00:00`)),
  buy('Pasta', 100, '2026-07-01T10:00:00'),
]);
check('a fall is negative', fall[0].change, -0.5);

/* ------------------------------------------------------------------- history */

const hist = mod.historyFor(
  [buy('Milk', 300, '2026-07-08T10:00:00'), buy('  MILK ', 200, '2026-07-01T10:00:00'), buy('Bread', 100, '2026-07-01T10:00:00')],
  'milk',
);
check('history matches on normalized name', hist.length, 2);
// Newest first, deliberately changed: this feeds the transaction ledger, and a
// ledger is read from the top. The most recent purchase is the one being
// checked against ("did I really pay that much last time?").
check('history is newest first', hist.map((p) => p.priceCents), [300, 200]);
check('totalLogged sums', mod.totalLogged([buy('A', 100, '2026-07-01T10:00:00'), buy('B', 250, '2026-07-02T10:00:00')]), { cents: 350, count: 2 });
check('totalLogged on empty', mod.totalLogged([]), { cents: 0, count: 0 });

/* ------------------------------------------- unpriced purchases are invisible
 * to money, visible to history.
 *
 * Every check-off is now a transaction, and most items are never priced — so
 * the single most likely regression is an unpriced row being counted as zero
 * somewhere and quietly dragging an average down. */

const unpriced = { ...buy('Milk', 0, '2026-07-08T10:00:00'), priceCents: null };
const pricedMilk = buy('Milk', 300, '2026-07-08T10:00:00');
check('totalLogged ignores unpriced', mod.totalLogged([pricedMilk, unpriced]), { cents: 300, count: 1 });
check(
  'weeklySpend does not count an unpriced week as active',
  mod.weeklySpend([unpriced], Date.parse('2026-07-08T10:00:00'), 1)[0].count,
  0,
);
check('history DOES include unpriced', mod.historyFor([unpriced], 'milk').length, 1);
check('priced() filters', mod.priced([pricedMilk, unpriced]).length, 1);

/* ------------------------------------------------- the two correction windows */

const NOW = Date.parse('2026-07-08T12:00:00');
// `at` is already the ISO->epoch helper above; this one builds a purchase N
// minutes in the past.
const ago = (mins) => ({ ...buy('Milk', 300, '2026-07-08T12:00:00'), at: NOW - mins * 60000 });

// The 10-minute mistake window: unticking inside it deletes the record.
check('5 min ago is inside the mistake window',
  mod.recentRecordFor([ago(5)], 'milk', NOW, mod.MISTAKE_WINDOW_MS) !== null, true);
check('11 min ago is outside it',
  mod.recentRecordFor([ago(11)], 'milk', NOW, mod.MISTAKE_WINDOW_MS), null);

// The 2-hour session window: re-ticking inside it replaces rather than appends.
check('90 min ago is inside the session window',
  mod.recentRecordFor([ago(90)], 'milk', NOW, mod.SESSION_WINDOW_MS) !== null, true);
check('3 h ago is a new shopping cycle',
  mod.recentRecordFor([ago(180)], 'milk', NOW, mod.SESSION_WINDOW_MS), null);

check('picks the MOST recent of several',
  mod.recentRecordFor([ago(5), ago(60), ago(90)], 'milk', NOW, mod.SESSION_WINDOW_MS).at, NOW - 5 * 60000);
check('another item is never returned',
  mod.recentRecordFor([ago(5)], 'bread', NOW, mod.SESSION_WINDOW_MS), null);
// A record stamped in the future means a clock jump, not a recent purchase.
// Treating it as open would let it swallow every later buy of that item.
check('a future-stamped record is not "recent"',
  mod.recentRecordFor([{ ...ago(0), at: NOW + 60000 }], 'milk', NOW, mod.SESSION_WINDOW_MS), null);
check('empty log is handled', mod.recentRecordFor([], 'milk', NOW, mod.SESSION_WINDOW_MS), null);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
