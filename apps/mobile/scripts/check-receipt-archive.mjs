/**
 * Saved receipts — what is kept, what it survives, and what a correction does
 * to the purchases the first import wrote.
 *
 * ---------------------------------------------------------------------------
 * The two failures this exists for
 * ---------------------------------------------------------------------------
 *
 * 1. A CORRECTION THAT ADDS INSTEAD OF REPLACING. The first import wrote
 *    purchases. Fixing a price and saving has to REWRITE them; log them again
 *    and a week's shopping is counted twice. That is the same damage migration
 *    0038's fingerprint prevents — through a door the fingerprint does not
 *    cover, because the receipt is not being imported twice, its lines are. And
 *    it is silent: nothing on any screen says "this is the second copy".
 *
 * 2. A SAVED MATCH THAT ROTS. During a live review "matched" means a row on a
 *    shopping list. Those rows are deleted by the sweep once the shop is over,
 *    so persisting a row id would make every saved receipt decay into "nothing
 *    was matched" within days — indistinguishable from a shopper who really did
 *    skip every line. What is persisted is the ITEM the line was filed under,
 *    which is what the purchase log is keyed on and what still means something
 *    in a month.
 *
 * Run with `pnpm --filter mobile check:receipt-archive`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const REPO = join(here, '..', '..', '..');

/*
 * Loaded by stripping every import and concatenating the one module it needs at
 * runtime. `packScan` calls `normalizeKey`, and a loader that stubbed that
 * import out would leave the single most important line in the file — what a
 * saved decision points AT — untested, while every assertion around it passed.
 * check-item-tip shipped exactly that hole and it is why this is written out.
 */
const strip = (text) => text.replace(/^import\s[\s\S]*?;$/gm, '');
const pantry = readFileSync(join(SRC, 'lib', 'pantry-intel.ts'), 'utf8');
// The real thing, lifted with the regex it depends on. A hand-written stand-in
// here would be a second definition of item identity, which is exactly the
// class of divergence this file is checking for elsewhere.
const normalizeKeySrc = [
  /const PG_SPACE = [^\n]*/.exec(pantry)?.[0] ?? '',
  /export const normalizeKey[\s\S]*?;\n/.exec(pantry)?.[0] ?? '',
].join('\n');
if (!normalizeKeySrc.includes('toLowerCase')) {
  console.log('FAIL normalizeKey could not be lifted out of pantry-intel');
  process.exit(1);
}

const combined = `${normalizeKeySrc}\n${strip(
  readFileSync(join(SRC, 'lib', 'receipt-archive.ts'), 'utf8'),
)}`;
const { outputText } = ts.transpileModule(combined, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
};
const assert = (name, ok) => check(name, ok, true);

/* ================================================================== pack == */

const receipt = { store: 'Colruyt', decimalComma: true, paidCents: 1000, fingerprint: 'f' };
const purchases = [
  { key: 'a', name: 'CAR EIEREN X30', priceCents: 349, packs: 1, quantity: 30, unit: 'pcs' },
  { key: 'b', name: 'RODE AJUIN', priceCents: 129, packs: 2, quantity: 500, unit: 'g' },
  { key: 'c', name: 'STATIEGELD', priceCents: 25, packs: 1, quantity: null, unit: null },
];
const decisions = new Map([
  ['a', { include: true, priceCents: 349, packs: 1, quantity: 30, unit: 'pcs', itemId: 'row-1' }],
  ['b', { include: true, priceCents: 129, packs: 2, quantity: 500, unit: 'g', itemId: null }],
  ['c', { include: false, priceCents: 25, packs: 1, quantity: null, unit: null, itemId: null }],
]);
// What planCommit resolved: only INCLUDED lines are filed anywhere.
const filed = [
  { key: 'a', name: 'Eggs', category: 'dairy_eggs' },
  { key: 'b', name: 'onion', category: 'fruit_veg' },
];

const packed = mod.packScan(receipt, purchases, decisions, filed);

check('every line is kept, not only the imported ones', packed.purchases.length, 3);
check('...and every decision with them', packed.decisions.length, 3);
check('the document carries its own version', packed.version, mod.SCAN_VERSION);

/*
 * THE MATCH IS AN ITEM, NEVER A LIST ROW.
 *
 * `row-1` is a shopping-list id and it must not appear anywhere in the saved
 * document. The sweep deletes that row within days of the shop; a saved receipt
 * pointing at it would reopen as "matched to nothing" and be indistinguishable
 * from a line the shopper deliberately skipped.
 */
const eggs = packed.decisions.find((d) => d.key === 'a');
check('a saved match is the item key it was filed under', eggs.itemKey, 'eggs');
check('...with the spelling it was filed under', eggs.name, 'Eggs');
check('...and its category', eggs.category, 'dairy_eggs');
assert(
  'no shopping-list id survives into the document',
  !JSON.stringify(packed).includes('row-1'),
);

/*
 * An EXCLUDED line has no item, and inventing one would be worse than leaving
 * it null: the reopened receipt would show a match that no row in the purchase
 * log corresponds to.
 */
const deposit = packed.decisions.find((d) => d.key === 'c');
check('an excluded line is filed nowhere', [deposit.include, deposit.itemKey], [false, null]);

/* ================================================================ unpack == */

const back = mod.unpackScan(JSON.parse(JSON.stringify(packed)));
check('a document round-trips', back.decisions.length, 3);
check('...keeping the item keys', back.decisions.map((d) => d.itemKey), ['eggs', 'onion', null]);
check('...and the prices', back.decisions.map((d) => d.priceCents), [349, 129, 25]);

/*
 * EVERY REFUSAL RETURNS NULL, AND THE SCREEN SAYS SO.
 *
 * The value comes out of a jsonb column an older build wrote and a newer one
 * has to read. A shape it does not recognise must not be read against the
 * fields it expects — the result would be a review sheet full of undefined over
 * purchases that are very much real, and a shopper "correcting" it to nothing.
 */
check('null is refused', mod.unpackScan(null), null);
check('a receipt with no scan is refused', mod.unpackScan(undefined), null);
check('a string is refused', mod.unpackScan('{}'), null);
check('a future version is refused', mod.unpackScan({ ...packed, version: 99 }), null);
check('a version-less document is refused', mod.unpackScan({ ...packed, version: undefined }), null);
check('a document with no lines is refused', mod.unpackScan({ ...packed, purchases: [] }), null);
check('...and one with no receipt', mod.unpackScan({ ...packed, receipt: null }), null);

/*
 * A damaged DECISION is dropped on its own rather than taking the document with
 * it. One unreadable row out of forty should cost that one line its saved
 * opinion, not the shopper's ability to open the receipt at all — the line
 * reappears included at its printed price, which is where a fresh scan starts.
 */
const holed = mod.unpackScan({
  ...packed,
  decisions: [...packed.decisions, { key: null, priceCents: 'lots' }],
});
/*
 * Asserted in two steps, and the first step is the point.
 *
 * Written as one line — `holed.decisions.length` — a regression that made this
 * return null did not FAIL, it threw, and a guard that crashes takes every
 * assertion after it down with it while reporting no failure at all. Found by
 * mutation. Same class as the loader hole check-item-tip shipped.
 */
assert('a damaged decision does not sink the document', holed != null);
check('...and the sound ones survive it', holed?.decisions.length ?? 0, 3);

// A pack count of zero divides into the unit price on the screen that shows it.
const zeroed = mod.unpackScan({
  ...packed,
  decisions: [{ ...packed.decisions[0], packs: 0 }],
});
check('a pack count of zero is read as one', zeroed.decisions[0].packs, 1);

/* ============================================================== the rules = */

const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const store = code(readFileSync(join(SRC, 'store', 'pantry-intel.tsx'), 'utf8'));
const commit = code(readFileSync(join(SRC, 'lib', 'receipt-commit.ts'), 'utf8'));
const archive = code(readFileSync(join(SRC, 'lib', 'receipt-archive.ts'), 'utf8'));
const migration = readFileSync(
  join(REPO, 'supabase', 'migrations', '0041_receipt_scan.sql'),
  'utf8',
);

const amend = /amendReceipt: \(receiptId, planned\) => \{[\s\S]*?\n      \},/.exec(store)?.[0] ?? '';
assert('amendReceipt is extractable', amend.length > 0);

/*
 * OUT BEFORE IN. The delete is what makes a correction a correction rather than
 * a second import, and it has to be scoped to THIS receipt — a delete by item
 * key would take purchases the shopper logged by hand.
 */
assert('a correction deletes what the receipt wrote', /\.eq\('receipt_id', receiptId\)/.test(amend));
assert(
  '...scoped to this receipt and no other',
  /const previous = purchasesRef\.current\.filter\(\(p\) => p\.receiptId === receiptId\)/.test(amend),
);
assert(
  '...and does not insert when the delete failed',
  /if \(error\) \{\s*void fetchPurchases\(\);\s*return;\s*\}/.test(amend),
);

/*
 * The pantry is REBUILT for both sides of the change. A line re-matched from
 * coffee to tea has to leave coffee's history as surely as it joins tea's, and
 * an item whose only purchase was a line just removed must leave the pantry
 * rather than keep a burn rate learned from a purchase that no longer exists.
 * `recordPurchase` is incremental and has no inverse — see revertPurchase,
 * which reaches for the same function for the same reason.
 */
assert('the pantry is rebuilt from the log', /statsFromPurchases\(mine, categorizeSync\)/.test(amend));
assert('...for both sides of the change', /for \(const p of previous\) touched\.add/.test(amend));
assert('...and for what the correction adds', /for \(const e of entries\) touched\.add/.test(amend));
assert(
  '...with an emptied item removed entirely',
  /delete rebuilt\[key\]/.test(amend) && /\.in\('item_key', gone\)/.test(amend),
);
/*
 * Settings survive. A staple flag or a pinned cadence is not a consequence of a
 * price having been typed wrong, and rebuilding over the top would silently
 * undo a choice the shopper made on a different screen.
 */
assert(
  "...without wiping the shopper's own settings",
  /rebuilt\[key\] = \{ \.\.\.rebuilt\[key\], \.\.\.fresh \}/.test(amend),
);
/*
 * NOT foldPurchase. Folding merges a correction into the transaction still open
 * for that item; every line of one receipt shares a single timestamp, so it
 * would collapse two genuinely different lines of the same shop — two bags of
 * the same coffee, priced separately by the till — into one.
 */
assert('the receipt lines are not folded into each other', !/foldPurchase/.test(amend));

/*
 * AND THE LIST IS LEFT ALONE. Not caution: the rows this receipt ticked were
 * swept away days ago, and today's list belongs to next week's shop.
 */
/*
 * Both modes have to EXIST. Matching only the type's name passed against a
 * declaration narrowed to `'import'` alone — the amend path would have been
 * unreachable and every assertion here still green. Found by mutation.
 */
assert(
  'the planner knows the two modes apart',
  /export type CommitMode = 'import' \| 'amend';/.test(commit),
);
assert(
  'an amendment plans no list work at all',
  /if \(mode === 'amend'\) continue;/.test(commit),
);
const planBody = /export function planCommit[\s\S]*?\n}/.exec(commit)?.[0] ?? '';
assert('...before anything is pushed to tick or patch',
  planBody.indexOf("if (mode === 'amend') continue;") < planBody.indexOf('patches.push'));

/*
 * The scan is written AFTER the writes that matter, and its failure is
 * survivable. Put in front of them it becomes one more thing that can turn a
 * good import into a failed one; what is actually at stake is the ability to
 * open the receipt again.
 */
assert('a failed scan write is reported, not swallowed',
  /reportWriteFailure\('receipts\.scan', error\)/.test(archive));

/*
 * A correction may not rewrite the fingerprint. It identifies the PAPER, and a
 * correction that could change it could smuggle a second import of the same
 * receipt past the unique index — which is the one thing 0038 exists to stop.
 */
const reconciled = /export async function saveReconciled[\s\S]*?\n}/.exec(archive)?.[0] ?? '';
assert('a correction rewrites only what a correction can move',
  reconciled.includes('reconciled') && !/fingerprint|total_cents|store/.test(reconciled));

// The column, and the mtime that is not the scan time.
assert('the scan has somewhere to live', /add column if not exists scan jsonb/.test(migration));
assert('...and a correction has its own timestamp',
  /add column if not exists edited_at timestamptz/.test(migration));
assert('scanned_at is left alone', !/alter column scanned_at|drop column scanned_at/.test(migration));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
