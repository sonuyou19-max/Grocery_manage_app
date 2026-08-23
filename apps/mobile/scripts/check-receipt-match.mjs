#!/usr/bin/env node
/**
 * Printed lines → purchases → list rows.
 *
 * ---------------------------------------------------------------------------
 * The two failures this exists to prevent
 * ---------------------------------------------------------------------------
 *
 * GROUPING decides how many of a thing was bought. Get it wrong and the pantry
 * learns a false burn rate — two avocados recorded as one means the app thinks
 * you use them half as fast, and it under-predicts forever after. The trap is
 * that tills disagree about how to print the same shopping: Aldi lists two
 * avocados as two rows, Carrefour prints one row saying ×2, and both must reach
 * the pantry identically.
 *
 * MATCHING decides which purchase is which row of the shopper's list. Wrong
 * here and a price lands on the wrong item — €8,99 of eggs recorded against
 * milk — which then poisons every "cheaper elsewhere" comparison for both.
 *
 * Neither can be checked by arithmetic the way the totals can, so both are
 * pinned by cases taken from the real receipts: the duplicate kiwis and
 * avocados from Aldi Süd, the two turmeric lines from a Leuven independent, the
 * ×4 milk from Carrefour.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, '..', 'src', 'lib');

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

/*
 * lib/receipt pulls in supabase and the emoji tables. The network half is
 * stripped — this checks the pure half, and importing a client would need a
 * running project to prove nothing.
 */
const strip = (file, ...drop) => {
  let src = readFileSync(join(LIB, file), 'utf8')
    .replace(/^import .*from '@korb\/shared';$/gm, '')
    .replace(/^import type .*$/gm, '');
  for (const spec of drop) {
    src = src.split('\n').filter((l) => !l.includes(`from '${spec}'`)).join('\n');
  }
  return src;
};

// normalizeKey is all that is wanted from pantry-intel, which otherwise drags
// in the whole prediction engine. Lifted, as check-swap does.
const pantry = readFileSync(join(LIB, 'pantry-intel.ts'), 'utf8');
const pgSpace = pantry.match(/^const PG_SPACE = .*$/m);
const normalize = pantry.match(/^export const normalizeKey = [\s\S]*?;$/m);
if (!pgSpace || !normalize) {
  console.error('could not lift normalizeKey out of pantry-intel — has it moved?');
  process.exit(1);
}

// The fetch at the bottom of lib/receipt is the only impure part; without
// @/lib/supabase it would not resolve, so it goes.
const receiptSrc = strip('receipt.ts', '@/lib/item-emoji', '@/lib/item-plural', '@/lib/pantry-intel', '@/lib/supabase')
  .replace(/export async function scanReceipt[\s\S]*?\n\}/, '')
  .replace(/export async function matchResidue[\s\S]*?\n\}/, '');

const source = [
  strip('item-emoji.ts'),
  strip('item-plural.ts', '@/lib/item-emoji'),
  pgSpace[0],
  normalize[0].replace('export const', 'const'),
  receiptSrc,
].join('\n');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { groupLines, matchPurchases, residue, applyAiMatches, claimedIds } = mod;

/* --------------------------------------------------------------- helpers -- */

const line = (raw, over = {}) => ({
  raw, kind: 'item', name: raw, expanded: null, translated: null, brand: null,
  section: null, multiplier: 1, multiplierDp: 0, unit: null, packSize: null,
  packUnit: null, unitPriceCents: null, unitPriceDp: null, totalCents: 0,
  emoji: null, category: null, confidence: 'high', ...over,
});

/* -------------------------------------------------------------- grouping -- */

/*
 * Aldi prints two kiwis and two avocados as four separate rows. The pantry must
 * see two purchases of two, or it learns that this household buys an avocado
 * half as often as it does.
 */
{
  const got = groupLines([
    line('32868 Fairtrade-Bio Bananen', { totalCents: 169 }),
    line('32087 Kiwi grün', { totalCents: 35 }),
    line('32087 Kiwi grün', { totalCents: 35 }),
    line('32261 Avocado', { totalCents: 119 }),
    line('32261 Avocado', { totalCents: 119 }),
  ]);
  eq('Aldi: four rows become two purchases plus one', got.length, 3);
  eq('...the kiwis are one purchase of 2', [got[1].packs, got[1].priceCents], [2, 70]);
  eq('...the avocados likewise', [got[2].packs, got[2].priceCents], [2, 238]);
  eq('...and both printed lines are kept for the review', got[1].raw.length, 2);
}

/*
 * The same shopping at Carrefour, printed the other way. Different rows, same
 * pantry — this is the property that makes the price history comparable across
 * shops at all.
 */
{
  const aldi = groupLines([
    line('Avocado', { totalCents: 119 }),
    line('Avocado', { totalCents: 119 }),
  ]);
  const carrefour = groupLines([
    line('Avocado', { multiplier: 2, unitPriceCents: 119, totalCents: 238 }),
  ]);
  eq(
    'two rows of one and one row of two reach the pantry identically',
    [aldi[0].packs, aldi[0].priceCents],
    [carrefour[0].packs, carrefour[0].priceCents],
  );
}

{
  const got = groupLines([
    line('1 x trs turmeric powder 100gr', { totalCents: 95 }),
    line('1 x trs turmeric powder 100gr', { totalCents: 95 }),
    line('1 x gazi ayaran 250ml', { totalCents: 80 }),
    line('1 x gazi ayaran 250ml', { totalCents: 80 }),
  ]);
  eq('Everest: two products, not four', got.length, 2);
  eq('...each a pack of two', [got[0].packs, got[1].packs], [2, 2]);
}

/*
 * Weighed rows sum their WEIGHT, not their count. Two bags of onions is 2,1 kg
 * of onions, not two packs — and a pack count of 2 with no weight would lose
 * the only figure the unit price can be derived from.
 */
{
  const got = groupLines([
    line('Rode uien', { multiplier: 1.208, unit: 'kg', unitPriceCents: 179, totalCents: 216 }),
    line('Rode uien', { multiplier: 0.9, unit: 'kg', unitPriceCents: 179, totalCents: 161 }),
  ]);
  eq('two weighed rows sum to one heavier purchase', [got[0].packs, got[0].quantity], [1, 2.108]);
}

/*
 * The keys used for MATCHING must not be used here. canonicalize strips
 * store-tier words on purpose — for matching a receipt line against a shopping
 * list they are noise — but between two lines of one receipt they are the whole
 * difference, and merging these would invent a unit price neither was sold at.
 */
{
  const got = groupLines([
    line('EVERYDAY Volle melk basic 1L', { unitPriceCents: 79, totalCents: 79 }),
    line('EVERYDAY Volle melk extra 1L', { unitPriceCents: 129, totalCents: 129 }),
  ]);
  eq('two store tiers of one product stay two purchases', got.length, 2);
  eq('...at their own prices', got.map((g) => g.priceCents), [79, 129]);
}

/* A weighed row and a counted row of the same name never merge. */
{
  const got = groupLines([
    line('Bananen', { multiplier: 1.04, unit: 'kg', totalCents: 259 }),
    line('Bananen', { multiplier: 1, totalCents: 199 }),
  ]);
  eq('a weight and a count stay two purchases', got.length, 2);
}

/*
 * Deposits, discounts and rounding are money. They belong to the receipt row
 * and never to the pantry — imported as items, PFAND becomes a tracked staple
 * that comes due every fortnight.
 */
{
  const got = groupLines([
    line('Gold-Bier', { totalCents: 179 }),
    line('Pfand 6 x EUR 0,25', { kind: 'deposit', multiplier: 6, unitPriceCents: 25, totalCents: 150 }),
    line('Korting Colruyt Trakteert', { kind: 'discount', totalCents: -1000 }),
    line('after rounding', { kind: 'rounding', totalCents: -2 }),
  ]);
  eq('only items become purchases', got.map((g) => g.name), ['Gold-Bier']);
}

/* The pack size from the name rides along, so the unit price can be derived. */
{
  const got = groupLines([
    line('CAMPINA ENT TE 1L', { multiplier: 4, packSize: 1, packUnit: 'l', unitPriceCents: 167, totalCents: 668 }),
  ]);
  eq('pack size and unit survive grouping', [got[0].packs, got[0].quantity, got[0].unit], [4, 1, 'l']);
}

/* Confidence is the worst of the rows, not the first. */
{
  const got = groupLines([
    line('PROU PROT WB', { totalCents: 495 }),
    line('PROU PROT WB', { totalCents: 495, confidence: 'low' }),
  ]);
  eq('a doubtful row makes the whole purchase doubtful', got[0].confidence, 'low');
}

/* -------------------------------------------------------------- matching -- */

const LIST = [
  { id: 'eggs', name: 'Eggs', category: 'dairy_eggs' },
  { id: 'milk', name: 'Milk', category: 'dairy_eggs' },
  { id: 'bananas', name: 'Bananas', category: 'fruit_veg' },
  { id: 'cucumber', name: 'Cucumber', category: 'fruit_veg' },
  { id: 'avocado', name: 'Avocado', category: 'fruit_veg' },
  { id: 'paneer', name: 'Paneer', category: 'dairy_eggs' },
  { id: 'cheese', name: 'Cheese', category: 'dairy_eggs' },
];

const matchOne = (over) => {
  const [p] = groupLines([line(over.raw ?? 'x', over)]);
  return matchPurchases([p], LIST).get(p.key);
};

eq('an exact name matches', matchOne({ raw: 'Avocado' }).itemId, 'avocado');
eq(
  'a plural matches its singular',
  matchOne({ raw: 'Bananas' }).itemId,
  'bananas',
);
eq(
  'a Dutch line matches through the curated glyph',
  matchOne({ raw: 'komkommer' }).itemId,
  'cucumber',
);
eq(
  'a brand-heavy line matches through its expansion',
  matchOne({ raw: 'CAR EIREN X30', expanded: 'Carrefour eieren 30 stuks', emoji: '🥚' }).itemId,
  'eggs',
);
eq(
  '...and through the extractor\'s glyph even with no expansion',
  matchOne({ raw: 'CAR EIREN X30', emoji: '🥚' }).itemId,
  'eggs',
);

/*
 * The ambiguity that must NOT be guessed. Paneer and Cheese are both 🧀; a
 * matcher that picked whichever sorted first would put a block of paneer's
 * price onto cheese roughly half the time, silently.
 */
{
  const got = matchOne({ raw: 'paneer nvf', emoji: '🧀' });
  eq('two list rows sharing a glyph is a question, not an answer', got.kind, 'ambiguous');
  eq('...and both candidates are offered', got.itemIds.sort(), ['cheese', 'paneer']);
}

eq(
  'something not on the list at all is unmatched',
  matchOne({ raw: 'DELIO CHICKY SAMOU' }).kind,
  'unmatched',
);

/*
 * One list row, one claim. Two receipt lines that both look like eggs are two
 * purchases — letting the second overwrite the first would drop a real one.
 */
{
  const ps = groupLines([
    line('Eggs', { totalCents: 449 }),
    line('CAR EIREN X30', { emoji: '🥚', totalCents: 899 }),
  ]);
  const m = matchPurchases(ps, LIST);
  const outcomes = ps.map((p) => m.get(p.key));
  eq('the first claim wins', outcomes[0].itemId, 'eggs');
  eq('...and the second does not overwrite it', outcomes[1].kind !== 'matched', true);
}

/* The residue is exactly what the model still has to decide. */
{
  const ps = groupLines([
    line('Avocado', { totalCents: 119 }),
    line('DELIO CHICKY SAMOU', { totalCents: 359 }),
    line('paneer nvf', { emoji: '🧀', totalCents: 437 }),
  ]);
  const m = matchPurchases(ps, LIST);
  eq(
    'matched rows are not sent to the model',
    residue(ps, m).map((p) => p.name),
    ['DELIO CHICKY SAMOU', 'paneer nvf'],
  );
}

/*
 * And the property that makes the free rungs safe to widen later: nothing here
 * may match a row that is not on the list.
 */
{
  const ps = groupLines([line('Schweineschnitzel', { totalCents: 125 })]);
  const m = matchPurchases(ps, LIST);
  const got = m.get(ps[0].key);
  eq('an unrelated meat does not land on a dairy row', got.kind, 'unmatched');
}

/* -------------------------------------------- the model's answers, folded -- */

/*
 * Every rule below refuses something, and the asymmetry is the reason.
 *
 * An UNMATCHED line is a row in the review sheet that somebody fixes in a
 * second. A MISMATCHED one is invisible: a price on the wrong row of a list
 * looks exactly like a price on the right one, and it goes on poisoning that
 * item's comparisons for as long as the history is kept. So refusing a good
 * match costs one tap; accepting a bad one costs a number nobody questions.
 */
const aiCase = () => {
  const ps = groupLines([
    line('DELIO CHICKY SAMOU', { totalCents: 359 }),
    line('PROU PROT WB', { totalCents: 495 }),
  ]);
  return { ps, base: matchPurchases(ps, LIST) };
};

{
  const { ps, base } = aiCase();
  const got = applyAiMatches(base, [{ key: ps[0].key, itemId: 'cheese', confidence: 'high' }], LIST);
  eq('a sound answer is taken', got.get(ps[0].key).itemId, 'cheese');
  eq("...and labelled as the model's, not an offline rung", got.get(ps[0].key).how, 'ai high');
}

{
  const { ps, base } = aiCase();
  const got = applyAiMatches(base, [{ key: ps[0].key, itemId: 'not-a-real-id', confidence: 'high' }], LIST);
  eq('an invented id is dropped, not corrected', got.get(ps[0].key).kind, 'unmatched');
}

{
  const { ps, base } = aiCase();
  const got = applyAiMatches(
    base,
    [
      { key: ps[0].key, itemId: 'cheese', confidence: 'high' },
      { key: ps[1].key, itemId: 'cheese', confidence: 'high' },
    ],
    LIST,
  );
  eq('one list row, one claim — the first answer wins', got.get(ps[0].key).itemId, 'cheese');
  eq('...and the second is left unmatched', got.get(ps[1].key).kind, 'unmatched');
}

/*
 * The offline rungs win outright. An exact-name match is not a judgement call,
 * and a model disagreeing with normalizeKey equality is a model that is wrong.
 */
{
  const ps = groupLines([
    line('Avocado', { totalCents: 119 }),
    line('DELIO CHICKY SAMOU', { totalCents: 359 }),
  ]);
  const base = matchPurchases(ps, LIST);
  const got = applyAiMatches(base, [{ key: ps[0].key, itemId: 'milk', confidence: 'high' }], LIST);
  eq('the model cannot overturn an exact match', got.get(ps[0].key).itemId, 'avocado');
}

/*
 * And it cannot take a row an offline rung already took, even one it was never
 * offered — the claimed set is seeded from the existing matches, not rebuilt.
 */
{
  const ps = groupLines([
    line('Avocado', { totalCents: 119 }),
    line('DELIO CHICKY SAMOU', { totalCents: 359 }),
  ]);
  const base = matchPurchases(ps, LIST);
  const got = applyAiMatches(base, [{ key: ps[1].key, itemId: 'avocado', confidence: 'high' }], LIST);
  eq('a row already claimed offline stays claimed', got.get(ps[1].key).kind, 'unmatched');
}

{
  const { base } = aiCase();
  const got = applyAiMatches(base, [{ key: 'a-key-never-sent', itemId: 'cheese', confidence: 'high' }], LIST);
  /*
   * Asserted on the map's SHAPE, not on some other line still being unmatched.
   * The first version checked the latter and passed a mutation that happily
   * invented a row for a key nobody sent — which would put a purchase in the
   * review sheet that no receipt line produced.
   */
  eq('an answer about an unknown line adds no row', got.has('a-key-never-sent'), false);
  eq('...and leaves the map exactly as it was', got.size, base.size);
}

{
  const { ps, base } = aiCase();
  const got = applyAiMatches(base, [{ key: ps[0].key, itemId: null, confidence: 'low' }], LIST);
  eq('a null answer is a real answer, and leaves the line alone', got.get(ps[0].key).kind, 'unmatched');
}

/*
 * An ambiguity the glyph rung refused to settle IS the model's to settle — that
 * is the whole reason it returns `ambiguous` rather than picking.
 */
{
  const ps = groupLines([line('paneer nvf', { emoji: '🧀', totalCents: 437 })]);
  const base = matchPurchases(ps, LIST);
  eq('the glyph rung leaves it open', base.get(ps[0].key).kind, 'ambiguous');
  const got = applyAiMatches(base, [{ key: ps[0].key, itemId: 'paneer', confidence: 'high' }], LIST);
  eq('...and the model resolves it', got.get(ps[0].key).itemId, 'paneer');
}

/* claimedIds is what decides which rows the model is even offered. */
{
  const ps = groupLines([line('Avocado', { totalCents: 119 })]);
  eq('claimed rows are not offered to the model', [...claimedIds(matchPurchases(ps, LIST))], ['avocado']);
}

/* Folding must not mutate the map it was handed. */
{
  const { ps, base } = aiCase();
  applyAiMatches(base, [{ key: ps[0].key, itemId: 'cheese', confidence: 'high' }], LIST);
  eq('the offline result is left untouched', base.get(ps[0].key).kind, 'unmatched');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
