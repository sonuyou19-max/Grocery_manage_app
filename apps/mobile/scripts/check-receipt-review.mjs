/**
 * The decisions a shopper makes about a scanned receipt.
 *
 * Every rule here decides where money lands, and every one of them fails
 * silently — a price on the wrong row of a list looks exactly like a price on
 * the right row, and it goes on poisoning that item's comparisons for as long
 * as the history is kept.
 *
 * The one worth stating outright is `assign`. One list row can be claimed once;
 * the offline matcher enforces that, the edge function enforces it again, and
 * it has to hold HERE too, where a person is doing the assigning and the
 * obvious implementation quietly breaks it. Setting this line's itemId without
 * releasing the line that held it turns "not that one, this one" into two
 * receipt lines both claiming to be the eggs.
 *
 * Run with `pnpm --filter mobile check:receipt-review`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, detail = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const d of detail) console.log(`  ${d}`);
};
const eq = (what, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(what);
  else fail(what, [`expected ${JSON.stringify(expected)}`, `actual   ${JSON.stringify(actual)}`]);
};
const assert = (cond, what, detail) => (cond ? ok(what) : fail(what, detail ? [detail] : []));

/*
 * receipt-review's only import is a type-only one, so stripping it leaves a
 * module that stands on its own — which is the reason the decision rules live
 * in a lib and not in the screen.
 */
const source = readFileSync(join(SRC, 'lib', 'receipt-review.ts'), 'utf8').replace(
  /^import type .*$/gm,
  '',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const {
  assign,
  groupPurchases,
  includedCount,
  includedTotal,
  initialDecisions,
  pickerOptions,
  setInclude,
  setPrice,
  unclaimed,
} = mod;

/* --------------------------------------------------------------- fixtures */

const buy = (key, name, priceCents) => ({
  key, name, raw: [name.toUpperCase()], expanded: null, translated: null,
  brand: null, section: null, packs: 1, quantity: null, unit: null,
  priceCents, emoji: null, category: 'other', confidence: 'high',
});

const PURCHASES = [
  buy('a', 'eggs', 299),
  buy('b', 'milk', 129),
  buy('c', 'bin bags', 249),
];

const LIST = [
  { id: 'i1', name: 'Eggs', category: 'other' },
  { id: 'i2', name: 'Milk', category: 'dairy' },
  { id: 'i3', name: 'Bread', category: 'bakery' },
];

const MATCHES = new Map([
  ['a', { kind: 'matched', itemId: 'i1', how: 'exact' }],
  ['b', { kind: 'ambiguous', itemIds: ['i2', 'i3'] }],
  ['c', { kind: 'unmatched' }],
]);

/* ------------------------------------------------------ initial decisions */

console.log('\ninitialDecisions');

const d0 = initialDecisions(PURCHASES, MATCHES);

eq('everything starts included', [...d0.values()].map((d) => d.include), [true, true, true]);

eq(
  'prices start at what the receipt printed',
  [...d0.values()].map((d) => d.priceCents),
  [299, 129, 249],
);

eq('a matched line starts pointed at its item', d0.get('a').itemId, 'i1');

eq(
  'an AMBIGUOUS line starts unassigned',
  d0.get('b').itemId,
  null,
);
if (d0.get('b').itemId === null) {
  console.log('       (the matcher said two rows are equally plausible — pre-filling one');
  console.log('        would turn a question into an answer nobody was asked)');
}

eq('an unmatched line starts unassigned', d0.get('c').itemId, null);

/* --------------------------------------------------------------- assign -- */

console.log('\nassign');

{
  // The correction that actually happens: the eggs are really the line below.
  const after = assign(d0, 'c', 'i1');
  eq('the new line takes the item', after.get('c').itemId, 'i1');
  eq(
    'the line that HELD it is released',
    after.get('a').itemId,
    null,
  );
  eq(
    'no list row is claimed twice',
    [...after.values()].filter((d) => d.itemId === 'i1').length,
    1,
  );
}

{
  // Two rows held, then one released. Checking against a decision map where
  // the OTHER row was already unassigned would have proved nothing.
  const held = assign(d0, 'b', 'i2');
  const after = assign(held, 'a', null);
  eq('assigning null releases that row', after.get('a').itemId, null);
  eq('and leaves other claims alone', after.get('b').itemId, 'i2');
}

{
  const after = assign(d0, 'b', 'i2');
  eq('an unrelated free row is simply taken', after.get('b').itemId, 'i2');
  eq('the already-matched line keeps its own', after.get('a').itemId, 'i1');
}

assert(
  assign(d0, 'nosuchkey', 'i2').size === d0.size,
  'an unknown key changes nothing',
);

/* --------------------------------------------------- immutability ------- */

console.log('\nimmutability');

{
  const before = JSON.stringify([...d0]);
  assign(d0, 'c', 'i1');
  setPrice(d0, 'a', 1);
  setInclude(d0, 'a', false);
  eq('the input map is never mutated', JSON.stringify([...d0]), before);
}

{
  const after = setPrice(d0, 'a', 1);
  assert(
    after.get('b') === d0.get('b'),
    'untouched entries keep their identity',
    'rebuilding every entry would re-render every row on one keystroke',
  );
}

/* ------------------------------------------------------------- grouping -- */

console.log('\ngrouping');

{
  const { matched, extra } = groupPurchases(PURCHASES, d0);
  eq('assigned lines are the matched group', matched.map((p) => p.key), ['a']);
  eq('the rest are "also bought"', extra.map((p) => p.key), ['b', 'c']);
}

{
  const excluded = setInclude(d0, 'a', false);
  const { matched } = groupPurchases(PURCHASES, excluded);
  eq(
    'an EXCLUDED row stays in its group',
    matched.map((p) => p.key),
    ['a'],
  );
  if (matched.length === 1) {
    console.log('       (a row that vanishes when you untick it takes its own untick');
    console.log('        button with it, and the only way back is memory)');
  }
}

/* ------------------------------------------------------------ unclaimed -- */

console.log('\nunclaimed');

eq('rows nothing claimed', unclaimed(LIST, d0).map((c) => c.id), ['i2', 'i3']);
eq(
  'an EXCLUDED line still holds its row',
  unclaimed(LIST, setInclude(d0, 'a', false)).map((c) => c.id),
  ['i2', 'i3'],
);
if (unclaimed(LIST, setInclude(d0, 'a', false)).length === 2) {
  console.log('       (what a line IS and whether to import it are separate questions —');
  console.log('        tying them makes the picker\'s contents depend on tick state)');
}

eq(
  'a row released by a move comes back',
  unclaimed(LIST, assign(d0, 'a', null)).map((c) => c.id),
  ['i1', 'i2', 'i3'],
);

/* -------------------------------------------------------- pickerOptions -- */

console.log('\npickerOptions');

eq(
  'a matched line is offered the row it already holds',
  pickerOptions(LIST, d0, 'a').map((c) => c.id),
  ['i1', 'i2', 'i3'],
);
if (pickerOptions(LIST, d0, 'a').some((c) => c.id === 'i1')) {
  console.log('       (without this, re-opening the picker shows every option EXCEPT');
  console.log('        the current one, which reads as the app having lost it)');
}

eq(
  'another line is not offered a taken row',
  pickerOptions(LIST, d0, 'c').map((c) => c.id),
  ['i2', 'i3'],
);

/* ----------------------------------------------------------- the totals -- */

console.log('\ntotals');

eq('everything in', includedTotal(PURCHASES, d0), 299 + 129 + 249);
eq('and counted', includedCount(PURCHASES, d0), 3);

eq(
  'an excluded line leaves the total',
  includedTotal(PURCHASES, setInclude(d0, 'b', false)),
  299 + 249,
);
eq('and the count', includedCount(PURCHASES, setInclude(d0, 'b', false)), 2);

eq(
  'the EDITED price is what is summed, not the printed one',
  includedTotal(PURCHASES, setPrice(d0, 'a', 1670)),
  1670 + 129 + 249,
);

/* -------------------------------------------------------------- the sheet */

console.log('\nreview sheet');

const sheet = readFileSync(join(SRC, 'app', 'receipt', 'review.tsx'), 'utf8');

assert(
  /\{p\.raw\.map\(\(raw\) => \(/.test(sheet),
  'the printed line is rendered unconditionally',
  'behind a tap it becomes an optional check, and a check nobody performs is decoration',
);

assert(
  !/\$\{p\.brand\}|p\.brand \+|\+ p\.brand|p\.name\}.*\{p\.brand/.test(sheet),
  'brand is never concatenated into the name',
  'item_key is generated from the name, so "Alpro almond milk" and "almond milk" would be two items with two price histories forever',
);

assert(
  /\{p\.brand && \(/.test(sheet),
  'brand is drawn as its own node',
);

assert(
  /if \(cents != null\) setDecisions/.test(sheet),
  'an unparseable amount leaves the price alone',
  'a half-typed price is a price mid-thought, not a decision to pay nothing',
);

assert(
  /!receipt\.reconciled && \(/.test(sheet),
  'the reconciliation banner is shown when the scan did not reconcile',
);

assert(
  /disabled=\{committing \|\| count === 0\}/.test(sheet),
  'the Import button is held while a commit is in flight, and when nothing is ticked',
  'a second tap mid-write is the case the receipt fingerprint exists to survive; catching it here saves a round trip and a confusing "already imported" for the user\'s own tap',
);

/* ------------------------------------------------------------------------ */

console.log(
  failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
