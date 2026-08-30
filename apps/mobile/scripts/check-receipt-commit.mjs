/**
 * Turning a reviewed receipt into writes.
 *
 * ---------------------------------------------------------------------------
 * The one that matters most
 * ---------------------------------------------------------------------------
 *
 * A matched purchase is filed under the LIST's spelling, never the receipt's.
 * The shopper wrote "Eggs"; the till printed "CAR EIREN X30". `item_key` is the
 * normalised name and the burn-rate model learns from the gaps between
 * purchases of one key — so filing this under `car eiren x30` starts a second,
 * parallel history that never joins the first, never comes due, and halves the
 * observed frequency of eggs. It is also invisible: two pantry entries where
 * there should be one, each looking perfectly reasonable on its own.
 *
 * Every other rule here is the same shape. Nothing on this page can be checked
 * by looking at a screen, and all of it decides where money lands.
 *
 * Run with `pnpm --filter mobile check:receipt-commit`.
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
 * supermarkets.ts comes along because planCommit resolves the chain through it.
 * The supabase half of receipt-commit — claimReceipt — is cut: it needs a live
 * project to prove anything, and what it proves is asserted against the source
 * further down instead.
 */
const supermarkets = readFileSync(join(SRC, 'lib', 'supermarkets.ts'), 'utf8');
const commit = readFileSync(join(SRC, 'lib', 'receipt-commit.ts'), 'utf8');

/*
 * displayName is lifted out of lib/receipt rather than imported: that module
 * reaches the supabase client and the whole emoji table, none of which this
 * needs. Lifted, not re-declared — a second copy of the fallback ORDER here
 * would let the real one change without a single assertion noticing, which is
 * the exact bug the two-implementation checks elsewhere exist to prevent.
 */
const receiptLib = readFileSync(join(SRC, 'lib', 'receipt.ts'), 'utf8');

/*
 * BOTH naming functions, because planCommit calls both and they answer
 * different questions — displayName is "what did I buy" and wants to be
 * complete, productName is "what IS it" and wants to be short. Lifting only one
 * is how this check stopped running: the module assembled fine and then threw
 * at the first call.
 */
const lift = (name) => receiptLib.match(new RegExp(`export function ${name}[\\s\\S]*?\\n\\}`));
const liftedFns = ['displayName', 'productName'].map((n) => [n, lift(n)]);
const missingFns = liftedFns.filter(([, m]) => !m).map(([n]) => n);
if (missingFns.length) {
  fail(`${missingFns.join(' and ')} could not be lifted out of lib/receipt`, [
    'Moved or renamed; this check cannot verify the name a purchase is filed',
    'under without them.',
  ]);
}
const lifted = [
  liftedFns
    .map(([, m]) => m?.[0] ?? '')
    .join('\n')
    .replace(/: Pick<ReceiptPurchase, [^>]*>/g, '')
    .replace(/\): string \{/g, ') {'),
];

const source = [
  supermarkets,
  lifted[0],
  commit
    .replace(/^import\s[^;]*?;/gm, '')
    .replace(/export async function claimReceipt[\s\S]*?\n\}/, ''),
].join('\n');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { planCommit, purchaseInstant, storeIdFor, listAmount } = mod;

/* --------------------------------------------------------------- fixtures */

const NOW = Date.parse('2026-08-24T10:00:00Z');
const LAST_NIGHT = '2026-08-23T18:42:00Z';

const buy = (key, name, priceCents, over = {}) => ({
  key, name, raw: [name.toUpperCase()], product: null, expanded: null, translated: null,
  brand: null, section: null, packs: 1, quantity: null, unit: null,
  priceCents, emoji: null, category: 'other', confidence: 'high', ...over,
});

const RECEIPT = {
  store: 'CARREFOUR MARKET', purchasedAt: LAST_NIGHT, currency: 'EUR',
  language: 'nl', fingerprint: 'fp-1', model: 'x', reconciled: true,
  problems: [], badLines: [], goodsCents: 500, depositCents: 25,
  discountCents: -100, paidCents: 425, articleCount: 3, lines: [],
};

const PURCHASES = [
  buy('a', 'eieren', 299, { brand: 'Boni' }),
  // The real shape: a garbled printing with a clean expansion beside it. If the
  // planner reached for `name` this would enter the pantry as
  // `DOUNE BINBAGZ 20st`.
  buy('b', 'PROVITAL TOAST 500', 249, {
    packs: 2, quantity: 500, unit: 'g', brand: 'Provital',
    product: 'toast', expanded: 'Provital toast 500 grams',
  }),
];

// The shopper's own spellings, and one row already ticked off in the aisle.
const ROWS = [
  { id: 'i1', name: 'Eggs', category: 'dairy', checked: false },
  { id: 'i2', name: 'Bread', category: 'bakery', checked: true },
];

/*
 * Decisions carry the size and the pack count now, because every one of those
 * is editable on the review sheet and planCommit reads the DECISION rather than
 * the scan — a corrected pack size that never reaches the write is a correction
 * the shopper watched do nothing. `seed` mirrors initialDecisions so a fixture
 * cannot drift from the shape the screen actually produces.
 */
const seed = (p, over = {}) => ({
  include: true,
  priceCents: p.priceCents,
  packs: p.packs,
  quantity: p.quantity,
  unit: p.unit,
  itemId: null,
  ...over,
});

const decide = (over = {}) =>
  new Map([
    ['a', seed(PURCHASES[0], { itemId: 'i1' })],
    ['b', seed(PURCHASES[1])],
    ...Object.entries(over),
  ]);

/* --------------------------------------------------------- the instant -- */

console.log('\npurchaseInstant');

eq('the receipt’s own time, not the clock', purchaseInstant(LAST_NIGHT, NOW), Date.parse(LAST_NIGHT));
eq('no printed date falls back to now', purchaseInstant(null, NOW), NOW);
eq('an unparseable date falls back to now', purchaseInstant('sometime tuesday', NOW), NOW);
eq('a receipt from 1970 falls back to now', purchaseInstant('1970-01-04T00:00:00Z', NOW), NOW);
eq('a receipt from 2087 falls back to now', purchaseInstant('2087-01-01T00:00:00Z', NOW), NOW);
eq('yesterday is kept', purchaseInstant('2026-08-23T09:00:00Z', NOW), Date.parse('2026-08-23T09:00:00Z'));

/* ------------------------------------------------------- units cross over */

console.log('\nlistAmount');

/*
 * THE BUG THIS EXISTS FOR.
 *
 * A receipt is transcribed in the units tills print — g, kg, ml, l, cl, pcs —
 * and a list row is stored in the units the app offers: g, kg, ml, L, pcs.
 * Four coincide, which is why nothing noticed the other two.
 *
 * list_items.unit has carried a CHECK constraint since migration 0001, so a
 * lowercase "l" is not displayed oddly, it is REJECTED — and Postgres rejects
 * the whole UPDATE. quantity, unit, packs and price_cents go in one statement,
 * so a litre item lost its price and its pack count as well, then the
 * optimistic local write reverted and the row read exactly as before the
 * import. Spinach in grams landed; the milk in litres did not.
 */
eq('a printed litre becomes the list’s L', listAmount(1, 'l'), { quantity: 1, unit: 'L' });
eq('...and keeps its amount', listAmount(1.5, 'l').quantity, 1.5);

// The four that already agreed must not move.
eq('grams are grams', listAmount(450, 'g'), { quantity: 450, unit: 'g' });
eq('kilos are kilos', listAmount(1, 'kg'), { quantity: 1, unit: 'kg' });
eq('millilitres are millilitres', listAmount(500, 'ml'), { quantity: 500, unit: 'ml' });
eq('pieces are pieces', listAmount(6, 'pcs'), { quantity: 6, unit: 'pcs' });

/*
 * Centilitres are all over Belgian drinks labelling and the list has no such
 * unit, so they are CONVERTED rather than dropped — and the quantity scales
 * with the unit, or the conversion would quietly change the amount.
 */
eq('centilitres become millilitres', listAmount(33, 'cl'), { quantity: 330, unit: 'ml' });
eq('...and the amount scales with them', listAmount(1.5, 'cl'), { quantity: 15, unit: 'ml' });
/*
 * Scaling is a multiplication and multiplication in binary floating point
 * leaves dust: 0.07 × 10 is 0.7000000000000001, and that reaches the screen as
 * the quantity. The first version of this assertion used 33.3, which happens to
 * multiply exactly — so it passed with the rounding deleted and proved nothing.
 */
eq('...without floating-point dust', listAmount(0.07, 'cl').quantity, 0.7);

/*
 * A line with no size at all — the coconut drink — breaks no constraint and
 * never did. Its price and pack count imported correctly while the litre items
 * lost theirs, which is the detail that identified the cause.
 */
eq('no unit is not a problem to solve', listAmount(null, null), { quantity: null, unit: null });
eq('...and a bare pack size survives it', listAmount(2, null), { quantity: 2, unit: null });

/*
 * A unit from neither vocabulary takes the quantity with it: a bare number in
 * the quantity field renders as an amount of nothing, which is a claim.
 */
eq('an unknown unit takes its quantity with it', listAmount(12, 'oz'), { quantity: null, unit: null });

/* --------------------------------------------- and through the planner -- */

{
  // The milk, exactly as the Delhaize scan produced it: four packs of one litre.
  const milk = [buy('m', '1L DLL VOLLE MELK', 356, { packs: 4, quantity: 1, unit: 'l' })];
  const rows = [{ id: 'i9', name: 'Milk', category: 'dairy_eggs', checked: false }];
  const decisions = new Map([['m', seed(milk[0], { itemId: 'i9' })]]);
  const plan = planCommit(RECEIPT, milk, decisions, rows, NOW);

  const patch = plan.patches.find((x) => x.itemId === 'i9').patch;
  eq('the list row gets a unit the database accepts', patch.unit, 'L');
  eq('...with the price that came down with it', patch.priceCents, 356);
  eq('...and the pack count', patch.packs, 4);

  /*
   * The purchase log is deliberately NOT converted. price_entries.unit is plain
   * text with no constraint, "l" is what the receipt said, and the history card
   * renders "€0.89 / l" from it.
   */
  eq('the log keeps the receipt’s own wording', plan.purchases[0].detail.unit, 'l');
}

{
  // The same crossing on the other path: a line that matched nothing becomes a
  // new row, and a new row is a list row with the same constraint on it.
  const drink = [buy('d', 'COLA 33CL', 199, { quantity: 33, unit: 'cl' })];
  const plan = planCommit(RECEIPT, drink, new Map([['d', seed(drink[0])]]), [], NOW);
  eq('a created row is converted too', plan.adds[0].detail.unit, 'ml');
  eq('...with its amount scaled', plan.adds[0].detail.quantity, 330);
}

/* -------------------------------------------------------------- the name */

console.log('\nthe name a purchase is filed under');

{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  const eggs = plan.purchases.find((p) => p.key === 'a');

  eq('a matched line uses the LIST’s spelling', eggs.name, 'Eggs');
  if (eggs.name === 'Eggs') {
    console.log('       (filing it under "eieren" would start a second egg history that');
    console.log('        never joins the first and never comes due)');
  }

  eq('and the list row’s category', eggs.category, 'dairy');

  const toast = plan.purchases.find((p) => p.key === 'b');
  eq('an unmatched line is filed under the PRODUCT name', toast.name, 'toast');
  if (toast.name === 'toast') {
    console.log('       (it becomes a PANTRY ITEM. "Provital toast 500 grams" cannot');
    console.log('        match the same shopping in another size next month)');
  }
  eq('and its own category', toast.category, 'other');
  eq(
    'the full description rides along, on the PURCHASE',
    toast.detail.description,
    'Provital toast 500 grams',
  );
  eq('...and the brand stays its own field', toast.detail.brand, 'Provital');
  eq('...as do the size and the count', [toast.detail.quantity, toast.detail.unit, toast.detail.packs], [500, 'g', 2]);
  eq(
    'none of which is in the name',
    /provital|500|grams/i.test(toast.name),
    false,
  );
}

/* -------------------------------------------------------------- the rest */

console.log('\nwhat gets planned');

{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);

  eq(
    'every purchase is stamped with the RECEIPT’s instant',
    plan.purchases.map((p) => p.detail.at),
    [Date.parse(LAST_NIGHT), Date.parse(LAST_NIGHT)],
  );
  if (plan.purchases[0].detail.at !== NOW) {
    console.log('       (this is what makes logPurchase amend last night\'s ticks rather');
    console.log('        than duplicate them — the session window measures from `at`)');
  }

  eq('brand rides on the purchase', plan.purchases[0].detail.brand, 'Boni');
  eq('and never on the name', plan.purchases[0].name.includes('Boni'), false);

  eq('packs and amount survive', plan.purchases[1].detail, {
    priceCents: 249, store: 'carrefour', quantity: 500, unit: 'g',
    packs: 2, brand: 'Provital', description: 'Provital toast 500 grams',
    at: Date.parse(LAST_NIGHT),
  });
}

{
  const plan = planCommit(
    RECEIPT,
    PURCHASES,
    decide({ b: { include: false, priceCents: 249, itemId: null } }),
    ROWS,
    NOW,
  );
  eq('an excluded line is not written', plan.purchases.map((p) => p.key), ['a']);
}

{
  const plan = planCommit(
    RECEIPT,
    PURCHASES,
    decide({ a: { include: true, priceCents: 1670, itemId: 'i1' } }),
    ROWS,
    NOW,
  );
  eq('the CORRECTED price is what is written', plan.purchases[0].detail.priceCents, 1670);
}

/* ------------------------------------------------------------ the ticks -- */

console.log('\nticking the list');

{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  eq('a matched, unticked row is ticked', plan.tick, ['i1']);
}

{
  const ticked = [{ ...ROWS[0], checked: true }, ROWS[1]];
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ticked, NOW);
  eq(
    'a row ALREADY ticked is left alone',
    plan.tick,
    [],
  );
  if (plan.tick.length === 0) {
    console.log('       (toggleItem toggles — an import that touched a ticked row would');
    console.log('        take it back off the shopping)');
  }
}

{
  const plan = planCommit(
    RECEIPT,
    PURCHASES,
    decide({ a: { include: false, priceCents: 299, itemId: 'i1' } }),
    ROWS,
    NOW,
  );
  eq('an excluded line ticks nothing', plan.tick, []);
}

/* ------------------------------------------------ what the list row learns */

console.log('\nthe list row');

/*
 * The import used to write a perfect purchase log and leave the list row
 * untouched, so a €6,49 shop imported cleanly and the list still said €0.00
 * with an empty quantity. The numbers existed, in the one place nobody opens.
 */
{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  eq('a matched row is patched', plan.patches.map((x) => x.itemId), ['i1']);
  eq('with everything the receipt is evidence about', plan.patches[0].patch, {
    quantity: null, unit: null, packs: 1, priceCents: 299, store: 'carrefour',
  });
  eq(
    'the store is overwritten too, on a MATCHED row',
    plan.patches[0].patch.store,
    'carrefour',
  );
  if (plan.patches[0].patch.store === 'carrefour') {
    console.log('       (a patch exists only where the shopper confirmed this line IS this');
    console.log('        item, so the receipt is proof of where it was bought, not a guess)');
  }
  eq(
    '...as the chain id, so the BUY AT chip can match it',
    plan.patches[0].patch.store,
    storeIdFor(RECEIPT.store),
  );
  eq(
    'an unmatched line patches nothing',
    plan.patches.filter((x) => x.itemId === 'i2').length,
    0,
  );
  if (plan.patches.every((x) => x.itemId !== 'i2')) {
    console.log('       (this is what makes overwriting `store` safe: a row is only');
    console.log('        touched where a line was confirmed to BE it)');
  }
}

{
  const plan = planCommit(
    RECEIPT,
    PURCHASES,
    decide({ a: { include: true, priceCents: 1670, itemId: 'i1' } }),
    ROWS,
    NOW,
  );
  eq('the CORRECTED price reaches the row too', plan.patches[0].patch.priceCents, 1670);
}

{
  const plan = planCommit(
    RECEIPT,
    PURCHASES,
    decide({ a: { include: false, priceCents: 299, itemId: 'i1' } }),
    ROWS,
    NOW,
  );
  eq('an excluded line patches nothing', plan.patches, []);
}

{
  // A row already ticked still gets its numbers — it was ticked in the aisle
  // with no price, which is exactly the row the receipt has most to say about.
  const ticked = [{ ...ROWS[0], checked: true }, ROWS[1]];
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ticked, NOW);
  eq('a row already ticked is still patched', plan.patches.map((x) => x.itemId), ['i1']);
  eq('...but not toggled', plan.tick, []);
}

{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  eq(
    'bio is never in the patch',
    Object.keys(plan.patches[0].patch).includes('bio'),
    false,
  );
  if (!Object.keys(plan.patches[0].patch).includes('bio')) {
    console.log('       (organic is the shopper\'s own claim about a product — no receipt');
    console.log('        knows it, so no receipt may overwrite it)');
  }
}

/* -------------------------------------------------------------- the store */

console.log('\nthe store a purchase is filed under');

/*
 * `receipt.store` is the printed header. Everywhere else in the app a store is
 * a catalogue id or a name the user typed, and the id is what every comparison
 * keys on — the BUY AT chip tests `item.store === entry.id`, and price-intel
 * groups both spend and "cheaper elsewhere" by this exact string.
 *
 * Write the header through and a household's stores fragment the same way a
 * brand inside a name fragments an item: `colruyt` set by hand and `Colruyt
 * Food Retail N.V.` set by a receipt are two shops that never compare, inside
 * a feature whose whole job is comparing them.
 */
{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);

  eq('the purchase gets the chain ID, not the printed header', plan.purchases[0].detail.store, 'carrefour');
  if (plan.purchases[0].detail.store === 'carrefour') {
    console.log('       (spend-by-store and "cheaper elsewhere" both group on this exact');
    console.log('        string, so the header would be a second Carrefour that never');
    console.log('        compares with the one the BUY AT chips write)');
  }

  eq(
    'the receipt ROW keeps the printed text',
    [plan.receipt.store, plan.receipt.storeId],
    ['CARREFOUR MARKET', 'carrefour'],
  );
}

{
  // An independent the catalogue has never heard of. The printed name is all
  // there is, and it is a perfectly good key — it just is not an id.
  const indie = { ...RECEIPT, store: 'EVEREST SUPERMARKT' };
  const plan = planCommit(indie, PURCHASES, decide(), ROWS, NOW);
  eq('an unknown shop keeps its printed name', plan.purchases[0].detail.store, 'EVEREST SUPERMARKT');
  eq('...with no id invented for it', plan.receipt.storeId, null);
}

{
  const noStore = { ...RECEIPT, store: null };
  const plan = planCommit(noStore, PURCHASES, decide(), ROWS, NOW);
  eq('a receipt with no header sets no store', plan.purchases[0].detail.store, null);
}

/* -------------------------------------------------------- the description */

console.log('\nthe description');

{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  const eggs = plan.purchases.find((p) => p.key === 'a');
  eq(
    'a MATCHED line keeps what the receipt called it',
    eggs.detail.description,
    'eieren',
  );
  if (eggs.detail.description === 'eieren') {
    console.log('       (filed under "Eggs", so this is the only surviving record of');
    console.log('        what was actually in the trolley)');
  }

  /*
   * An unmatched line now keeps its description too, and that is the change.
   *
   * It used to be filed under the full description, so the description was the
   * same string as the name and storing it twice said nothing. Filed under the
   * short PRODUCT name, the two differ — and the difference is exactly what the
   * purchase history is for: "toast" in the pantry, "Provital toast 500 grams"
   * beside the price.
   */
  const toastAgain = plan.purchases.find((p) => p.key === 'b');
  eq(
    'an unmatched line keeps its description, now that the name is shorter',
    [toastAgain.name, toastAgain.detail.description],
    ['toast', 'Provital toast 500 grams'],
  );

  eq(
    '...and a line whose description IS its name stores none',
    planCommit(
      RECEIPT,
      [buy('c', 'plums', 199, { product: 'plums', expanded: 'plums' })],
      new Map([['c', { include: true, priceCents: 199, itemId: null }]]),
      ROWS,
      NOW,
    ).purchases[0].detail.description,
    null,
  );
  console.log('       (the same string twice is a description that says nothing)');
}

/* --------------------------------------------------------- the receipt -- */

console.log('\nthe receipt row');

{
  const { receipt } = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);
  eq('the chain is resolved', receipt.storeId, 'carrefour');
  eq('and the printed text kept', receipt.store, 'CARREFOUR MARKET');
  eq(
    'total_cents is what the PAPER says was paid',
    receipt.totalCents,
    425,
  );
  if (receipt.totalCents === 425) {
    console.log('       (not the sum of the lines — that would make the mismatch');
    console.log('        unrecoverable, and the mismatch is the thing worth showing)');
  }
  eq('deposits and discounts are kept off the items', [receipt.depositCents, receipt.discountCents], [25, -100]);
  eq('the fingerprint travels', receipt.fingerprint, 'fp-1');
}

console.log('\nstoreIdFor');
eq('a chain inside a longer header', storeIdFor('COLRUYT SA 1234'), 'colruyt');
eq('a two-word chain', storeIdFor('Albert Heijn 1043'), 'albert_heijn');
eq('accents fold', storeIdFor('INTERMARCHE SUPER'), 'intermarche');
eq(
  'a chain named in the MIDDLE of a header',
  storeIdFor('Uw COLRUYT winkel Gent Zuid'),
  'colruyt',
);
eq(
  'a chain name INSIDE another word is not a match',
  storeIdFor('Baldini Delicatessen'),
  null,
);
eq('an unknown shop is null, not a guess', storeIdFor('EVEREST SUPERMARKT'), null);

/* ---------------------------------------------------- the write, in order */

console.log('\nthe write');

const sheet = readFileSync(join(SRC, 'app', 'receipt', 'review.tsx'), 'utf8');
const at = (needle) => sheet.indexOf(needle);

assert(
  at('claimReceipt(') > 0 && at('claimReceipt(') < at('logPurchase('),
  'the receipt is claimed BEFORE any purchase is written',
  'purchases first would double a household\'s spend on exactly the retry the fingerprint exists to survive',
);

assert(
  /if \(claim\.kind !== 'ok'\) \{[\s\S]{0,240}?return;/.test(sheet),
  'a refused claim writes nothing at all',
);

assert(
  /alreadyImported/.test(sheet),
  'a duplicate fingerprint is reported as already imported',
);

assert(
  /if \(committing \|\| !source\) return;/.test(sheet),
  'a second tap is refused before it reaches the database',
);

assert(
  at('logPurchase(') > 0 && at('logPurchase(') < at('toggleItem('),
  'purchases are written before the list is ticked',
);

assert(
  /receiptId: claim\.receiptId/.test(sheet),
  'every purchase carries the receipt it came from',
);

assert(
  !/from\('price_entries'\)/.test(sheet),
  'the sheet does not write price_entries itself',
  'it goes through logPurchase, so the amendment window and the burn-rate update are the ones the app already has — a second copy for receipts is how two windows drift apart',
);

/* ------------------------------------------- the columns actually written */

console.log('\npantry-intel carries the new fields');

const intel = readFileSync(join(SRC, 'store', 'pantry-intel.tsx'), 'utf8');

assert(
  /at: detail\?\.at \?\? now,/.test(intel),
  'a purchase is stamped with detail.at when one is given',
  'without it the receipt files last night\'s shop under this morning, and amends nothing',
);

assert(
  /recordPurchase\(statsRef\.current, name, category, detail\?\.at \?\? Date\.now\(\)\)/.test(intel),
  'the burn-rate model gets the same instant as the log',
  'otherwise a backdated receipt teaches the pantry the shopping happened today',
);

{
  // One row object serves both the insert and the update, which is what makes
  // an amended purchase carry the same columns as a fresh one.
  const row = /const row = \{[\s\S]*?\n        \};/.exec(intel);
  assert(row != null && /brand: entry\.brand/.test(row[0]), 'brand is on the written row');
  assert(row != null && /receipt_id: detail\?\.receiptId/.test(row[0]), 'receipt_id is on the written row');
  assert(
    row != null && intel.indexOf('.update(row)') > intel.indexOf(row[0]),
    'the same row is used for the amendment',
    'a brand written only on inserts would be missing from every purchase a receipt corrected — which is most of them',
  );
}

{
  const select = /\.select\('([^']*recorded_at)'\)/.exec(intel)?.[1] ?? '';
  for (const col of ['brand', 'description']) {
    assert(
      new RegExp(`\\b${col}\\b`).test(select),
      `${col} is read back, so an optimistic row and a refetched one agree`,
      'written but not selected, it exists on the server and is null on every device that did not write it',
    );
  }
}

assert(
  /description: entry\.description \?\? null,/.test(intel),
  'the description is written',
);

assert(
  /description: r\.description \?\? null,/.test(intel),
  '...and mapped back onto the Purchase',
);

/* -------------------------------------------------------- the entry point */

console.log('\nthe entry point');

const listScreen = readFileSync(join(SRC, 'app', 'list', '[id].tsx'), 'utf8');

assert(
  /pathname: "\/receipt\/capture"/.test(listScreen),
  'Scan receipt opens the capture screen',
);

assert(
  /if \(!user\) \{\s*router\.push\("\/auth\/sign-in"\);/.test(listScreen),
  'a signed-out visitor is sent to sign in first',
  'receipts.household_id is not null; asking for four photographs and a vision call before refusing would be worse',
);

/* ------------------------------------------------------------------------ */

/* ------------------------------------------- a multipack keeps its count -- */

/*
 * The reported case: "4 X 1L DLL VOLLE MELK". It reviewed correctly and then
 * lost its count somewhere, and the only way to know WHERE is to assert each
 * hand-off separately. This is the first one — what planCommit hands to the
 * list and to the log.
 *
 * It passes, which is the useful result: the count was never lost here. The
 * patch and the purchase both carried it into a database that stored it. It
 * was lost on the way back out — by a read that did not ask for every column,
 * and by two screens that printed one pack's size and called it the amount.
 * See check-purchase-log for both.
 */
console.log('\na multipack keeps its count');
{
  const four = buy('m', '4 X 1L DLL VOLLE MELK', 668, {
    packs: 4, quantity: 1, unit: 'l', brand: 'Delhaize',
    product: 'milk', expanded: 'Delhaize volle melk 1L',
  });
  const rows = [{ id: 'i9', name: 'Milk', category: 'dairy', checked: false }];
  const decisions = new Map([['m', seed(four, { itemId: 'i9' })]]);
  const plan = planCommit(RECEIPT, [four], decisions, rows, NOW);

  eq('the list row is patched with the pack count', plan.patches[0].patch.packs, 4);
  eq('...and one pack’s size, not the total', plan.patches[0].patch.quantity, 1);
  eq('...and the TOTAL paid, not the shelf price', plan.patches[0].patch.priceCents, 668);
  eq('the purchase carries the count too', plan.purchases[0].detail.packs, 4);
  eq('...with the same size', plan.purchases[0].detail.quantity, 1);
  eq('...and the same total', plan.purchases[0].detail.priceCents, 668);
  // Filed under the list's word, so the burn rate keeps one history.
  eq('...under the list’s own name', plan.purchases[0].name, 'Milk');
  eq('...with the till’s wording kept as the description', plan.purchases[0].detail.description, 'Delhaize volle melk 1L');
  eq('...and the brand kept apart from it', plan.purchases[0].detail.brand, 'Delhaize');
}

/* --------------------------------------------- the shopper's edits win -- */

/*
 * Every number on the review sheet is editable now, and planCommit reads the
 * DECISION rather than the scan. This asserts it behaviourally rather than by
 * reading the source: the decision here disagrees with the purchase on all
 * three fields, so a planner that reached for the scan would return the scan's
 * answers and be caught.
 *
 * A correction that never reaches the write is a correction the shopper watched
 * do nothing — the worst outcome available, because the screen said it worked.
 */
console.log('\ncorrections reach the write');
{
  // The scan read three packs of 500ml at €4.50. The shopper fixed all of it.
  const scanned = buy('e', 'DRINK', 450, { packs: 3, quantity: 500, unit: 'ml' });
  const rows = [{ id: 'i7', name: 'Drink', category: 'drinks', checked: false }];
  const corrected = new Map([
    ['e', { include: true, priceCents: 450, packs: 4, quantity: 1, unit: 'l', itemId: 'i7' }],
  ]);
  const plan = planCommit(RECEIPT, [scanned], corrected, rows, NOW);

  eq('the corrected pack count is imported', plan.patches[0].patch.packs, 4);
  eq('...and the corrected size', plan.patches[0].patch.quantity, 1);
  eq('...converted to a unit the database accepts', plan.patches[0].patch.unit, 'L');
  eq('the purchase log takes the correction too', plan.purchases[0].detail.packs, 4);
  eq('...keeping the receipt vocabulary it was typed in', plan.purchases[0].detail.unit, 'l');
}

/* ------------------------------------ a line nobody wrote down gets a row -- */

/*
 * "ALSO BOUGHT" used to reach the pantry and stop there, so the two halves of
 * one shop described different trips: the log knew about the chocolate, the
 * list did not, and the list is the screen the shopper opens afterwards to see
 * what the import did.
 */
console.log('\nlines that matched nothing');
{
  const plan = planCommit(RECEIPT, PURCHASES, decide(), ROWS, NOW);

  // 'a' matched i1; 'b' matched nothing.
  eq('only the unmatched line becomes a row', plan.adds.length, 1);
  eq('...under the same name the pantry files it under', plan.adds[0].name, plan.purchases[1].name);
  eq('...and never the till’s own printing', plan.adds[0].name === 'PROVITAL TOAST 500', false);
  eq('...in the same category', plan.adds[0].category, plan.purchases[1].category);
  eq('it carries the pack count', plan.adds[0].detail.packs, 2);
  eq('...the size of one pack', plan.adds[0].detail.quantity, 500);
  eq('...the total paid', plan.adds[0].detail.priceCents, 249);
  eq('...and the shop, resolved', plan.adds[0].detail.store, 'carrefour');

  // A matched line must never be added as well: it would be on the list twice,
  // once ticked by the patch and once as a fresh row.
  eq('a matched line is patched, not added', plan.patches.length, 1);

  // Excluded lines are excluded everywhere, not just from the log.
  const without = planCommit(RECEIPT, PURCHASES, decide({ b: { include: false, priceCents: 249, itemId: null } }), ROWS, NOW);
  eq('an excluded line adds nothing', without.adds.length, 0);
}

/*
 * The whole receipt against an EMPTY list, which is the ordinary case for
 * somebody who scans a receipt without having written a list at all. Every line
 * is unmatched, so every line becomes a bought row — and nothing is patched or
 * ticked, because there is nothing there to patch.
 */
{
  const plan = planCommit(RECEIPT, PURCHASES, decide({
    a: { include: true, priceCents: 299, itemId: null },
  }), [], NOW);
  eq('an empty list takes every line', plan.adds.length, 2);
  eq('...patching nothing', plan.patches.length, 0);
  eq('...and ticking nothing', plan.tick.length, 0);
  eq('...while the log still gets both', plan.purchases.length, 2);
}

/* ---------------------------------- and the writes that carry them out ---- */

/*
 * Structural, because the arithmetic above proves nothing on its own: a plan
 * with perfect `adds` that no screen applies is exactly the state this feature
 * was already in for the pantry half.
 */
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const review = strip(readFileSync(join(SRC, 'app', 'receipt', 'review.tsx'), 'utf8'));
  const store = strip(readFileSync(join(SRC, 'store', 'groceries.tsx'), 'utf8'));

  eq('the review applies the adds', /for \(const row of plan\.adds\) addBoughtItem\(list\.id, row, row\.detail\)/.test(review), true);
  // Last of the three list writes. A failure part-way through must not leave a
  // list holding new rows for a shop whose matched rows never got their prices.
  eq('...after the patches', review.indexOf('plan.adds') > review.indexOf('plan.patches'), true);
  eq('...and after the ticks', review.indexOf('plan.adds') > review.indexOf('plan.tick'), true);

  /*
   * Both backends, and the same row from both. A receipt imported signed-out
   * has to land as the same row as one imported signed-in, which is why the
   * shape is built in one place and only the writing differs.
   */
  eq('both backends implement it', (store.match(/addBoughtItem: \(listId, item, detail\)/g) ?? []).length, 2);
  eq('...from one row builder', (store.match(/boughtRow\(item, detail\)/g) ?? []).length, 2);
  eq('the row arrives ticked', /checked: true,\s*checkedAt: now,/.test(store), true);
  // checked and checked_at disagreeing is the one state that must never exist —
  // see lib/list-sweep, which owns the rule.
  eq('...with its timestamp, in the same insert', /checked: true,\s*checked_at: new Date\(/.test(store), true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
