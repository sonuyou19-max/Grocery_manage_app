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
  .replace(/^import\s[^;]*?from '@\/[^']*';/gm, '');

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
  packs: extra.packs ?? 1,
  category: extra.category ?? null,
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
check('...and the same change in money', wow.weekOverWeekCents, 500);
check('no week-over-week without two active weeks', mod.spendTrend([buy('A', 100, '2026-07-15T10:00:00')], now, 4).weekOverWeek, null);

/*
 * THE 5797% CARD.
 *
 * Real numbers off a real screen: a week where one €1,98 item had been logged,
 * followed by a €116,76 shop. The fraction is arithmetically perfect and
 * completely unreadable — nobody parses 5797% as a proportion, and a grocery
 * week is very often not a base worth dividing by. People shop fortnightly, do
 * one big shop and three top-ups, go on holiday.
 *
 * The old guard was `prior.cents > 0`, which 198 cents passes — while the
 * comment directly above it said "a jump from nothing to something is not a
 * percentage". The intent was right and the threshold was at zero.
 *
 * Both figures are computed here and the CARD picks; that split is deliberate,
 * because "which of these reads better" is a question about a sentence and this
 * file is about arithmetic.
 */
const explosive = mod.spendTrend(
  [
    buy('BigShop', 11676, '2026-07-22T10:00:00'),
    buy('OneThing', 198, '2026-07-15T10:00:00'),
  ],
  mondayMorning,
  4,
);
check('a tiny base still yields its fraction', Math.round(explosive.weekOverWeek * 100), 5797);
check(
  '...and the money, which is what the card will show',
  explosive.weekOverWeekCents,
  11478,
);
/*
 * The money is available whenever the two weeks are comparable, INCLUDING when
 * the fraction is not — a week of exactly nothing followed by a shop has no
 * percentage at all, and "€40 more" is still true and still useful.
 */
const fromNothing = mod.spendTrend(
  [buy('Shop', 4000, '2026-07-22T10:00:00'), buy('Nothing', 0, '2026-07-15T10:00:00')],
  mondayMorning,
  4,
);
check('a zero base has no percentage', fromNothing.weekOverWeek, null);
check('...but still has a difference', fromNothing.weekOverWeekCents, 4000);

/*
 * And the CARD makes the choice, which is the half a reader sees. Asserted
 * against the source because the rule is one line of JSX and the way it
 * regresses is somebody simplifying it back to a single branch.
 */
{
  const insights = readFileSync(join(here, '..', 'src', 'app', '(tabs)', 'insights.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const rule = /trend\.weekOverWeek != null && Math\.abs\(trend\.weekOverWeek\) < 3/.test(insights);
  check('the card shows a percentage only up to a quadrupling', rule, true);
  check(
    '...and the money beyond it',
    /insights\.trendUpMoney[\s\S]{0,200}?trendDownMoney/.test(insights),
    true,
  );
  check(
    '...with the row shown whenever there is a difference at all',
    /trend\.weekOverWeekCents != null && \(/.test(insights),
    true,
  );
}
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

/*
 * THE FIGURES ARE QUOTED IN A UNIT SOMEBODY USES.
 *
 * Reported from the app: spinach showed "16% down · €0.01 vs €0.01". The
 * percentage was right and the evidence for it was destroyed — unitPrice
 * answers in cents per whatever `unit` is, and 450g at €2.29 is 0.509 cents per
 * GRAM, which Math.round turns into 1. Both figures became a penny.
 *
 * unitPriceParts had already solved this for the item sheet, which is why the
 * same spinach read "€5.09 / kg" one screen away. The scale is shared now.
 */
{
  const spinach = mod.priceMoves([
    buy('Spinach', 229, '2026-05-12T10:00:00', { quantity: 450, unit: 'g', category: 'fruit_veg' }),
    buy('Spinach', 315, '2026-06-12T10:00:00', { quantity: 450, unit: 'g', category: 'fruit_veg' }),
    buy('Spinach', 229, '2026-08-12T10:00:00', { quantity: 450, unit: 'g', category: 'fruit_veg' }),
  ]);
  check('the reported spinach still reads as a fall', spinach.length, 1);
  check('...at the price the purchase sheet shows', spinach[0].latestCents, 509);
  check('...against a usual price in the same unit', spinach[0].baselineCents, 604);
  check('...quoted per kilo, not per gram', spinach[0].unit, 'kg');
  // The ratio never depended on the scale, and must not start to.
  check('...with the percentage unchanged', Math.round(spinach[0].change * 100), -16);
  // Carried so the card can draw the item's own glyph, as the staples card does.
  check('...carrying its category for the glyph', spinach[0].category, 'fruit_veg');
}

// Millilitres scale the same way; centilitres are a hundred to the litre.
{
  const drink = mod.priceMoves([
    buy('Juice', 100, '2026-05-12T10:00:00', { quantity: 500, unit: 'ml' }),
    buy('Juice', 100, '2026-06-12T10:00:00', { quantity: 500, unit: 'ml' }),
    buy('Juice', 150, '2026-08-12T10:00:00', { quantity: 500, unit: 'ml' }),
  ]);
  check('millilitres are quoted per litre', [drink[0].latestCents, drink[0].unit], [300, 'l']);
}

/*
 * Units that are ALREADY quotable are left alone — scaling a per-kilo price by
 * a thousand would be the same bug pointing the other way.
 */
{
  const meat = mod.priceMoves([
    buy('Beef', 800, '2026-05-12T10:00:00', { quantity: 1, unit: 'kg' }),
    buy('Beef', 800, '2026-06-12T10:00:00', { quantity: 1, unit: 'kg' }),
    buy('Beef', 1000, '2026-08-12T10:00:00', { quantity: 1, unit: 'kg' }),
  ]);
  check('kilos are not scaled again', [meat[0].latestCents, meat[0].unit], [1000, 'kg']);
}

/*
 * And a comparison between whole packs quotes no unit at all. There is no
 * per-unit measure, so "/ kg" would be a claim about an amount nobody recorded.
 */
{
  const flat = mod.priceMoves([
    buy('Pizza', 300, '2026-05-12T10:00:00'),
    buy('Pizza', 300, '2026-06-12T10:00:00'),
    buy('Pizza', 400, '2026-08-12T10:00:00'),
  ]);
  check('a pack-to-pack comparison quotes no unit', [flat[0].latestCents, flat[0].unit], [400, null]);
}

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

/* ------------------------------------------- what an untick is allowed to undo */

/*
 * The reported bug, as tests.
 *
 * "Tick an item, untick it, and it sits in the Pantry under Running low saying
 * bought today." Two causes, and the first only appears after eleven minutes of
 * fiddling, which is why it survived every quick manual check:
 *
 *   - foldPurchase pins `at` to the FIRST tick of a session so a long shop
 *     cannot extend its own window. The delete rule read that same `at`, so the
 *     correction window expired ten minutes after the first tick and could
 *     never reset. Every untick after that silently did nothing.
 *   - and elapsed time is the wrong test anyway when the record is the item's
 *     only one: there is no earlier purchase for this to be a restock of.
 *
 * The restock case is the one that must NOT change, so it is asserted hardest —
 * deleting a real purchase because someone put milk back on the list would
 * quietly rewrite their spend history.
 */
const undoable = (log, now = NOW) =>
  mod.undoableRecordFor(log, 'milk', now, mod.MISTAKE_WINDOW_MS);

const sole = ago(5);
check('a sole purchase, just ticked, is undoable', undoable([sole]) !== null, true);
check(
  'a sole purchase is STILL undoable an hour later — nothing to restock',
  undoable([ago(60)]) !== null,
  true,
);
check(
  'a sole purchase is undoable a day later',
  undoable([ago(60 * 24)]) !== null,
  true,
);

// With history behind it, the time rule applies exactly as before.
const history = { ...buy('Milk', 300, '2026-06-24T10:00:00') };
check(
  'with an earlier purchase, a fresh tick is still undoable',
  undoable([ago(5), history]) !== null,
  true,
);
check(
  'with an earlier purchase, an 11-minute-old tick is a restock and stands',
  undoable([ago(11), history]),
  null,
);

// The regression itself: a re-tick refreshes touchedAt, so the window resets.
const retickedLate = { ...ago(30), touchedAt: NOW - 2 * 60000 };
check(
  'a record re-ticked 2 min ago is undoable even though `at` is 30 min old',
  undoable([retickedLate, history]) !== null,
  true,
);
check(
  '...and `at` is left alone, so the purchase keeps its real time',
  undoable([retickedLate, history]).at,
  NOW - 30 * 60000,
);
const retickedStale = { ...ago(30), touchedAt: NOW - 20 * 60000 };
check(
  'a record last touched 20 min ago is outside the window again',
  undoable([retickedStale, history]),
  null,
);

check('nothing logged, nothing to undo', undoable([]), null);
check(
  'another item is never undone',
  mod.undoableRecordFor([ago(5)], 'bread', NOW, mod.MISTAKE_WINDOW_MS),
  null,
);
check(
  'a future-stamped record is not picked as the latest',
  mod.undoableRecordFor(
    [{ ...ago(0), at: NOW + 60000 }, ago(5)],
    'milk',
    NOW,
    mod.MISTAKE_WINDOW_MS,
  ).at,
  NOW - 5 * 60000,
);

/* --------------------------------------------------------- amountLabel --- */

/*
 * The pack count is the part that kept getting lost, and losing it is not a
 * rounding error — it is a different shopping. `quantity` is the size of ONE
 * pack, so a surface printing it alone says "1 l" about four litres of milk.
 * That is exactly what the purchase ledger did, for every receipt import, with
 * the count sitting in the database the whole time.
 */
{
  const label = mod.amountLabel;
  check('a multipack states its count', label({ quantity: 1, unit: 'l', packs: 4 }), '4 × 1 l');
  check('a single pack does not', label({ quantity: 500, unit: 'g', packs: 1 }), '500 g');
  check('...nor does a missing count', label({ quantity: 500, unit: 'g' }), '500 g');
  check('a counted thing with no size still counts', label({ quantity: null, unit: null, packs: 3 }), '×3');
  check('a size with no unit is just the number', label({ quantity: 6, unit: null, packs: 1 }), '6');
  // One pack of an unmeasured thing is just a thing. "1 ×" beside it would be
  // noise dressed as data.
  check('nothing to say says nothing', label({ quantity: null, unit: null, packs: 1 }), null);
  check('...and a zero size is nothing to say', label({ quantity: 0, unit: 'g', packs: 1 }), null);
  // Rows written before migration 0036 have no packs at all.
  check('a pre-0036 row reads as one pack', label({ quantity: 2, unit: 'kg', packs: null }), '2 kg');
  // A weighed line carries three decimals on the receipt; the label is read at
  // a glance, not audited.
  check('a weighed amount is trimmed', label({ quantity: 1.094, unit: 'kg', packs: 1 }), '1.09 kg');
  check('...without leaving a trailing zero', label({ quantity: 1.5, unit: 'kg', packs: 1 }), '1.5 kg');
  // A count is a count. Nothing should ever print "2.4 ×".
  check('a fractional count is rounded', label({ quantity: 1, unit: 'l', packs: 2.4 }), '2 × 1 l');
}

/* ------------------------------------------------------- unitPriceParts -- */

/*
 * The figure the whole brand/size split was for. A total cannot answer "was
 * that one cheaper" across two pack sizes — €0.89 for 1 L against €1.79 for
 * 1.5 L is not a comparison anybody does in their head.
 *
 * The scaling is the part that was actually broken elsewhere. unitPrice answers
 * in cents per whatever the unit happens to be, and for grams that is a number
 * no shop has ever printed: 500 g at €4.99 is 0.499 cents per gram, which
 * rounds to zero. The item sheet rendered exactly that — "€0.00 each" — for
 * everything sold by weight.
 */
{
  const per = mod.unitPriceParts;
  check('litres are quoted per litre', per({ priceCents: 356, quantity: 1, unit: 'l', packs: 4 }), { cents: 89, unit: 'l' });
  check('grams are quoted per kilo', per({ priceCents: 499, quantity: 500, unit: 'g', packs: 2 }), { cents: 499, unit: 'kg' });
  check('millilitres are quoted per litre', per({ priceCents: 315, quantity: 500, unit: 'ml', packs: 1 }), { cents: 630, unit: 'l' });
  check('centilitres too', per({ priceCents: 165, quantity: 50, unit: 'cl', packs: 1 }), { cents: 330, unit: 'l' });
  check('kilos are already quotable', per({ priceCents: 546, quantity: 1.094, unit: 'kg', packs: 1 }), { cents: 499, unit: 'kg' });
  check('a count is quoted per piece', per({ priceCents: 315, quantity: 6, unit: 'pcs', packs: 1 }), { cents: 53, unit: 'pcs' });

  /*
   * The unscaled bug, stated as the thing it produced: per GRAM, this rounds to
   * nothing. If unitPriceParts ever stops scaling, this is what comes back.
   */
  check('unscaled, the same purchase rounds to nothing', Math.round(mod.unitPrice({ priceCents: 499, quantity: 500, unit: 'g', packs: 2 })), 0);

  // Nothing to divide by, nothing to say.
  check('no price, no figure', per({ priceCents: null, quantity: 500, unit: 'g', packs: 1 }), null);
  check('no quantity, no figure', per({ priceCents: 499, quantity: null, unit: 'g', packs: 1 }), null);
  check('no unit, no figure', per({ priceCents: 499, quantity: 500, unit: null, packs: 1 }), null);
  // A few cents of something sold by the kilo is a rounding artefact, not a
  // comparison, and "€0.00 / kg" beside a real total makes the row look broken.
  check('a figure that rounds to zero is withheld', per({ priceCents: 1, quantity: 900, unit: 'kg', packs: 1 }), null);
}

/* ----------------------------------------- the surfaces that show it ----- */

/*
 * Structural, because the failure this exists to stop was not that the label
 * was wrong — there was no label. Both of these printed `quantity` alone, or
 * nothing at all, while the pack count sat in the database being written on
 * every import.
 */
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ledger = strip(readFileSync(join(here, '..', 'src', 'components', 'purchase-ledger.tsx'), 'utf8'));
  const list = strip(readFileSync(join(here, '..', 'src', 'app', 'list', '[id].tsx'), 'utf8'));

  check('the ledger states the amount through amountLabel', /const amount = amountLabel\(p\)/.test(ledger), true);
  /*
   * Led by the brand. A column of these is scanned for "which one did I buy
   * last time" — the item's own name is already at the top of the sheet, so
   * repeating it per row would spend the loudest line on the one fact the
   * reader arrived knowing.
   */
  check('the brand leads the row', /const headline = brand \?\? desc \?\? dateOf\(p\.at\)/.test(ledger), true);
  check('...with the description under it', /const sub = brand != null \? desc : null/.test(ledger), true);
  /*
   * And a row with neither falls back to exactly what it was before — most of a
   * typical history is purchases logged by ticking, which carry no brand and
   * never will. A placeholder apologising for that would be on most rows.
   */
  check('a row with nothing to say leads with its date', /const named = brand != null \|\| desc != null/.test(ledger), true);
  check('the comparison figure is shown', /const each = unitPriceParts\(p\)/.test(ledger), true);
  check('...in the accent, as the one figure worth it', /styles\.each, \{ color: colors\.accent \}/.test(ledger), true);
  check('...and a count reads "each", not "/ pcs"', /each\.unit === "pcs" \? ` \$\{t\("itemSheet\.each"\)\}`/.test(ledger), true);
  check('...and no longer prints one pack\'s size as the amount', /\{p\.quantity\}/.test(ledger), false);
  // Both fields are read — the headline/sub assertions below say WHERE.
  check('the ledger reads the brand it stores', /const brand = p\.brand\?\.trim\(\)/.test(ledger), true);
  check('...and the description', /const desc = p\.description\?\.trim\(\)/.test(ledger), true);

  check('a ticked list row states its amount', /it\.checked && amountLabel\(it\)/.test(list), true);

  /*
   * "each" means per PACK. The item sheet computed it with unitPrice, which is
   * per unit of MEASURE — right for a litre by luck, and "€0.00 each" for
   * everything sold by weight.
   */
  const sheet = strip(readFileSync(join(here, '..', 'src', 'components', 'item-sheet.tsx'), 'utf8'));
  check(
    'the item sheet divides "each" by the pack count',
    /const each =\s*last\.priceCents != null && last\.packs > 1 \? last\.priceCents \/ last\.packs : null;/.test(sheet),
    true,
  );
  check('...and quotes the shelf figure through unitPriceParts', /const per = unitPriceParts\(last\)/.test(sheet), true);
}

/* ------------------------------------------- every column that is mapped -- */

/*
 * THE BUG THAT HID BEHIND THE OTHER ONE.
 *
 * price_entries.brand and .description are written on every receipt import and
 * were missing from the live read, so they made the round trip and came back as
 * null on the next launch. The ledger could not have shown them however it was
 * written — the data was gone before it got there.
 *
 * What hid it is that a DIFFERENT select, the one-off migration read, has
 * always carried them: the columns were plainly in use, just not by the read
 * that matters. So this asserts the property rather than the string — every
 * field mapPriceRow maps must appear in every select of that table, or the
 * mapping quietly invents nulls.
 */
{
  const store = readFileSync(
    join(here, '..', 'src', 'store', 'pantry-intel.tsx'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const body = store.match(/^interface DbPriceRow \{([\s\S]*?)^\}/m);
  const mapped = body
    ? [...body[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((f) => f[1])
    : [];
  check('DbPriceRow was found', mapped.length > 5, true);

  /*
   * Anchored to the table, not to a column name. Matching any select that
   * mentions item_key swept in pantry_items reads as well, which have every
   * right to a different column list — the assertion then failed on code that
   * was correct, which is the way a guard gets deleted rather than fixed.
   */
  const selects = [...store.matchAll(/from\('price_entries'\)[\s\S]{0,600}?\.select\(\s*'([^']*)'/g)]
    .map((m) => m[1].replace(/\s+/g, ' '));
  check('both price_entries selects were found', selects.length, 2);

  for (const [i, sel] of selects.entries()) {
    const missing = mapped.filter((f) => !sel.split(/\s*,\s*/).includes(f));
    check(`select ${i + 1} carries every mapped column`, missing, []);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
