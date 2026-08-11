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
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};
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

/* ============ the invariant the database now enforces (migration 0030) ==== */

/*
 * `checked` and `checked_at` must be written together. A row where they
 * disagree is not cosmetic: `isSettled` treats a ticked row with no stamp as
 * settled, so such a row vanishes from the list the instant it is read — the
 * user ticks an item and watches it disappear instead of moving to the section
 * below.
 *
 * Postgres rejects it since 0030. That is the real defence; this exists so the
 * failure surfaces here rather than as a rejected write on someone's phone,
 * and because the constraint cannot see the LOCAL backend at all — that one has
 * no database, and a signed-out user's lists live entirely in AsyncStorage.
 */
const { readdirSync, statSync } = await import('node:fs');
const SRC_DIR = join(here, '..', 'src');
const MIGRATIONS = join(here, '..', '..', '..', 'supabase', 'migrations');

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const storeSrc = walk(SRC_DIR)
  .filter((f) => f.includes('store'))
  .map((f) => ({ name: f.split('/').pop(), src: strip(readFileSync(f, 'utf8')) }));

/*
 * Object literals passed to a supabase write. If one names either column it
 * must name both — `{ checked: next }` alone is the exact shape that produced
 * the state 0030 forbids.
 */
const lone = [];
for (const f of storeSrc) {
  for (const m of f.src.matchAll(/\.(?:update|insert|upsert)\(\s*\{([^{}]*)\}/g)) {
    // The closing brace is re-attached: a property written last has nothing
    // after it inside the capture, so `{ checked }` would otherwise match
    // NEITHER test and the two would agree at false — a check that passes by
    // seeing nothing at all.
    const body = m[1] + '}';
    const hasCol = /\bchecked\s*[,:}]/.test(body);
    const hasStamp = /\bchecked_at\s*[,:}]/.test(body);
    if (hasCol !== hasStamp) {
      lone.push(`${f.name}: { ${body.trim().replace(/\s+/g, ' ').slice(0, 70)} }`);
    }
  }
}
if (lone.length) {
  fail('a supabase write sets one of checked / checked_at without the other', [
    ...lone.map((l) => `  ${l}`),
    'Migration 0030 rejects the resulting row, so this write fails on device.',
    'Set both in the same statement — see store/groceries.tsx toggleItem.',
  ]);
} else {
  console.log('ok   every write sets checked and checked_at together');
}

// The same pairing in the LOCAL backend, which no constraint can reach.
const loneLocal = [];
for (const f of storeSrc) {
  for (const m of f.src.matchAll(/\{\s*\.\.\.it,([^{}]*)\}/g)) {
    const body = m[1] + '}'; // see above
    if (/\bchecked\s*[,:}]/.test(body) !== /\bcheckedAt\s*[,:}]/.test(body)) {
      loneLocal.push(`${f.name}: { ...it,${body.trim().replace(/\s+/g, ' ').slice(0, 60)} }`);
    }
  }
}
if (loneLocal.length) {
  fail('a local-state update sets one of checked / checkedAt without the other', [
    ...loneLocal.map((l) => `  ${l}`),
    'Signed out there is no database to catch this, and isSettled reads a',
    'ticked row with no stamp as settled — the item disappears on tick.',
  ]);
} else {
  console.log('ok   ...and so does every local-state update');
}

/*
 * The sign-in transfer must sweep before it uploads. A ticked item cached by a
 * build older than 0029 carries no stamp at all, and mapping it straight across
 * produces exactly the row 0030 rejects — failing the whole upsert, which is
 * the user's offline lists.
 */
const groceries = storeSrc.find((f) => f.name === 'groceries.tsx');
if (!groceries) {
  fail('store/groceries.tsx is missing');
} else if (!/liveLists\(\s*local\s*,/.test(groceries.src)) {
  fail('the sign-in transfer no longer sweeps before uploading', [
    'migrateLocalLists must map from liveLists(local, …), not from `local`.',
    'An unswept ticked row with no checkedAt violates migration 0030 and takes',
    "the whole transfer down with it — and that transfer is the user's lists.",
  ]);
} else {
  console.log('ok   the sign-in transfer sweeps before uploading');
}

const constraint = readdirSync(MIGRATIONS)
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');
if (!/check\s*\(\s*checked\s*=\s*\(\s*checked_at is not null\s*\)\s*\)/i.test(constraint)) {
  fail('no migration declares the checked / checked_at invariant', [
    'The checks above are a courtesy; the constraint is the guarantee. Losing',
    'it means the two columns can disagree again on any path nobody scanned.',
  ]);
} else {
  console.log('ok   a migration still declares the invariant to Postgres');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
