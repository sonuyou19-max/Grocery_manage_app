#!/usr/bin/env node
/**
 * "You usually buy" — the regulars strip on a list.
 *
 * Two halves, guarding two different failures.
 *
 * The RANKING is arithmetic over a purchase log and is the part that can be
 * wrong while looking right: a strip full of plausible items is exactly what a
 * broken cut-off produces. The tie rule especially — "top five" with three
 * items tied on fifth has no honest answer that shows two of them, and the way
 * that regresses is a `.slice(0, 5)` reappearing because it reads as obviously
 * correct.
 *
 * The SELECTION is structural: which items may be candidates at all. That is
 * where the reported bug was, and it was invisible in the arithmetic because
 * the arithmetic never saw the excluded rows.
 *
 * Run with `pnpm --filter mobile check:usual-buys`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const source = readFileSync(join(ROOT, 'src', 'lib', 'usual-buys.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 26);

/** An item with a name, a key and a last-bought stamp. */
const it = (display, boughtDaysAgo = 1) => ({
  key: display.toLowerCase(),
  display,
  lastPurchasedAt: NOW - boughtDaysAgo * DAY,
});
/** `n` purchases of each named item, as the log would hold them. */
const log = (spec) =>
  Object.entries(spec).flatMap(([key, n]) => Array.from({ length: n }, () => ({ key })));

const names = (rows) => rows.map((r) => r.display);
const pick = (items, spec) => names(mod.usualBuys(items, mod.purchaseCounts(log(spec))));

/* ------------------------------------------------------------- the counting */

check('the log is counted per item', [...mod.purchaseCounts(log({ milk: 3, bread: 1 }))], [['milk', 3], ['bread', 1]]);
// A row whose key never got written is not a purchase of anything.
check('a keyless row counts for nothing', [...mod.purchaseCounts([{ key: '' }, { key: 'milk' }])], [['milk', 1]]);

/* ------------------------------------------------------ bought twice, at least */

/*
 * One purchase is a purchase; two is a habit. This is the whole difference
 * between a strip of regulars and a strip of everything ever bought.
 */
check('once is not a regular', pick([it('Saffron')], { saffron: 1 }), []);
check('twice is', pick([it('Milk')], { milk: 2 }), ['Milk']);
check('the threshold is two', mod.USUAL_MIN_BUYS, 2);

/* ---------------------------------------------------------- most bought first */

{
  const items = [it('Milk'), it('Bread'), it('Onion')];
  check(
    'the most bought leads',
    pick(items, { milk: 2, bread: 9, onion: 5 }),
    ['Bread', 'Onion', 'Milk'],
  );
}

/* ------------------------------------------------------------- five, and ties */

{
  // Six regulars, all distinguishable: the sixth is cut.
  const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => it(n));
  check(
    'six regulars become five',
    pick(six, { a: 9, b: 8, c: 7, d: 6, e: 5, f: 4 }),
    ['A', 'B', 'C', 'D', 'E'],
  );
  check('the cut is at five', mod.USUAL_TOP_N, 5);

  /*
   * THE CASE THAT WAS ASKED FOR. Three items tied on the fifth place are the
   * same by the only measure this uses, and showing two of them would dress a
   * coin toss as a ranking. So the cut is on the COUNT, not the position.
   */
  const tied = ['A', 'B', 'C', 'Milk', 'Grapes', 'Potatoes'].map((n) => it(n));
  check(
    'a tie at the cut brings all of them',
    pick(tied, { a: 9, b: 8, c: 7, milk: 4, grapes: 4, potatoes: 4 }).sort(),
    ['A', 'B', 'C', 'Grapes', 'Milk', 'Potatoes'].sort(),
  );
  // And the tie does not drag in anything BELOW it.
  check(
    '...but nothing bought less often',
    pick([...tied, it('Rice')], { a: 9, b: 8, c: 7, milk: 4, grapes: 4, potatoes: 4, rice: 3 }).includes('Rice'),
    false,
  );
  /*
   * A `.slice(0, 5)` reads as obviously correct and is how this regresses, so
   * the shape is asserted directly: everything at the fifth item's count stays.
   */
  check(
    'a whole tied field survives',
    pick(six, { a: 3, b: 3, c: 3, d: 3, e: 3, f: 3 }).length,
    6,
  );
}

/* ------------------------------------------------------------- the order is total */

/*
 * Equal regulars come out most-recently-bought first, then by name. Not for
 * elegance: a strip that reshuffles between renders because two items sort
 * equal looks like a bug in the list, and the chips are tap targets.
 */
{
  const items = [it('Yoghurt', 9), it('Apples', 2)];
  check('equal counts break on recency', pick(items, { yoghurt: 4, apples: 4 }), ['Apples', 'Yoghurt']);
  const same = [it('Pears', 3), it('Beans', 3)];
  check('...then on name', pick(same, { pears: 4, beans: 4 }), ['Beans', 'Pears']);
}

/* --------------------------------------------- what the strip may consider */

{
  const src = strip(readFileSync(join(ROOT, 'src', 'components', 'list-pantry-strip.tsx'), 'utf8'));

  /*
   * THE REPORTED BUG. The exclusion skipped only UNTICKED rows, so a receipt
   * import — which ticks every row it matches and adds the rest already bought
   * — left the strip offering back the bread sitting in "added to pantry" a few
   * centimetres below it.
   */
  check(
    'everything on the list is excluded, ticked or not',
    /const onList = new Set\(list\.items\.map\(\(it\) => normalizeKey\(it\.name\)\)\)/.test(src),
    true,
  );
  check('...with no filter on checked', /list\.items\.filter\(\(it\) => !it\.checked\)/.test(src), false);

  // Ranked by the shared rule, not by a due date.
  check('the strip ranks through usualBuys', /usualBuys\(/.test(src), true);
  check('...on counts from the log', /purchaseCounts\(purchases\)/.test(src), true);
  check('...and no longer sorts by when things come due', /dueAt\(/.test(src), false);

  /*
   * markAlmostOut pulls the learned interval DOWN toward the gap observed so
   * far. That is the right lesson from "I am running out early" and the wrong
   * one from "this is my usual bread" — adding a weekly loaf two days after
   * buying one would teach the model a two-day rhythm, and it would keep it.
   */
  check(
    'adding only teaches almost-out when it is really due',
    /if \(isDue\(item, Date\.now\(\)\)\) markAlmostOut\(item\.key\)/.test(src),
    true,
  );

  // The home-list lens stays: a Weekly list must not offer the pharmacy's items.
  check('the list still filters to its own items', /homeOf\(s\) === list\.id/.test(src), true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
