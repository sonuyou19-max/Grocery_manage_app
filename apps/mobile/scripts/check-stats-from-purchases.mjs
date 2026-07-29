/**
 * statsFromPurchases check.
 *
 * This function is the load-bearing beam of the whole "log is the single source
 * of truth" model. If it is wrong, a guest who signs up gets a pantry that
 * predicts subtly differently from one that learned live — and nobody ever
 * notices, because both look plausible. There is no screen that would show the
 * difference.
 *
 * Four properties it has to have:
 *
 *  1. **Replay equals live.** Folding the log must reach exactly the state that
 *     recording the same purchases one at a time would have. This is asserted
 *     directly rather than by reimplementing the EMA, because a second
 *     implementation of the learning rule is the bug it is guarding against.
 *
 *  2. **Order independence.** The log is stored newest-first everywhere in the
 *     app, and the intervals only make sense oldest-first. Feeding it shuffled
 *     input must not change the answer.
 *
 *  3. **Category survives.** It comes off the purchase (migration 0023), with
 *     the injected fallback only for rows written before that column existed.
 *
 *  4. **No decisions are invented.** snoozeUntil, keepStocked, cadenceDays and
 *     archivedAt cannot come from a log of events, and a rebuild that quietly
 *     produced values for them would overwrite a real member's settings.
 *
 * Run with `pnpm --filter mobile check:stats-from-purchases`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'pantry-intel.ts');

// Both imports are type-only and erase.
const source = readFileSync(SRC, 'utf8').replace(/^import type .*;$/gm, '');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${String(expected)}\n  actual   ${String(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
  return ok;
};
const checkTrue = (name, actual) => check(name, actual, true);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-28T12:00:00Z');

let seq = 0;
const buy = (name, daysAgo, category = 'dairy_eggs') => ({
  id: `id-${(seq += 1)}`,
  key: name.toLowerCase(),
  name,
  store: null,
  priceCents: null,
  at: NOW - daysAgo * DAY,
  quantity: null,
  unit: null,
  category,
});

/* ------------------------------------------------------- replay equals live */

// The property that matters most. Build the same history two ways and compare.
const history = [buy('Milk', 28), buy('Milk', 21), buy('Milk', 14), buy('Milk', 7), buy('Milk', 0)];

let live = {};
for (const p of history) live = mod.recordPurchase(live, p.name, p.category, p.at);
const rebuilt = mod.statsFromPurchases(history);

check('replay matches live: intervalDays', rebuilt.milk.intervalDays, live.milk.intervalDays);
check('replay matches live: sampleCount', rebuilt.milk.sampleCount, live.milk.sampleCount);
check(
  'replay matches live: lastPurchasedAt',
  rebuilt.milk.lastPurchasedAt,
  live.milk.lastPurchasedAt,
);
check('replay matches live: category', rebuilt.milk.category, live.milk.category);
check('replay matches live: display', rebuilt.milk.display, live.milk.display);

// A weekly rhythm must actually be learned as roughly weekly, or the deck is
// useless. Not asserted as exactly 7 — the EMA blends — but it must be close.
checkTrue(
  'a 7-day rhythm learns an interval near 7',
  Math.abs(rebuilt.milk.intervalDays - 7) < 0.5,
);
check('four gaps from five purchases', rebuilt.milk.sampleCount, 4);

/* ------------------------------------------------------------ order matters */

// The log is stored NEWEST-first. Handing it over unsorted must not change the
// answer — this is the single line in the function that would silently produce
// negative gaps if it were dropped.
const reversed = [...history].reverse();
check(
  'newest-first input gives the same interval',
  mod.statsFromPurchases(reversed).milk.intervalDays,
  rebuilt.milk.intervalDays,
);
const shuffled = [history[2], history[0], history[4], history[1], history[3]];
check(
  'shuffled input gives the same interval',
  mod.statsFromPurchases(shuffled).milk.intervalDays,
  rebuilt.milk.intervalDays,
);
check(
  'shuffled input gives the same sample count',
  mod.statsFromPurchases(shuffled).milk.sampleCount,
  rebuilt.milk.sampleCount,
);

/* ------------------------------------------------------------------ category */

check('category comes from the purchase', rebuilt.milk.category, 'dairy_eggs');

// Rows written before migration 0023 carry no category; the fallback fills in.
const legacy = [{ ...buy('Bread', 10), category: null }];
check(
  'a null category uses the injected fallback',
  mod.statsFromPurchases(legacy, () => 'bakery').bread.category,
  'bakery',
);
check(
  'with no fallback supplied it is "other", never undefined',
  mod.statsFromPurchases(legacy).bread.category,
  'other',
);
// A later purchase carrying a real category must win over the earlier null.
const mixed = [{ ...buy('Rice', 20), category: null }, buy('Rice', 5, 'pantry')];
check('a later real category wins', mod.statsFromPurchases(mixed).rice.category, 'pantry');

/* ------------------------------------------------- no decisions are invented */

const s = rebuilt.milk;
checkTrue('snoozeUntil is not invented', s.snoozeUntil == null);
checkTrue('keepStocked is not invented', s.keepStocked == null || s.keepStocked === false);
checkTrue('cadenceDays is not invented', s.cadenceDays == null);
checkTrue('archivedAt is not invented', s.archivedAt == null);

/* --------------------------------------------------------------- edge cases */

check('an empty log gives an empty pantry', Object.keys(mod.statsFromPurchases([])).length, 0);

// Two purchases of the same item on the SAME day are one shopping trip, not a
// one-day restock rhythm. recordPurchase already ignores sub-day gaps; the
// rebuild has to inherit that or a double check-off would teach the pantry to
// ask for milk daily.
const sameDay = [buy('Eggs', 3), { ...buy('Eggs', 3), at: NOW - 3 * DAY + 60_000 }];
check('same-day repeats do not create a gap', mod.statsFromPurchases(sameDay).eggs.sampleCount, 0);

// One purchase is history, but not yet a rhythm.
check('a single purchase learns no interval', mod.statsFromPurchases([buy('Tea', 4)]).tea.sampleCount, 0);
checkTrue(
  'a single purchase still records when it happened',
  mod.statsFromPurchases([buy('Tea', 4)]).tea.lastPurchasedAt === NOW - 4 * DAY,
);

// Several items stay independent.
const many = [buy('Milk', 14), buy('Bread', 10), buy('Milk', 7), buy('Bread', 2), buy('Milk', 0)];
const multi = mod.statsFromPurchases(many);
check('two items are two entries', Object.keys(multi).length, 2);
check('milk keeps its own count', multi.milk.sampleCount, 2);
check('bread keeps its own count', multi.bread.sampleCount, 1);

// A blank name cannot become a pantry entry keyed on the empty string.
check(
  'a blank name is skipped',
  Object.keys(mod.statsFromPurchases([{ ...buy('Milk', 1), name: '   ' }])).length,
  0,
);

// Spelling drift: the display follows the most recent purchase, the identity
// does not move.
const spellings = [buy('milk', 10), buy('Milk', 3)];
const drift = mod.statsFromPurchases(spellings);
check('one key despite spelling drift', Object.keys(drift).length, 1);
check('display follows the newest spelling', drift.milk.display, 'Milk');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
