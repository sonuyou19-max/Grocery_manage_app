#!/usr/bin/env node
/**
 * The climate swap: which rows a (+) would replace, and which it must not.
 *
 * Every rule here is a decision about somebody's shopping list that they are
 * not looking at while it happens. The screen shows purchases, the edit lands
 * on lists — so a wrong answer is invisible at the moment it is made and shows
 * up later as an item that vanished, or one that was left behind.
 *
 * That asymmetry is why the planner was pulled out of the hook: the judgement
 * is worth testing directly, and a hook reaching into a React context can only
 * be exercised by rendering one.
 *
 * The apply/undo half is not covered here — it writes through the store, which
 * is where the coverage would have to live. What IS covered is the property
 * that makes apply safe: the plan predicts renameItem's refusal exactly, so
 * applying never has to guess.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, '..', 'src', 'lib');

let failures = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) {
    console.log(`  expected ${JSON.stringify(expected)}`);
    console.log(`  actual   ${JSON.stringify(actual)}`);
  }
}

/*
 * The module chain, transpiled and stitched: use-swap-item needs item-dup,
 * which needs item-plural and pantry-intel's normalizeKey, and item-plural
 * needs item-emoji's fold. All of them are pure apart from the hook at the
 * bottom of use-swap-item, whose imports are stripped — planSwapOver is a plain
 * function and does not touch them.
 */
const strip = (file, ...alsoDrop) => {
  let src = readFileSync(join(LIB, file), 'utf8')
    .replace(/^import .*from '@korb\/shared';$/gm, '')
    .replace(/^import type .*$/gm, '');
  for (const spec of alsoDrop) {
    src = src.split('\n').filter((line) => !line.includes(`from '${spec}'`)).join('\n');
  }
  return src;
};

// normalizeKey is all item-dup wants from pantry-intel, and pantry-intel itself
// pulls in the whole prediction engine — so it is lifted out rather than
// imported. If its definition ever moves, the assertion at the bottom of this
// file is what notices.
const pantry = readFileSync(join(LIB, 'pantry-intel.ts'), 'utf8');
const pgSpace = pantry.match(/^const PG_SPACE = .*$/m);
const normalize = pantry.match(/^export const normalizeKey = [\s\S]*?;$/m);
if (!pgSpace || !normalize) {
  console.error('could not lift normalizeKey out of pantry-intel — has it moved?');
  process.exit(1);
}

const source = [
  strip('item-emoji.ts'),
  strip('item-plural.ts', '@/lib/item-emoji'),
  pgSpace[0],
  normalize[0].replace('export const', 'const'),
  strip('item-dup.ts', '@/lib/item-plural', '@/lib/pantry-intel'),
  strip('use-swap-item.ts', '@/lib/item-dup', '@/lib/item-plural', '@/store/groceries', 'react'),
].join('\n');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { planSwapOver } = mod;

/* ------------------------------------------------------------- fixtures */

let seq = 0;
const item = (name, extra = {}) => ({
  id: `i${(seq += 1)}`,
  name,
  category: 'other',
  quantity: null,
  unit: null,
  priceCents: null,
  store: null,
  packs: 1,
  checked: false,
  checkedAt: null,
  claimedBy: null,
  claimedAt: null,
  bio: false,
  ...extra,
});
const list = (name, items) => ({ id: `l-${name}`, name, store: null, items });

const plan = (lists, from = 'Beef', to = 'Lentils') =>
  planSwapOver(lists, from, to, 'pantry');

const names = (p) => p.targets.map((t) => `${t.listName}:${t.item.name}`);

/* ----------------------------------------------------- what gets replaced */

check(
  'an open row on one list is a target',
  names(plan([list('Weekly', [item('Beef'), item('Bread')])])),
  ['Weekly:Beef'],
);

check(
  'no match anywhere is an empty plan — the common case',
  names(plan([list('Weekly', [item('Bread')])])),
  [],
);

check(
  'no lists at all is an empty plan, not a crash',
  names(plan([])),
  [],
);

/*
 * The one that would be a real bug: a ticked row is a purchase that already
 * happened. Rewriting it would put a lie in the list, and the purchase log has
 * recorded the truth regardless.
 */
check(
  'a ticked row is never a target',
  names(plan([list('Weekly', [item('Beef', { checked: true, checkedAt: 1 })])])),
  [],
);

check(
  'ticked and open rows of the same item: only the open one',
  names(
    plan([
      list('Weekly', [item('Beef', { checked: true, checkedAt: 1 }), item('Beef ')]),
    ]),
  ),
  ['Weekly:Beef '],
);

/* --------------------------------------------------------- across lists */

check(
  'every list holding it is a target',
  names(
    plan([
      list('Weekly', [item('Beef')]),
      list('Aldi', [item('Beef')]),
      list('Empty', [item('Bread')]),
    ]),
  ),
  ['Weekly:Beef', 'Aldi:Beef'],
);

/*
 * Two plural variants can sit on one list — the unique index is per key and
 * "Potato"/"Potatoes" are two keys. Replacing one and leaving the other would
 * be the worst of both answers.
 */
check(
  'plural variants on one list are both targets',
  names(plan([list('Weekly', [item('Potato'), item('Potatoes')])], 'Potatoes', 'Beans')),
  ['Weekly:Potato', 'Weekly:Potatoes'],
);

check(
  'the heavy hitter matches a row spelled in the other number',
  names(plan([list('Weekly', [item('Potatoes')])], 'Potato', 'Beans')),
  ['Weekly:Potatoes'],
);

check(
  'and matching ignores case and surrounding space',
  names(plan([list('Weekly', [item('  BEEF ')])])),
  ['Weekly:  BEEF '],
);

/* ------------------------------------------- the replacement already there */

/*
 * This is the property that lets applySwap stop guessing. renameItem refuses a
 * collision with ANY row, ticked included, while the database index only covers
 * open ones — so the plan has to look at the whole list, or apply would attempt
 * a rename it cannot make.
 */
check(
  'an OPEN replacement means delete rather than rename',
  plan([list('Weekly', [item('Beef'), item('Lentils')])]).targets.map((t) => t.replacementPresent),
  [true],
);

check(
  'a TICKED replacement counts too — that is what renameItem refuses',
  plan([
    list('Weekly', [item('Beef'), item('Lentils', { checked: true, checkedAt: 1 })]),
  ]).targets.map((t) => t.replacementPresent),
  [true],
);

check(
  'a plural of the replacement counts as present',
  plan([list('Weekly', [item('Beef'), item('Lentil')])]).targets.map((t) => t.replacementPresent),
  [true],
);

check(
  'no replacement present means rename',
  plan([list('Weekly', [item('Beef')])]).targets.map((t) => t.replacementPresent),
  [false],
);

check(
  'presence is judged per list, not globally',
  plan([
    list('Weekly', [item('Beef'), item('Lentils')]),
    list('Aldi', [item('Beef')]),
  ]).targets.map((t) => `${t.listName}:${t.replacementPresent}`),
  ['Weekly:true', 'Aldi:false'],
);

/* -------------------------------------------------------------- claims */

check(
  'a row claimed by a member is reported',
  plan([list('Weekly', [item('Beef', { claimedBy: 'u2', claimedAt: 1 })])]).claimedByOthers.map(
    (t) => t.item.claimedBy,
  ),
  ['u2'],
);

check(
  'unclaimed rows report nothing',
  plan([list('Weekly', [item('Beef')])]).claimedByOthers,
  [],
);

/* ------------------------------------------------- the plan changes nothing */

/*
 * Planning runs before the confirmation, so it must be safe to run on a tap the
 * user then cancels.
 */
{
  const lists = [list('Weekly', [item('Beef'), item('Bread')])];
  const before = JSON.stringify(lists);
  plan(lists);
  check('planning mutates nothing', JSON.stringify(lists), before);
}

/* ------------------------------------------ the harness is still wired up */

// Same reasoning as check-item-plural's: patterns that quietly stop matching
// report a clean run forever. If the stitching above ever silently produced a
// planner that finds nothing, every "empty" expectation would pass.
check(
  'the planner still finds anything at all',
  plan([list('Weekly', [item('Beef')])]).targets.length > 0,
  true,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
