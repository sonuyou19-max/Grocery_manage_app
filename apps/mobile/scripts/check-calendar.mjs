/**
 * Calendar check — the day maths behind picking a purchase date, and the rules
 * the form that uses it must keep.
 *
 * ---------------------------------------------------------------------------
 * Why this needs a guard of its own
 * ---------------------------------------------------------------------------
 *
 * Every bug in this area is off by exactly one day and shows up on nobody's
 * screen. A purchase filed on the 3rd instead of the 4th looks completely
 * normal in the ledger; it is only the burn rate, computed weeks later out of
 * gaps between dates, that is quietly wrong — and by then there is nothing to
 * trace it back to. So the assertions here are about boundaries: midnight, the
 * end of a month, a leap February, and the day either side of today.
 *
 * The timezone half is why `check:calendar:tz` exists beside `check:calendar`,
 * mirroring what check-purchase-log already does: this file is run under five
 * zones from Kiritimati (+14) to Los Angeles (-8), because a rule that only
 * holds in the zone the author lives in is not a rule.
 *
 * Run with `pnpm --filter mobile check:calendar`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

const load = async (rel) => {
  const source = readFileSync(join(SRC, rel), 'utf8').replace(/^import\s[^;]*?;$/gm, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
};

const mod = await load('lib/calendar.ts');

let failures = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
};

/* ------------------------------------------------------- noon, not midnight */

/*
 * The single most important property in the file. A picked day becomes local
 * NOON, so that every later conversion — a DST hour, a clock a few minutes
 * fast, a row read on a device one zone over — has twelve hours of slack on
 * either side before it can land on the wrong date. Midnight has none.
 */
const picked = mod.dayStamp(2026, 7, 30);
check('a picked day lands at local noon', [
  new Date(picked).getHours(),
  new Date(picked).getMinutes(),
  new Date(picked).getSeconds(),
  new Date(picked).getMilliseconds(),
], [12, 0, 0, 0]);
check('...on the day that was asked for', [
  new Date(picked).getFullYear(),
  new Date(picked).getMonth(),
  new Date(picked).getDate(),
], [2026, 7, 30]);

// The two instants a day boundary is made of. Both belong to the same day, and
// both must come back as its noon — this is what makes "today" a single value
// however early or late somebody opens the form.
const dayStart = new Date(2026, 7, 30, 0, 0, 0, 0).getTime();
const dayEnd = new Date(2026, 7, 30, 23, 59, 59, 999).getTime();
check('the first millisecond of a day reads as that day', mod.noonOn(dayStart), picked);
check('...and so does the last', mod.noonOn(dayEnd), picked);
check('the two ends of a day are the same day', mod.isSameDay(dayStart, dayEnd), true);
check('one millisecond later is not', mod.isSameDay(dayEnd, dayEnd + 1), false);

/* ------------------------------------------------------------------ dayDiff */

/*
 * Counted in calendar days, not elapsed hours. A DST week contains a 23-hour
 * and a 25-hour day, so dividing raw milliseconds gives 6.96 between two
 * Mondays — and Math.floor turns that into six.
 */
check('a day apart is one day', mod.dayDiff(dayStart, dayEnd + 1), 1);
check('the same day is zero, whatever the hour', mod.dayDiff(dayStart, dayEnd), 0);
/*
 * The assertion that bites in EVERY zone, and the reason it is here.
 *
 * Everything below about DST is real and catches raw subtraction — but only
 * when the machine running it observes DST, and `check:all` runs in whatever
 * zone the CI box has, which is UTC. Replacing the whole function with
 * `Math.floor((to - from) / DAY_MS)` passed the entire file under UTC. Found by
 * mutation, which is the only way a hole shaped like that is ever found.
 *
 * 9am to 8am the next morning is 23 hours and one calendar day, in every zone
 * on earth and on every day of the year. Raw subtraction says nought.
 */
check('a morning to the next morning is one day, in any zone',
  mod.dayDiff(new Date(2026, 5, 10, 9, 0).getTime(), new Date(2026, 5, 11, 8, 0).getTime()), 1);
check('...and an evening back to the previous morning is minus one',
  mod.dayDiff(new Date(2026, 5, 11, 21, 0).getTime(), new Date(2026, 5, 10, 9, 0).getTime()), -1);
check('a week is seven', mod.dayDiff(mod.dayStamp(2026, 2, 23), mod.dayStamp(2026, 2, 30)), 7);
// The European clocks go forward on 29 March 2026 and back on 25 October: a
// week spanning each must still be seven days, not 6.96 or 7.04.
check('a week across the spring change is still seven',
  mod.dayDiff(mod.dayStamp(2026, 2, 26), mod.dayStamp(2026, 3, 2)), 7);
check('a week across the autumn change is still seven',
  mod.dayDiff(mod.dayStamp(2026, 9, 22), mod.dayStamp(2026, 9, 29)), 7);
check('the future counts negative', mod.dayDiff(mod.dayStamp(2026, 7, 30), mod.dayStamp(2026, 7, 28)), -2);

/* ---------------------------------------------------------------- addMonths */

check('stepping forward off the end of a year', mod.addMonths(2026, 11, 1), { year: 2027, month: 0 });
check('stepping back off the start of one', mod.addMonths(2026, 0, -1), { year: 2025, month: 11 });
check('a whole year forward', mod.addMonths(2026, 5, 12), { year: 2027, month: 5 });
check('and thirteen back', mod.addMonths(2026, 5, -13), { year: 2025, month: 4 });

/* ---------------------------------------------------------------- monthGrid */

const august = mod.monthGrid(2026, 7);
check('a month is whole weeks', august.length % 7, 0);
check('...covering every day in it', august.filter(Boolean).length, 31);
check('...numbered from one', august.filter(Boolean)[0].day, 1);
check('...to the last', august.filter(Boolean).at(-1).day, 31);

/*
 * Padding is NULL, never the neighbouring month's days. A grid showing 29 July
 * greyed beside 1 August invites a tap on the wrong one, and that mistap is
 * silent: a purchase filed a month out with nothing on screen having looked
 * wrong. Blank cells cannot be mistapped.
 */
check('the pad is blank, not last month', august.slice(0, 5).every((c) => c === null), true);

// 1 August 2026 is a Saturday, so a Monday-first grid leads with five blanks.
check('the month starts on its real weekday', august.findIndex(Boolean), 5);
check('every day in the grid is noon on itself',
  august.filter(Boolean).every((c) => c.ms === mod.noonOn(c.ms)), true);

// February, where a wrong day count is a whole missing day.
check('February 2026 has 28 days', mod.monthGrid(2026, 1).filter(Boolean).length, 28);
check('February 2028 has 29', mod.monthGrid(2028, 1).filter(Boolean).length, 29);
// 1 Feb 2027 is a Monday: no lead at all, which is the case an off-by-one in
// the lead calculation turns into a full blank week.
check('a month starting on Monday has no lead', mod.monthGrid(2027, 1).findIndex(Boolean), 0);

/* ------------------------------------------------------------ the week head */

const heads = mod.weekdayLabels('en');
check('seven column headings', heads.length, 7);
check('...starting on Monday', heads[0], 'M');
check('...and ending on Sunday', heads[6], 'S');

/* ================================================================= the form */

const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sheet = code(readFileSync(join(SRC, 'components', 'purchase-sheet.tsx'), 'utf8'));
const picker = code(readFileSync(join(SRC, 'components', 'day-picker.tsx'), 'utf8'));
const has = (re, text = sheet) => re.test(text);

const assert = (name, ok) => check(name, ok, true);

/*
 * THE FUTURE IS CLOSED.
 *
 * Not dimmed-but-tappable. A purchase dated next Tuesday is not an unusual
 * entry, it is a typo that corrupts arithmetic nothing on screen reports: the
 * burn rate learns a gap that has not elapsed, the item stops coming due, and
 * there is no way back to the cause.
 */
assert('tomorrow cannot be picked', has(/max = Date\.now\(\)/, picker));
assert('...the cells enforce it', has(/disabled=\{blocked\}/, picker));
assert('...and the month arrow stops at the same edge', has(/disabled=\{nextBlocked\}/, picker));
/*
 * The ceiling is a DAY, not an instant. Comparing raw milliseconds would make
 * the rest of today unpickable every morning, because today's cell is noon and
 * at 09:00 that is in the future.
 */
assert('the ceiling is compared by date, not by instant',
  has(/getDate\(\) > ceiling\.getDate\(\)/, picker));

/*
 * ONE MANDATORY FIELD, PRE-ANSWERED. The date is required and starts as today,
 * so no state of this form fails to submit and there is no error to show. What
 * the requirement buys is a day that is visible and editable — not a shopper
 * proving they filled a box in.
 */
assert('the date starts as today', has(/useState\(\(\) => Date\.now\(\)\)/));
assert('...and the quick chips cover the two common answers',
  has(/purchaseSheet\.today/) && has(/purchaseSheet\.yesterday/));
assert('...with the calendar behind them for the rest', has(/<DayPicker/));

/*
 * EVERYTHING ELSE IS OPTIONAL, and that is a statement about what a purchase
 * is: an event at a time. Price, size and shop are things you may not
 * remember, and this app has held since migration 0020 that an unpriced
 * purchase is still a purchase — so `save` must never gate on them.
 */
assert('save is never disabled', !has(/disabled=\{[\s\S]{0,40}(total|priceText|store)/));

/*
 * A fresh form per item. Without it the sheet is a singleton whose fields
 * outlive what they describe: record the price of bread, open milk, and the
 * bread's price is sitting in the field waiting to be saved against it.
 */
assert('the form resets when the item changes', has(/\}, \[openKey\]\);/));

/*
 * The unit is dropped when no number was typed. A lone "kg" describes nothing
 * and the ledger would have to render it as an amount with no amount in it.
 */
assert('a unit with no quantity is not stored',
  has(/unit: parseQuantity\(qtyText, decimal\) == null \? null : unit/));

/*
 * ONE arithmetic, shared with the list's item sheet. It used to be private to
 * that file; a second copy here would be a second thing to fix the next time
 * the reading of a comma changes, and it changed once already.
 */
assert('the total comes from the shared expression', has(/totalFor\(priceText, packs, decimal\)/));
assert('...and the quantity from the shared parser', has(/parseQuantity\(qtyText, decimal\)/));
const itemSheet = code(readFileSync(join(SRC, 'components', 'item-sheet.tsx'), 'utf8'));
assert('...which the item sheet reads from the same place',
  /import \{[\s\S]{0,200}?totalFor,[\s\S]{0,200}?\} from '@\/lib\/purchase-log';/.test(itemSheet));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
