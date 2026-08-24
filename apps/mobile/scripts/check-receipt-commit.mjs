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
const lifted = receiptLib.match(/export function displayName[\s\S]*?\n\}/);
if (!lifted) {
  fail('displayName could not be lifted out of lib/receipt', [
    'It has moved or been renamed; this check cannot verify the name a',
    'purchase is filed under without it.',
  ]);
}

const source = [
  supermarkets,
  (lifted?.[0] ?? '').replace(
    /: Pick<ReceiptPurchase, [^>]*>/,
    '',
  ).replace(/\): string \{/, ') {'),
  commit
    .replace(/^import .*$/gm, '')
    .replace(/export async function claimReceipt[\s\S]*?\n\}/, ''),
].join('\n');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { planCommit, purchaseInstant, storeIdFor } = mod;

/* --------------------------------------------------------------- fixtures */

const NOW = Date.parse('2026-08-24T10:00:00Z');
const LAST_NIGHT = '2026-08-23T18:42:00Z';

const buy = (key, name, priceCents, over = {}) => ({
  key, name, raw: [name.toUpperCase()], expanded: null, translated: null,
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
  buy('b', 'DOUNE BINBAGZ 20st', 249, {
    packs: 2, quantity: 20, unit: 'st', expanded: 'bin bags',
  }),
];

// The shopper's own spellings, and one row already ticked off in the aisle.
const ROWS = [
  { id: 'i1', name: 'Eggs', category: 'dairy', checked: false },
  { id: 'i2', name: 'Bread', category: 'bakery', checked: true },
];

const decide = (over = {}) =>
  new Map([
    ['a', { include: true, priceCents: 299, itemId: 'i1' }],
    ['b', { include: true, priceCents: 249, itemId: null }],
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

  const bags = plan.purchases.find((p) => p.key === 'b');
  eq('an unmatched line uses the model’s expansion', bags.name, 'bin bags');
  if (bags.name === 'bin bags') {
    console.log('       (it becomes a PANTRY ITEM — filed under the printing it would');
    console.log('        carry the till\'s abbreviations and its OCR slips forever)');
  }
  eq('and its own category', bags.category, 'other');
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
    priceCents: 249, store: 'carrefour', quantity: 20, unit: 'st',
    packs: 2, brand: null, description: null, at: Date.parse(LAST_NIGHT),
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
    'an unmatched line patches nothing',
    plan.patches.filter((x) => x.itemId === 'i2').length,
    0,
  );
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
  eq('...and so does the list row', plan.patches[0].patch.store, 'carrefour');
  if (plan.patches[0].patch.store === 'carrefour') {
    console.log('       (the BUY AT chip tests item.store === entry.id, so the header');
    console.log('        would show as a custom shop and match no chip at all)');
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

  const bags = plan.purchases.find((p) => p.key === 'b');
  eq(
    'an unmatched line stores no description',
    bags.detail.description,
    null,
  );
  if (bags.detail.description === null) {
    console.log('       (it is already filed under the expansion — the same string twice');
    console.log('        is a description that says nothing)');
  }
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
  /if \(committing \|\| !run\) return;/.test(sheet),
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
