/**
 * When a bought item leaves the list.
 *
 * The rule is one line of prose — "a ticked item settles at the end of the
 * local day it was ticked on" — and every way of getting it wrong deletes
 * something the user can still see, or keeps something they were promised was
 * gone. Neither is recoverable by the user, so the boundary is asserted
 * directly rather than eyeballed on a device.
 *
 * The timezone cases matter more than they look: the boundary is LOCAL
 * midnight, and a helper that reached for UTC would pass every test written at
 * noon in London and clear a 9pm shop instantly in Warsaw. This file is run
 * across several timezones by `check:list-sweep:tz`.
 *
 * Run with `pnpm --filter mobile check:list-sweep`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'list-sweep.ts');

const js = ts.transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let failures = 0;
const check = (title, actual, expected) => {
  if (Object.is(actual, expected)) {
    console.log(`ok   ${title}`);
  } else {
    failures += 1;
    console.log(`FAIL ${title}`);
    console.log(`  expected ${JSON.stringify(expected)}`);
    console.log(`  actual   ${JSON.stringify(actual)}`);
  }
};

console.log(`(TZ=${process.env.TZ ?? 'system'}, offset ${new Date().getTimezoneOffset()}min)\n`);

/* Local-time constructors: `new Date(y, m, d, h)` is local by definition, which
 * is exactly the thing under test. An ISO string would not be. */
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const ticked = (at) => ({ id: 'x', checked: true, checkedAt: at });
const open = { id: 'y', checked: false, checkedAt: null };

const NOON = local(2026, 8, 11, 12);

/* ------------------------------------------------ the boundary itself ------ */

check('ticked an hour ago: stays', mod.isSettled(ticked(local(2026, 8, 11, 11)), NOON), false);
check('ticked at 00:00 today: stays', mod.isSettled(ticked(local(2026, 8, 11, 0)), NOON), false);
check(
  'ticked at 23:59 yesterday: settles',
  mod.isSettled(ticked(local(2026, 8, 10, 23, 59)), NOON),
  true,
);
check('ticked last week: settles', mod.isSettled(ticked(local(2026, 8, 4, 12)), NOON), true);

// The late-night shop: ticked at 23:00, still there at 23:30, gone by morning.
const LATE = local(2026, 8, 10, 23);
check('a 23:00 tick is still there at 23:30', mod.isSettled(ticked(LATE), local(2026, 8, 10, 23, 30)), false);
check('...and gone by 08:00 the next day', mod.isSettled(ticked(LATE), local(2026, 8, 11, 8)), true);

/* ------------------------------------------------ what must never settle --- */

check('an unticked item never settles', mod.isSettled(open, NOON), false);
check(
  'an unticked item with a stale timestamp still never settles',
  mod.isSettled({ id: 'z', checked: false, checkedAt: local(2020, 1, 1, 0) }, NOON),
  false,
);
// A clock that jumped backwards must not sweep something just bought.
check(
  'a tick stamped in the future stays',
  mod.isSettled(ticked(local(2026, 8, 20, 12)), NOON),
  false,
);
// Rows written before checked_at existed: settled, so the backlog clears.
check(
  'a ticked row with no timestamp settles (pre-migration backlog)',
  mod.isSettled({ id: 'w', checked: true, checkedAt: null }, NOON),
  true,
);

/* ------------------------------------------------ the collection helpers --- */

const mixed = [
  { id: 'a', checked: true, checkedAt: local(2026, 8, 10, 18) }, // settles
  { id: 'b', checked: true, checkedAt: local(2026, 8, 11, 9) }, // today, stays
  { id: 'c', checked: false, checkedAt: null }, // stays
];
check('liveItems drops only the settled', mod.liveItems(mixed, NOON).map((i) => i.id).join(','), 'b,c');
check('settledIds names only the settled', mod.settledIds(mixed, NOON).join(','), 'a');

/*
 * Identity preservation is not a micro-optimisation here — this sits between
 * the store's state and its context value, so a fresh array every render would
 * invalidate every memo in every screen that reads a list, once per render,
 * forever.
 */
const nothingToSweep = [mixed[1], mixed[2]];
check('liveItems returns the SAME array when nothing settled', mod.liveItems(nothingToSweep, NOON), nothingToSweep);

const lists = [
  { id: 'l1', items: mixed },
  { id: 'l2', items: nothingToSweep },
];
const swept = mod.liveLists(lists, NOON);
check('liveLists sweeps the list that needed it', swept[0].items.map((i) => i.id).join(','), 'b,c');
check('liveLists leaves the untouched list identical', swept[1], lists[1]);
const cleanOnly = [lists[1]];
check(
  'liveLists returns the SAME array when no list needed sweeping',
  mod.liveLists(cleanOnly, NOON),
  cleanOnly,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
