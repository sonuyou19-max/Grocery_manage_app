/**
 * Purchase-migration check.
 *
 * This decides what happens to a guest's shopping history the moment they sign
 * in — and all three ways it can go wrong look identical from the outside:
 *
 *  - **Silently dropped.** The user taps "sign in to keep your insights", and
 *    lands on a tab emptier than the one they left. The worst outcome, because
 *    it makes the feature a lie.
 *  - **Silently duplicated.** Every figure doubles. Nobody reports this as a
 *    bug; they just stop trusting the numbers.
 *  - **Duplicated only for one member.** Two phones in a household disagree,
 *    which is the exact class of bug the transaction-log work already fixed
 *    once.
 *
 * Nothing here has a UI, and the code path runs exactly once per device, so
 * this file is the only place it gets exercised.
 *
 * Run with `pnpm --filter mobile check:purchase-migration`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'purchase-migration.ts');

// The only import is a type, which erases — so no rewriting is needed.
const source = readFileSync(SRC, 'utf8').replace(/^import\s+type\s[^;]*?;/gm, '');
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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-28T12:00:00Z');
const YEAR = 52 * 7 * DAY;

let seq = 0;
const buy = (name, daysAgo, extra = {}) => ({
  id: `id-${(seq += 1)}`,
  key: name.toLowerCase(),
  name,
  store: null,
  priceCents: 100,
  at: NOW - daysAgo * DAY,
  quantity: null,
  unit: null,
  ...extra,
});

const migrate = (local, cloud) => mod.purchasesToMigrate(local, cloud, NOW, YEAR);

/* ------------------------------------------------------- the ordinary cases */

check('an empty local log migrates nothing', migrate([], []).length, 0);

const milk = buy('Milk', 3);
check('a local purchase into an empty household is carried', migrate([milk], []).length, 1);
check('...and it is the same record', migrate([milk], [])[0].id, milk.id);

const bread = buy('Bread', 5);
check('several are carried', migrate([milk, bread], []).length, 2);

/* --------------------------------------------------------------- duplicates */

// The household already has this exact row — a re-run after a partial upload.
check('a row already in the cloud by id is skipped', migrate([milk], [milk]).length, 0);

// Same item, same day, DIFFERENT id and a few hours apart: this is the same
// purchase written by another device whose clock differs. Matching on an exact
// timestamp would let every one of these through as a duplicate.
const milkFromOtherDevice = { ...milk, id: 'other-device', at: milk.at + 5 * 60 * 60 * 1000 };
check(
  'same item, same day, different id and clock is treated as already present',
  migrate([milk], [milkFromOtherDevice]).length,
  0,
);

// A genuinely separate purchase of the same item on a different day must be
// carried — that is the whole point of the transaction model.
check(
  'the same item on a different day IS a separate purchase',
  migrate([milk, buy('Milk', 9)], [milkFromOtherDevice]).length,
  1,
);

// Two local rows for one item on one day collapse to one. The local log can
// hold both when the session window lapsed between them, and uploading both
// would double that day's spend for an item bought once.
const sameDayTwice = [buy('Eggs', 4), buy('Eggs', 4)];
check('two local rows on the same day collapse to one', migrate(sameDayTwice, []).length, 1);

/* ------------------------------------------------------------ the exclusions */

check('a row older than the window is not carried', migrate([buy('Ancient', 400)], []).length, 0);
check('a row just inside the window is carried', migrate([buy('OldButFine', 360)], []).length, 1);

// A future-stamped row is a clock jump, not a purchase. Uploading it puts a
// permanent phantom at the right-hand edge of everyone's spend chart, where it
// can never age out.
check('a far-future row is refused', migrate([buy('Future', -30)], []).length, 0);
// ...but a few hours of clock skew is normal and must not cost a real purchase.
check(
  'a few hours into the future is tolerated',
  migrate([{ ...buy('Skewed', 0), at: NOW + 3 * 60 * 60 * 1000 }], []).length,
  1,
);

check('a row with no key is refused', migrate([{ ...buy('X', 1), key: '' }], []).length, 0);

/* -------------------------------------------------------------- the details */

// Unpriced purchases are real events and must travel too — most shopping in
// this app is unpriced, and dropping them would lose most of the history.
check(
  'an unpriced purchase is carried',
  migrate([buy('Unpriced', 2, { priceCents: null })], []).length,
  1,
);

// Everything that describes the purchase has to survive the trip.
const detailed = buy('Rice', 6, { store: 'aldi', priceCents: 249, quantity: 2, unit: 'kg' });
const carried = migrate([detailed], [])[0];
check('store survives', carried.store, 'aldi');
check('price survives', carried.priceCents, 249);
check('quantity survives', carried.quantity, 2);
check('unit survives', carried.unit, 'kg');
check('timestamp survives', carried.at, detailed.at);

/* ----------------------------------------------------------- the merge shape */

// A household with its own history keeps it; the guest's is added alongside.
const householdHistory = [buy('Pasta', 10), buy('Wine', 12)];
const mine = [buy('Milk', 3), buy('Bread', 5)];
check('nothing of the household is touched', migrate(mine, householdHistory).length, 2);

// Idempotency: running it twice must be a no-op the second time, which is what
// makes a retry after a flaky upload safe.
const first = migrate(mine, householdHistory);
check(
  'a second run after a successful upload carries nothing',
  migrate(mine, [...householdHistory, ...first]).length,
  0,
);

// A partial upload — half landed, then the network died. The retry must carry
// exactly the half that did not.
const partial = [...householdHistory, first[0]];
check('a retry after a partial upload carries only the remainder', migrate(mine, partial).length, 1);
check('...and it is the right one', migrate(mine, partial)[0].id, first[1].id);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
