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
 * receipt-review carries one real import — normaliseNumber, which parseAmount
 * uses to read a typed size in the receipt's own convention — so money.ts is
 * CONCATENATED rather than stripped.
 *
 * Stripping it would leave parseAmount calling an undefined function: every
 * separator case below would crash rather than assert, which is the shape of
 * test that reports a passing suite while testing nothing. Everything else this
 * module imports is type-only and does go.
 */
const source =
  readFileSync(join(SRC, 'lib', 'money.ts'), 'utf8')
    .replace(/^import\s+type\s[^;]*?;/gm, '') +
  '\n' +
  readFileSync(join(SRC, 'lib', 'receipt-review.ts'), 'utf8')
    .replace(/^import\s+type\s[^;]*?;/gm, '')
    .replace(/^import\s\{ normaliseNumber \}[^;]*?;/gm, '');
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
  collapseRaw,
  parseAmount,
  parsePriceToCents,
  setAmount,
  setInclude,
  setPacks,
  setPrice,
  setUnitPrice,
  unclaimed,
  unitPriceOf,
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

/* ------------------------------------------------- price, packs and size -- */

console.log('\nthe editable numbers');

/*
 * THE TOTAL IS STORED; THE PER-PACK PRICE IS DERIVED.
 *
 * The screen now offers a per-pack price to edit, which is what the shelf label
 * says and what a shopper can check. It is NOT what gets stored, because it
 * cannot be added up without drift: €2.09 over three packs is 69.67 cents each,
 * the chip has to say €0.70, and three seventy-cent packs are €2.10. Storing
 * the unit price would make the import a penny out for reasons nobody could see.
 */
{
  const four = initialDecisions([{ ...buy('m', 'milk', 356), packs: 4 }], new Map());
  eq('a pack price is the total over the packs', unitPriceOf(four.get('m')), 89);

  const odd = initialDecisions([{ ...buy('x', 'thing', 209), packs: 3 }], new Map());
  eq('...rounded to a cent for the chip', unitPriceOf(odd.get('x')), 70);
  eq(
    '...while the total stays exactly what was paid',
    odd.get('x').priceCents,
    209,
  );
  if (odd.get('x').priceCents === 209) {
    console.log('       (three seventy-cent packs are €2.10 — storing the unit price');
    console.log('        would import a penny that was never on the receipt)');
  }
}

// A single pack has no separate unit price; the chip IS the total.
eq('one pack: the price is the price', unitPriceOf(d0.get('a')), 299);

/*
 * Editing the PRICE means the shelf price was wrong, so the total follows it.
 * Editing the PACKS means the count was miscounted, and the till charged what
 * it charged — so the total is untouched and the per-pack chip re-derives.
 * Those are opposite directions and getting them the same way round is the
 * whole point.
 */
{
  const four = initialDecisions([{ ...buy('m', 'milk', 356), packs: 4 }], new Map());
  const cheaper = setUnitPrice(four, 'm', 80);
  eq('a new pack price multiplies up', cheaper.get('m').priceCents, 320);
  eq('...over the packs it actually has', cheaper.get('m').packs, 4);

  const recounted = setPacks(four, 'm', 2);
  eq('a corrected pack count leaves the money alone', recounted.get('m').priceCents, 356);
  eq('...and the pack price re-derives from it', unitPriceOf(recounted.get('m')), 178);
}

eq('packs never fall below one', setPacks(d0, 'a', 0).get('a').packs, 1);
eq('...and are whole', setPacks(d0, 'a', 2.6).get('a').packs, 3);

/* ---------------------------------------------------------- typed sizes -- */

console.log('\nparseAmount');

// The shapes printed on packaging, because that is what people copy from.
eq('grams', parseAmount('750g', ','), { quantity: 750, unit: 'g' });
eq('a space is fine', parseAmount('1 L', ','), { quantity: 1, unit: 'l' });
eq('so is upper case', parseAmount('500ML', ','), { quantity: 500, unit: 'ml' });
eq('centilitres are accepted', parseAmount('33cl', ','), { quantity: 33, unit: 'cl' });
eq('pieces', parseAmount('6 pcs', ','), { quantity: 6, unit: 'pcs' });
// Half of Europe writes 1,5.
/*
 * THE SEPARATOR, WHICH BELONGS TO THE RECEIPT AND NOT THE READER.
 *
 * This read both marks as a decimal point. That is right on a Belgian receipt
 * and wrong on a British one, where "1,500g" means fifteen hundred grams and
 * was read as one and a half — a size out by a factor of a thousand, from a
 * correction somebody typed to make the import right.
 *
 * The mark comes from the paper now, through the same normaliser the price chip
 * uses, so the two chips on one row can never disagree about what a comma is.
 */
eq('a comma decimal on a comma receipt', parseAmount('1,5l', ','), { quantity: 1.5, unit: 'l' });
eq('a point decimal on a point receipt', parseAmount('1.5l', '.'), { quantity: 1.5, unit: 'l' });

/*
 * Grouping has a shape — exactly three digits after the mark — and that shape
 * is what decides the cases that look ambiguous from the string alone.
 */
eq('a British grouped size', parseAmount('1,500g', '.'), { quantity: 1500, unit: 'g' });
eq('a Belgian grouped size', parseAmount('1.500g', ','), { quantity: 1500, unit: 'g' });

/*
 * And the mark somebody's other keyboard uses, typed once, with nothing to
 * conflict with: they meant the point. Stripping it instead is how "1,5"
 * became fifteen.
 */
eq('the wrong mark, read as they meant it', parseAmount('1,5l', '.'), { quantity: 1.5, unit: 'l' });
eq('...and the other way round', parseAmount('1.5l', ','), { quantity: 1.5, unit: 'l' });

// Two decimal marks is not a number in either convention.
eq('two marks is refused', parseAmount('1,2,3kg', ','), null);

/*
 * A bare number keeps the unit the row already had — correcting 1L to 2L should
 * not mean retyping the unit. Null here means "unchanged", and the screen
 * supplies the old one.
 */
eq('a bare number leaves the unit to the caller', parseAmount('2', ','), { quantity: 2, unit: null });

// Emptying the chip is a real answer, and a different one: it clears the size.
eq('an empty chip clears the size', parseAmount('', ','), { quantity: null, unit: null });
eq('...and so does whitespace', parseAmount('   ', ','), { quantity: null, unit: null });

/*
 * Everything else is refused, and refusing means the OLD value stays on screen.
 * A half-typed size is a size mid-thought, not an instruction to forget one.
 */
eq('an unknown unit is refused', parseAmount('12oz', ','), null);
eq('...as is nonsense', parseAmount('abc', ','), null);
eq('...and zero', parseAmount('0kg', ','), null);
eq('...and a negative', parseAmount('-1kg', ','), null);

eq('a size can be set', setAmount(d0, 'a', 750, 'g').get('a').quantity, 750);
eq('...with its unit', setAmount(d0, 'a', 750, 'g').get('a').unit, 'g');
eq('...and cleared again', setAmount(d0, 'a', null, null).get('a').quantity, null);

/* ------------------------------------------------------ the printed rows -- */

console.log('\ncollapseRaw');

/*
 * Four cartons print four identical lines. The printing stays — it is the only
 * thing on the row that is not an interpretation — but sixty pixels to say one
 * thing is height taken from the comparison the screen exists for.
 */
eq(
  'repeats fold, with a count',
  collapseRaw(['1L DLL VOLLE MELK', '1L DLL VOLLE MELK', '1L DLL VOLLE MELK', '1L DLL VOLLE MELK']),
  [{ text: '1L DLL VOLLE MELK', count: 4 }],
);
eq('a single line is untouched', collapseRaw(['RODE AJUIN 750G']), [{ text: 'RODE AJUIN 750G', count: 1 }]);
eq(
  'different lines all survive',
  collapseRaw(['A', 'B']).map((r) => r.text),
  ['A', 'B'],
);
/*
 * Counted, not run-length encoded: a till can print the same line twice with
 * something else between them, and a run-length pass would report it as two
 * separate ones.
 */
eq(
  'repeats are counted even when separated',
  collapseRaw(['A', 'B', 'A']),
  [{ text: 'A', count: 2 }, { text: 'B', count: 1 }],
);
eq('...keeping first-appearance order', collapseRaw(['B', 'A', 'B']).map((r) => r.text), ['B', 'A']);

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

/*
 * EVERY row is offered, claimed ones included.
 *
 * Hiding them was the wrong lesson drawn from a real rule. One list row can be
 * claimed once — but `assign` is what holds that, by MOVING the row rather than
 * copying it. Leaving claimed rows out protected nothing and removed the
 * correction shoppers most need: the scan puts the eggs on the line above where
 * they belong, you open the right line, and Eggs is not there, because the
 * wrong line has it. The only way through was to fix the wrong line FIRST.
 */
eq(
  'another line is offered a taken row too',
  pickerOptions(LIST, d0, 'c').map((c) => c.id),
  ['i1', 'i2', 'i3'],
);
/*
 * ...and is told which line has it, because the tap MOVES it. A silent steal
 * leaves the shopper to discover afterwards that a line they had already
 * checked has become "not on your list".
 */
eq(
  '...and told which line has it',
  pickerOptions(LIST, d0, 'c').map((c) => c.takenBy),
  ['a', null, null],
);
// A line holding its own row is the current choice, not a row to steal.
eq(
  'the row a line already holds is not marked as taken',
  pickerOptions(LIST, d0, 'a').map((c) => c.takenBy),
  [null, null, null],
);
/*
 * Include state is not consulted, exactly as `unclaimed` does not consult it:
 * what a line IS and whether to import it are separate questions, and an
 * unticked line still holds its row.
 */
eq(
  'an unticked line still holds its row here',
  pickerOptions(LIST, setInclude(d0, 'a', false), 'c').map((c) => c.takenBy),
  ['a', null, null],
);

/*
 * And the whole point of offering them: choosing a taken row moves it, in one
 * gesture, with the previous holder released rather than duplicated.
 */
{
  const moved = assign(d0, 'c', 'i1');
  eq('choosing a taken row gives it to the new line', moved.get('c').itemId, 'i1');
  eq('...and takes it off the old one', moved.get('a').itemId, null);
  /*
   * And the move is visible from the other side. Re-opening the line that LOST
   * the row shows it held by the line that took it — the same fact the shopper
   * was warned about before they tapped, now stated from where they are.
   */
  eq(
    '...and the old line now sees it held by the new one',
    pickerOptions(LIST, moved, 'a').map((c) => c.takenBy),
    ['c', null, null],
  );
  eq('...with the old line itself holding nothing', moved.get('a').itemId, null);
}

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

/*
 * Comments stripped, once, before anything is matched.
 *
 * review.tsx is 1400 lines and most of them are prose explaining the 300 that
 * are not — which makes it the single worst file in the repo to match raw text
 * against. It bit immediately: an assertion that the screen never touches the
 * receipt's FINGERPRINT failed against code that does not, because three
 * comments explain why it must not.
 *
 * That is this repo's most repeated guard bug and the fix is always the same.
 * Every assertion below now reads code only, so an assertion about the
 * reasoning can no longer pass for an assertion about the thing reasoned about.
 */
const sheet = readFileSync(join(SRC, 'app', 'receipt', 'review.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/*
 * THE RECEIPT'S CONVENTION WINS, AND THE DEVICE IS ONLY THE FALLBACK.
 *
 * Everything typed on this screen is a correction to a number printed on paper,
 * so the paper decides what a comma means. A Belgian scanning a British till
 * would otherwise read a corrected "1.50" as one and a half thousand — their
 * own convention applied to somebody else's receipt.
 *
 * The device's country is used only when the model could not tell from the
 * paper, or when the scan came from a deployment predating the field.
 */
assert(
  /receipt\?\.decimalComma == null\s*\?\s*decimalMarkFor\(region\)/.test(sheet),
  'the receipt decides the decimal mark, not the phone',
  'a Belgian scanning a British receipt would read a corrected 1.50 as fifteen hundred',
);
assert(
  /receipt\.decimalComma\s*\?\s*','\s*:\s*'\.'/.test(sheet),
  '...with the device only as the fallback',
);
// Both typed fields on this screen read through it, so they cannot disagree.
assert(
  /parsePriceToCents\(text, decimal\)/.test(sheet),
  'the price chip reads in that convention',
);
assert(
  /parseAmount\(text, decimal\)/.test(sheet),
  '...and so does the size chip',
);

/*
 * ONE SCREEN, TWO SOURCES.
 *
 * `source` is the fresh run or the reopened scan, and every derivation below it
 * — the decimal mark, the lines, the reconciliation gap, what gets written — is
 * written once against that rather than once per mode. Reaching for `run` past
 * this point is the bug this names: it is null on every reopened receipt, so
 * the branch would be dead in exactly the mode it was meant to serve.
 */
assert(/const source = run \?\? saved;/.test(sheet), 'both ways in resolve to one source');
/*
 * AND ONE RECEIPT, which is the scan with the shopper's corrections merged over
 * it. Everything below reads that and nothing reads the raw scan: a screen that
 * displays one value and writes another is the bug the date header had once —
 * it showed the printed 2028 while the import quietly substituted today — and
 * it is silent every time.
 */
assert(
  /const receipt = source \? \{ \.\.\.source\.receipt, \.\.\.edits \} : null;/.test(sheet),
  'the corrections are merged over the scan',
);
/*
 * `source.receipt` in ANY form below the merge, not just followed by a dot.
 * The narrower version missed `planCommit(source.receipt, ...)` — a comma, not
 * a dot — which is the single most consequential place it could come back.
 */
const belowMerge = sheet.slice(sheet.indexOf('const receipt = source'));
const rawReads = (belowMerge.match(/source\.receipt/g) ?? []).length;
assert(
  rawReads === 1,
  '...and nothing below reads the uncorrected scan',
  `source.receipt appears ${rawReads} times below the merge; only the merge itself may`,
);
assert(
  !/\brun[.?]/.test(sheet.slice(sheet.indexOf('const source = run'))),
  '...and nothing below it reads the run directly',
  'a reopened receipt has no run, so any such read is dead code on the path it matters for',
);

/*
 * A CORRECTION REPLACES; IT DOES NOT IMPORT AGAIN.
 *
 * The receipt was claimed the first time and its fingerprint is unique per
 * household, so claiming again would tell the shopper their own correction was
 * a duplicate. `amendReceipt` deletes every row this receipt wrote and writes
 * the corrected set in its place — without which a fixed price would ADD a
 * second copy of the shop, which is the damage migration 0038 exists to
 * prevent, through a door its fingerprint does not cover.
 */
assert(
  /if \(amending && receiptId\) \{[\s\S]{0,200}?amendReceipt\(receiptId, plan\.purchases\)/.test(sheet),
  'a reopened receipt is amended, never re-imported',
  'logging the corrected lines on top of the originals doubles the shop',
);
assert(
  /amending \? 'amend' : 'import'/.test(sheet),
  '...and the planner is told which it is',
  "amend mode is what keeps the plan off the shopping list — see CommitMode",
);
/*
 * The list is untouched by a correction, and that is not caution. The rows this
 * receipt ticked were swept days ago; today's list belongs to next week's shop,
 * and ticking or adding to it would be acting on the wrong trip.
 */
const amendBlock = /if \(amending && receiptId\) \{[\s\S]*?return;\n\s*\}/.exec(sheet)?.[0] ?? '';
assert(amendBlock.length > 0, '...in a block of its own');
assert(
  !/toggleItem|addBoughtItem|updateItem/.test(amendBlock),
  '...that touches no shopping list',
  'the rows it once ticked no longer exist, and the rows that do belong to a different shop',
);

/* ------------------------ the receipt's own four facts, in one row ------- */

/*
 * THE SHOP AND THE DATE WERE A CAPTION, and they are not a caption.
 *
 * They sat in the header subtitle, styled like one — and both decide where
 * every purchase on this screen gets filed: the shop is the key that every
 * price comparison groups by, and the date is the instant each purchase is
 * recorded at. A receipt read as the wrong Carrefour, or dated a day out, is a
 * whole shop landing in the wrong place with nothing on screen looking wrong.
 *
 * So they join the two figures they belong with, wearing the same dashed
 * outline the line chips use — which on this screen is the one thing that means
 * "you may change this".
 */
/*
 * EVERY header on this screen, not just one.
 *
 * There are two — the real one and the empty-state one — and asserting that a
 * matching Header exists was satisfied by the empty state alone. The main
 * header could have regained its subtitle with this still green. Found by
 * mutation: the mutation replaced the first occurrence and nothing fired.
 */
const headers = sheet.match(/<Header[^/]*\/>/g) ?? [];
assert(headers.length >= 2, 'both headers are findable');
assert(
  headers.every((h) => /subtitle=\{null\}/.test(h)),
  'the shop and date have left the header',
  'a caption is the one thing a person will not think to tap',
);
const chipRow = /<View style=\{styles\.totals\}>[\s\S]*?<\/View>/.exec(sheet)?.[0] ?? '';
assert(chipRow.length > 0, 'the chip row is findable');
for (const [what, re] of [
  ['the shop', /label=\{t\('receipt\.store'\)\}/],
  ['the date', /label=\{t\('receipt\.date'\)\}/],
  ['what was paid', /label=\{t\('receipt\.paid'\)\}/],
  ['what came off', /label=\{t\('receipt\.discount'\)\}/],
]) {
  assert(re.test(chipRow), `...and it carries ${what}`);
}
/* Left to right in the order a person checks a receipt. */
assert(
  chipRow.indexOf("receipt.store") < chipRow.indexOf("receipt.date") &&
    chipRow.indexOf("receipt.date") < chipRow.indexOf("receipt.paid") &&
    chipRow.indexOf("receipt.paid") < chipRow.indexOf("receipt.discount"),
  '...in that order',
);
/*
 * The deposit is NOT in the row and is not editable. It is money on the paper
 * that is neither a purchase nor a saving, nothing downstream keys on it, and
 * there is nothing a shopper would want to say about it that the paid total
 * does not already carry.
 */
/*
 * Asserted over the whole screen, not just the row. Putting the deposit in a
 * FieldChip somewhere else is the same mistake in a different place, and the
 * row-scoped version of this did not notice.
 */
assert(
  !/<FieldChip[\s\S]{0,120}receipt\.deposit'/.test(sheet),
  'the deposit stays a plain reading',
  'it is neither a purchase nor a saving, and nothing downstream keys on it',
);
/*
 * DISCOUNTS ARE SHOWN AT ZERO, unlike the deposit. The difference is what a
 * blank means: a receipt with no deposit is ordinary, while a discount reading
 * zero that should not is the specific fault this app has been bitten by — and
 * a chip that disappears exactly when the number is wrong cannot be used to
 * correct it.
 */
assert(
  !/discountCents !== 0 && \(\s*<FieldChip/.test(sheet),
  'the discount chip is there even at zero',
);

/*
 * A CORRECTED DISCOUNT IS NEGATIVE. Every sum on both sides of this app ADDS
 * the discount rather than subtracting it, and nobody types a minus sign into a
 * box labelled Discounts — so a typed "2.10" read as +210 moves the total by
 * twice the amount, in the wrong direction.
 */
assert(
  /discountCents: -Math\.abs\(cents\)/.test(sheet),
  'a typed discount is stored as money coming off',
);

/*
 * AND THE FINGERPRINT DOES NOT MOVE.
 *
 * It is derived from store, paid total and printed time — the three things this
 * row now lets somebody change — and it is what stops the same paper being
 * imported twice. Correcting a misread total and rescanning produces the same
 * misreading again, which still collides, which is what is wanted. A
 * fingerprint recomputed from the corrections would let that second scan
 * straight through, and a doubled week of spending is invisible until the
 * comparisons start lying.
 */
assert(
  !/fingerprint/.test(sheet),
  'the screen never touches the fingerprint',
  'it identifies the paper as scanned, not as corrected',
);
const editKeys = /const \[edits, setEdits\] = useState<\{[\s\S]*?\}>\(\{\}\);/.exec(sheet)?.[0] ?? '';
assert(editKeys.length > 0, '...and the corrections are a closed set');
assert(
  !/fingerprint|depositCents|lines|goodsCents/.test(editKeys),
  '...that cannot reach it',
);

/*
 * THE PICKER WARNS BEFORE IT STEALS.
 *
 * Claimed rows are offered now (see pickerOptions), and choosing one MOVES it —
 * the line that had it becomes "not on your list". That is the right behaviour
 * and it must not be silent: a shopper who has already checked that line would
 * otherwise have to notice, unprompted, that it had changed under them.
 */
assert(
  /t\('receipt\.heldBy', \{ line: heldBy \}\)/.test(sheet),
  'a row another line holds says so before it is tapped',
  'choosing it moves the row, and the line that had it silently becomes "not on your list"',
);
assert(
  /purchases\.find\(\(p\) => p\.key === c\.takenBy\)/.test(sheet),
  '...and names that line rather than saying "taken"',
  'the shopper needs to know WHICH line their tap is about to empty',
);
/*
 * The picker is capped well under the window and scrolls. It answers "which
 * item is this?" about a row the shopper was just looking at, so a picker that
 * covers that row has hidden its own question. check-modal-nav pins the
 * ScrollView and the maxHeight; this pins the fraction.
 */
{
  const cap = sheet.match(/const pickerCap = Math\.round\(windowHeight \* ([\d.]+)\)/);
  assert(
    cap != null && Number(cap[1]) > 0 && Number(cap[1]) <= 0.7,
    'the picker is capped at no more than 70% of the window',
    'a full-height picker hides the row it is asking about, and the context behind it',
  );
}

/*
 * The printing is still unconditional — it is just no longer repeated.
 *
 * Four cartons of milk print four identical rows and the sheet showed all four.
 * What collapses is the REPETITION; the line itself must stay visible, because
 * it is the only thing on the row that is not an interpretation, and behind a
 * tap it becomes an optional check that nobody performs.
 */
assert(
  /\{collapseRaw\(p\.raw\)\.map\(/.test(sheet),
  'the printed line is rendered unconditionally',
  'behind a tap it becomes an optional check, and a check nobody performs is decoration',
);
assert(
  /count > 1 \? `  ×\$\{count\}` : ''/.test(sheet),
  '...and says how many times it was printed',
  'collapsing four lines to one without saying "×4" hides evidence rather than tidying it',
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

/*
 * The size still shows and is still not part of the name — it has moved from
 * muted text under the name to an editable chip on the right, beside the money
 * it describes. What must never happen is a size or a brand INSIDE the name,
 * because the name is what becomes the pantry item.
 */
assert(
  /\$\{d\.quantity\} \$\{d\.unit \?\? ''\}/.test(sheet),
  'the size is shown beside the name, never inside it',
  'a size folded into the name makes "milk 1L" a different item from "milk" forever',
);
assert(
  !/productName\(p\)\}[^\n]*d\.quantity|d\.quantity[^\n]*productName\(p\)/.test(sheet),
  '...and the name is drawn on its own',
);

/*
 * THE DASHED OUTLINE IS THE FEATURE.
 *
 * Every figure here was already editable and nothing said so — the price was
 * rendered as text in the same weight and colour as the name beside it, and
 * people do not tap text. The tap target, the parsing and the commit were all
 * already there; the outline is what changed.
 */
assert(
  /borderStyle: 'dashed'/.test(sheet),
  'editable numbers are drawn as dashed chips',
  'a figure styled exactly like the text around it does not read as an input',
);
assert(
  /editChipOpen: \{ borderStyle: 'solid' \}/.test(sheet),
  '...resolving to a solid ring while open',
);
/*
 * One box in every state. The chips sit in a row of three, and a row that
 * reflows when one of them gains a cursor moves out from under the finger
 * arriving at it — so only colour and dash may change, never the geometry.
 */
assert(
  /editChip: \{\s*minWidth: 44,\s*borderWidth: 1\.5,/.test(sheet),
  '...at one size in every state',
  'a chip that grows when tapped moves the two beside it',
);

// Three chips, and the placeholder for a size the receipt never gave.
assert(
  /t\('receipt\.editPrice'\)/.test(sheet) &&
    /t\('receipt\.editSize'\)/.test(sheet) &&
    /t\('receipt\.editPacks'\)/.test(sheet),
  'price, size and pack count are each their own chip',
);
assert(
  /d\.quantity == null \? '···'/.test(sheet),
  'a size the receipt never gave shows a placeholder',
  'an empty chip has to look different from a value, or a gap reads as a number',
);
/*
 * A pack count of ONE is not missing — the receipt said one. It gets a real
 * chip, or every row of every receipt would carry a placeholder.
 */
assert(
  /\{`× \$\{d\.packs\}`\}/.test(sheet) && !/d\.packs === 1 \? '···'/.test(sheet),
  '...but a pack count of one is a value, not a gap',
);

/*
 * The total is arithmetic. No outline, no fill, nothing that invites a tap a
 * tap could not honour — and only when there is more than one pack, since below
 * that the price chip already IS the total.
 */
assert(
  /\{d\.packs > 1 && \(\s*<View style=\{styles\.totalRow\}>/.test(sheet),
  'the computed total appears only for more than one pack',
  'printing the total beside an identical price chip says nothing twice',
);
/*
 * Asserted against the STYLE ITSELF rather than a window of characters after
 * its name.
 *
 * This was `!/totalRow[\s\S]{0,400}borderStyle: 'dashed'/`, and it passed for
 * the wrong reason: the four hundred characters between `totalRow` and the
 * dashed chip below it were a COMMENT. Strip the comments — as this file now
 * does — and the window reaches the next block, and a correct file fails.
 *
 * A window that only holds while the prose between two rules stays long enough
 * is not a rule about the code. The block is extracted and read on its own.
 */
const totalRowStyle = /totalRow: \{[^}]*\}/.exec(sheet)?.[0] ?? '';
assert(totalRowStyle.length > 0, 'the total row style is findable');
assert(
  !/dashed|borderWidth/.test(totalRowStyle),
  '...and is never drawn as an editable chip',
  'it is arithmetic — an outline would promise an edit that does nothing',
);

/*
 * THE EDITS HAVE TO REACH THE IMPORT.
 *
 * The chips write into the decision map; planCommit used to read the raw scan.
 * Reading the scan would import the numbers the model read rather than the ones
 * the shopper corrected — which is the entire purpose of the screen they were
 * corrected on.
 */
{
  const commit = readFileSync(join(SRC, 'lib', 'receipt-commit.ts'), 'utf8');
  assert(
    /listAmount\(d\.quantity, d\.unit\)/.test(commit),
    'the import takes the size from the decision, not the scan',
    'a corrected pack size that never reaches the write is a correction the shopper watched do nothing',
  );
  assert(
    /packs: d\.packs,/.test(commit) && !/packs: p\.packs,/.test(commit),
    '...and the pack count too',
  );
  assert(
    /quantity: d\.quantity,\s*unit: d\.unit,/.test(commit),
    '...including in the purchase log',
  );
}

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

/*
 * Nothing ticked holds the button on a FRESH scan and must not on a
 * correction. "This receipt should have logged nothing" is the only way to
 * undo an import that was wrong end to end, and a disabled button would leave
 * the shopper with no way out of it.
 */
assert(
  /disabled=\{committing \|\| \(count === 0 && !amending\)\}/.test(sheet),
  'the Import button is held while a commit is in flight, and when nothing is ticked',
  'a second tap mid-write is the case the receipt fingerprint exists to survive; catching it here saves a round trip and a confusing "already imported" for the user\'s own tap',
);
assert(
  /count === 0 && !amending/.test(sheet),
  '...but emptying a saved receipt is allowed',
  'removing every line is how an import that was wrong end to end gets undone',
);

/* ============================================================================
 * THE PRICE CHIP, END TO END
 * ==========================================================================*/

/*
 * The arithmetic runs ONE WAY: the chip is the price of one pack, and the line
 * total is that price times the packs. Never the reverse.
 *
 * Each half of this was already tested and the composition was not, which is
 * the gap a report walked through: `parsePriceToCents` was checked against
 * every separator, `setUnitPrice` against a Decision, and nothing against what
 * a person actually does — open a chip, type into it in their own convention,
 * and read the total that comes back. A guard on two halves is not a guard on
 * the path.
 *
 * The fixture is the reported row: Barilla spaghetti, 2 packs, €1,44 each,
 * €2,88 the line.
 */
const pastaRow = new Map([
  ['pasta', { ...buy('pasta', 'pasta', 288), packs: 2, include: true, itemId: null }],
]);

/** Open the chip, type `typed`, close it — in a locale using `mark`. */
const typePrice = (decisions, typed, mark) => {
  const cents = parsePriceToCents(typed, mark);
  // The screen's own refusal: an unreadable number leaves the line alone.
  return cents == null ? decisions : setUnitPrice(decisions, 'pasta', cents);
};

for (const [mark, typed] of [
  [',', '2,88'],
  [',', '2.88'],
  ['.', '2.88'],
  ['.', '2,88'],
]) {
  const after = typePrice(pastaRow, typed, mark).get('pasta');
  eq(
    `typing "${typed}" where "${mark}" is the decimal mark sets the pack price`,
    unitPriceOf(after),
    288,
  );
  eq(`...and the line total is that times two`, after.priceCents, 576);
}

/*
 * The direction, stated as the property rather than as a number: the total is
 * ALWAYS the chip times the packs. A regression that divided instead would put
 * 144 in the chip and leave the total at 288, which is precisely the shape
 * that was reported.
 */
for (const packs of [1, 2, 3, 7]) {
  const row = new Map([['pasta', { ...pastaRow.get('pasta'), packs }]]);
  const after = typePrice(row, '2.88', ',').get('pasta');
  eq(`${packs} pack(s): the total is the typed price times the packs`, after.priceCents, 288 * packs);
  eq(`${packs} pack(s): and the chip still reads what was typed`, unitPriceOf(after), 288);
}

// An unreadable entry changes nothing at all — neither half of the row.
const refused = typePrice(pastaRow, '2.8.8', ',').get('pasta');
eq('an unreadable price leaves the pack price alone', unitPriceOf(refused), 144);
eq('...and the line total alone', refused.priceCents, 288);

/* ------------- and the screen has to SHOW the multiplication -------------- */

/*
 * Mid-edit the row used to read: price `2.88`, `× 2`, TOTAL €2,88 — the stored
 * total, because nothing recomputed it until the field closed. Those three
 * numbers say the opposite of what commit is about to do, and that frame is
 * what got reported as the app dividing the entry by the pack count.
 */
assert(
  /const typedUnit =\s*\n?\s*isEditing && editing\.field === 'price'/.test(sheet),
  'the row reads the price chip while it is being typed into',
  "Without it the total only catches up after the field closes, and the frame in between says the typed number BECAME the total.",
);
assert(
  /const shownTotal = typedUnit == null \? d\.priceCents : typedUnit \* Math\.max\(1, d\.packs\)/.test(sheet),
  '...and multiplies it by the packs rather than dividing',
  'The preview must do the same arithmetic as the commit, or it is a lie that is easier to read than the truth.',
);
assert(
  /money\(shownTotal\)/.test(sheet) && !/money\(d\.priceCents\)/.test(sheet),
  '...and that is what the TOTAL line renders',
  'A preview computed and not displayed is the bug with extra code.',
);
assert(
  /money\(shownUnit\)/.test(sheet),
  '...with the chip showing the same figure it is about to commit',
);
/*
 * AND THE COMMIT GOES THROUGH setUnitPrice.
 *
 * The single most important line in this section, and it was the one missing:
 * every assertion above passed against a screen whose price chip called
 * `setPrice` — which stores the entry as the LINE TOTAL and lets the chip
 * derive back down from it. Type 2.88 against two packs and the chip settles at
 * 1.44 with the total unmoved, which is the reported bug exactly.
 *
 * Found by mutation. The setter was covered, the parse was covered, the preview
 * was covered, and which setter the screen reaches for was nobody's assertion —
 * so the two correct halves could be wired to the wrong one and nothing here
 * would have noticed.
 */
assert(
  /field === 'price'[\s\S]{0,400}?setUnitPrice\(d, key, cents\)/.test(sheet),
  'the price chip commits through setUnitPrice',
  'setUnitPrice multiplies the entry up by the packs; setPrice stores it as the total and the chip divides back down.',
);
assert(
  !/setPrice\(/.test(sheet),
  '...and never through setPrice, which runs the other way',
  'setPrice exists for the total, and no chip on this screen edits the total.',
);
/*
 * And a refusal is SAID. Leaving the value alone is right; doing it in silence
 * is what makes a rejected edit look like arithmetic nobody asked for — the
 * chip snaps back to its old number and nothing says why.
 */
assert(
  (sheet.match(/showToast\(t\('receipt\.numberUnreadable'\)\)/g) ?? []).length >= 2,
  'an unreadable price or pack count says so rather than snapping back',
  'Both numeric chips refuse the same way, so both have to explain it.',
);

/* ------------------------------------------------------------------------ */

console.log(
  failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
