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
  /^import\s+type\s[^;]*?;/gm,
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
  offBy,
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

/* ------------------------------------------------------------- the gap ---- */

console.log('\noffBy — the last comparison');

/*
 * The server reconciles the model's lines against the model's OWN reading of
 * the printed total, which stops being a check the moment it gets both wrong in
 * the same direction. A Delhaize receipt came back with every price from the
 * seventh line down shifted onto the product above it: every amount really
 * appeared on the paper, the arithmetic was internally consistent, nothing
 * flagged it, and €45.49 was offered for a €48.02 shop.
 *
 * The fixture below IS that receipt.
 */
{
  const delhaize = [
    ['melk', 89], ['ajuin', 189], ['kokos', 349], ['soya', 305], ['skyr', 415],
    ['muesli', 205], ['toast', 499], ['seizoenen', 209], ['fruitsap', 315],
    ['spinazie', 229], ['appel', 315], ['aardappel', 231], ['coke', 234],
    ['sprite', 165], ['druif', 546],
  ].map(([n, c], i) => buy(`d${i}`, n, c));

  const asRead = initialDecisions(delhaize, new Map());
  const paid = delhaize.reduce((a, p) => a + p.priceCents, 0);

  eq('a receipt that adds up says nothing', offBy(delhaize, asRead, paid, 0, 0), null);

  // The drift: every price from `fruitsap` down moves up one line. Same amounts,
  // same count, one line's worth of money lost off the end.
  const drifted = delhaize.map((p, i) =>
    i >= 8 ? { ...p, priceCents: delhaize[i - 1].priceCents } : p,
  );
  const gap = offBy(drifted, initialDecisions(drifted, new Map()), paid, 0, 0);
  eq(
    'a one-row shift IS caught, even though every amount is real',
    gap,
    drifted.reduce((a, p) => a + p.priceCents, 0) - paid,
  );
  if (gap != null) {
    console.log('       (the server cannot see this: the sums it compares are both the');
    console.log('        model\'s, and the model was consistently wrong)');
  }

  eq(
    'a cent of rounding on a weighed line is not a gap',
    offBy(
      delhaize.map((p, i) => (i === 0 ? { ...p, priceCents: p.priceCents + 2 } : p)),
      asRead, paid, 0, 0,
    ),
    null,
  );

  eq(
    'nothing is claimed when a line has been excluded',
    offBy(drifted, setInclude(initialDecisions(drifted, new Map()), 'd0', false), paid, 0, 0),
    null,
  );
  console.log('       (unticking one is normal and would trip this on the first tap)');

  eq('nor when the receipt printed no total', offBy(drifted, asRead, null, 0, 0), null);

  eq(
    'deposits and discounts are added back before comparing',
    offBy(delhaize, asRead, paid + 25 - 100, 25, -100),
    null,
  );
}

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
  'a chip rather than a run of muted text: it is the field this separation exists for, and looking distinct is what says it is a property of the purchase rather than part of what the thing is',
);

assert(
  /if \(cents != null\) setDecisions/.test(sheet),
  'an unparseable amount leaves the price alone',
  'a half-typed price is a price mid-thought, not a decision to pay nothing',
);

/*
 * The sheet phrases the failures itself. A server sentence would carry raw
 * cents and one language into a screen that has neither the reader's currency
 * format nor their locale — which is exactly what "ITEMS ADD UP TO 4827"
 * looked like.
 */
assert(
  /\{phrase\(p, t, money\)\}/.test(sheet),
  'the reconciliation failures are phrased on the device',
  'the server sends numbers; only the client knows the reader\'s currency format and language',
);

/*
 * Extracted and checked branch by branch, because the first version of this
 * allowed a hundred and sixty characters of anything after `case 'goods':` and
 * therefore matched the money() belonging to the NEXT case. It passed against a
 * goods message printing bare cents — the very thing it was written to stop.
 *
 * The count case is deliberately exempt: its numbers are articles and lines,
 * not money, and wrapping a count in a currency format would be its own bug.
 */
{
  const body = /function phrase\([\s\S]*?\n\}/.exec(sheet)?.[0] ?? '';
  const branch = (code) =>
    new RegExp(`case '${code}':([\\s\\S]*?)(?=\\n    case |\\n  \\})`).exec(body)?.[1] ?? '';

  const wrapped = ['goods', 'paid'].filter((code) => {
    const b = branch(code);
    return /money\(p\.got\)/.test(b) && /money\(p\.printed\)/.test(b);
  });
  assert(
    wrapped.length === 2,
    '...through money(), so a cent count never reaches the screen',
    'both money branches must wrap BOTH of their amounts',
  );

  assert(
    !/(?:got|printed):\s*p\.(?:got|printed)\b/.test(branch('goods') + branch('paid')),
    '...and never passes a raw cent count beside a formatted one',
  );
}

assert(
  /case 'count':[\s\S]{0,200}units: p\.units[\s\S]{0,80}lines: p\.asLines/.test(sheet),
  'the count message names BOTH readings it accepts',
  'the chains disagree about whether four cartons are four articles or one, so naming a single expected figure would be wrong for half of them',
);

assert(
  /!receipt\.reconciled && \(/.test(sheet),
  'the reconciliation banner is shown when the scan did not reconcile',
);

/*
 * ---------------------------------------------------------------------------
 * The name and the price must not be able to collide
 * ---------------------------------------------------------------------------
 *
 * They did. A long product line — `DOUWE EGBERTS oploskoffie dessert glas 200g`
 * — was painted straight across €6,49, and the brand chip was pushed off the
 * screen edge entirely.
 *
 * It was three faults compounding, and all three are asserted here because each
 * on its own is enough to bring it back:
 *
 *   1. the text column must be allowed to SHRINK (`flex: 1` with `minWidth: 0`)
 *      — without the minimum, Yoga sizes a flex child to its content and
 *      `numberOfLines` never engages, because truncation needs a width to
 *      truncate against;
 *   2. the price column must REFUSE to shrink (`flexShrink: 0`), or the text
 *      column takes its room and the two overlap;
 *   3. the brand chip must shrink rather than overflow.
 *
 * None of this can be caught by typecheck, and on a wide simulator it looks
 * fine. It shows up on a real phone with a real receipt, which is the worst
 * place to find it.
 */
{
  const style = (name) => {
    const m = new RegExp(`\\n  ${name}: \\{[\\s\\S]*?\\n  \\},`).exec(sheet)
      ?? new RegExp(`\\n  ${name}: \\{[^}]*\\},`).exec(sheet);
    return m ? m[0] : '';
  };

  const grow = style('grow');
  assert(
    /flex:\s*1/.test(grow) && /minWidth:\s*0/.test(grow),
    'the text column can shrink below its content',
    'without minWidth: 0 a flex child is sized to its text, so numberOfLines has no width to truncate against and the name runs under the price',
  );

  const amount = style('amountCol');
  assert(
    /flexShrink:\s*0/.test(amount),
    'the price column refuses to shrink',
    'this is the overlap: a price with no reserved width gets squeezed by the name beside it, and the two paint on top of each other',
  );
  assert(
    /width:\s*\d+/.test(amount),
    'the price column has a fixed width',
    'so the row does not jump when tapping into the amount field',
  );

  const brand = style('brand');
  assert(
    /flexShrink:\s*1/.test(brand),
    'the brand chip shrinks rather than overflowing',
    'a maxWidth alone does not stop a chip being pushed past the screen edge',
  );
}

/*
 * The headline is the PRODUCT, which is stricter than the expansion it
 * replaced. An unmatched line becomes a pantry item, and a pantry item called
 * "1 litre Delhaize full fat milk" cannot match next month's Alpro — so the
 * name has to be what the thing IS, with the brand and the size beside it.
 */
assert(
  /\{productName\(p\)\}/.test(sheet),
  'the row is headed by the PRODUCT, not the full description',
  'the description still shows — as the brand chip, the size, and the raw printed line underneath. What must not happen is a brand or a pack size inside the name, because that is what becomes the item.',
);

assert(
  /const name = row\?\.name \?\? productName\(p\);/.test(
    readFileSync(join(SRC, 'lib', 'receipt-commit.ts'), 'utf8'),
  ),
  '...and so is the pantry item it becomes',
  'this is the one that actually bit: unmatched lines were filed under the full description, so the pantry filled with "Provital toast 50 pieces"',
);

assert(
  /sizeOf\(p\)/.test(sheet) && !/name.*sizeOf|sizeOf.*productName\(p\)/.test(sheet),
  'the size is shown BESIDE the name, never inside it',
);

assert(
  /purchaseInstant\(receipt\.purchasedAt, Date\.now\(\)\)/.test(sheet),
  'the header shows the instant the IMPORT will use',
  'showing receipt.purchasedAt instead lets the screen say 2028 while the write files under today, with nothing saying so',
);

assert(
  /toLocaleDateString\(/.test(sheet) && !/\{receipt\.purchasedAt\}/.test(sheet),
  'the date is formatted, never the raw ISO string',
);

assert(
  /when\.substituted && \(/.test(sheet),
  'a rejected date is explained rather than silently replaced',
);

assert(
  /for \(const \{ itemId, patch \} of plan\.patches\) updateItem\(list\.id, itemId, patch\);/.test(sheet),
  'the import patches the list rows, not only the purchase log',
  'without this a €6,49 shop imports cleanly and the list still reads €0.00 with an empty quantity — the numbers land in the one place nobody opens',
);

assert(
  sheet.indexOf('updateItem(list.id') < sheet.indexOf('toggleItem(list.id'),
  'rows are patched BEFORE they are ticked',
  'ticking starts the sweep that can take a row off the list, and it should carry its price when it goes',
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
