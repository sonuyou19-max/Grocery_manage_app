/**
 * Cheaper-elsewhere check.
 *
 * This card names a shop and puts a figure next to it, which makes it the most
 * assertive thing Korb says. It is also behind the Plus gate, so it is
 * something people pay for. A wrong answer here is worse than no card at all.
 *
 * It shipped wrong. `cheaperStoreHints` compared raw prices, and quantity never
 * reached it — Insights mapped the purchase log down to name/price/store and
 * dropped the rest — so one litre at €1.20 beat two litres at €2.00 and the
 * card recommended the shop that was 20% dearer per litre.
 *
 * Nothing could have caught that except a test with two different quantities in
 * it, which is the first case below.
 *
 * Run with `pnpm --filter mobile check:price-intel`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib');

/** Compile a pure module and run it, resolving its `@/lib/...` imports. */
const compile = (file, req) => {
  const js = ts.transpileModule(readFileSync(join(LIB, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
};

const pantryIntel = compile('pantry-intel.ts', () => ({}));
const purchaseLog = compile('purchase-log.ts', () => ({}));
const priceIntel = compile('price-intel.ts', (spec) => {
  if (spec === '@/lib/pantry-intel') return pantryIntel;
  if (spec === '@/lib/purchase-log') return purchaseLog;
  return {};
});
const { cheaperStoreHints, spendByStore } = priceIntel;

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

/** A priced purchase. quantity/unit default to "not given". */
const buy = (name, store, priceCents, quantity = null, unit = null) => ({
  name,
  store,
  priceCents,
  quantity,
  unit,
});

/* ------------------------------------------------ the bug that shipped */

// €1.20 for 1 L at Lidl, €2.00 for 2 L at Carrefour. Carrefour is cheaper per
// litre — €1.00 against €1.20 — and the old code said Lidl, confidently.
const mixedQty = cheaperStoreHints([
  buy('Milk', 'lidl', 120, 1, 'L'),
  buy('Milk', 'carrefour', 200, 2, 'L'),
]);
check('the bigger bottle wins when it is cheaper per litre', mixedQty[0]?.cheapStore, 'carrefour');
check('...and the figures shown are per unit', mixedQty[0]?.cheapCents, 100);
check('...with the dearer one also per unit', mixedQty[0]?.dearCents, 120);
check('...labelled with the unit they are per', mixedQty[0]?.perUnit, 'L');

/* --------------------------------------------------- units never cross */

// Litres against kilos is meaningless whatever the numbers say.
check(
  'litres are never compared with kilos',
  cheaperStoreHints([buy('Rice', 'lidl', 200, 1, 'kg'), buy('Rice', 'aldi', 100, 1, 'L')]).length,
  0,
);

// A bare price might have been for one litre or for six. It is only ever
// compared with other bare prices — never assumed to be a single unit.
check(
  'a quantified price is never compared with an unquantified one',
  cheaperStoreHints([buy('Oil', 'lidl', 300, 3, 'L'), buy('Oil', 'aldi', 200)]).length,
  0,
);

/* --------------------------------------------- plain prices still work */

const flat = cheaperStoreHints([buy('Bread', 'lidl', 250), buy('Bread', 'aldi', 180)]);
check('unquantified prices still compare', flat[0]?.cheapStore, 'aldi');
check('...and carry no unit label', flat[0]?.perUnit, null);
check('...at face value', flat[0]?.cheapCents, 180);

/* ------------------------------------------------------- the old rules */

check('one shop is not a comparison', cheaperStoreHints([buy('Eggs', 'lidl', 300)]).length, 0);
check(
  'the same price at two shops is not a saving',
  cheaperStoreHints([buy('Eggs', 'lidl', 300), buy('Eggs', 'aldi', 300)]).length,
  0,
);
check(
  'an item with no shop is skipped',
  cheaperStoreHints([buy('Eggs', null, 300), buy('Eggs', 'aldi', 100)]).length,
  0,
);
// The lowest price seen at each shop is the one that counts — a one-off
// premium buy should not make your usual shop look expensive.
const repeats = cheaperStoreHints([
  buy('Coffee', 'lidl', 900),
  buy('Coffee', 'lidl', 500),
  buy('Coffee', 'aldi', 700),
]);
check('the cheapest seen at each shop is used', repeats[0]?.cheapStore, 'lidl');
check('...which is the low one, not the last one', repeats[0]?.cheapCents, 500);

/* -------------------------------------- one row per item, biggest first */

// Milk logged both ways, each way with two shops. Both buckets are valid; the
// bigger saving is the one worth showing, and only one row about milk.
const twoBuckets = cheaperStoreHints([
  buy('Milk', 'lidl', 120, 1, 'L'),
  buy('Milk', 'aldi', 110, 1, 'L'),
  buy('Milk', 'carrefour', 300),
  buy('Milk', 'delhaize', 150),
]);
check('an item logged two ways yields one row', twoBuckets.length, 1);
check('...and it is the bigger saving', twoBuckets[0]?.cheapCents, 150);

const ordered = cheaperStoreHints([
  buy('Tea', 'lidl', 200),
  buy('Tea', 'aldi', 190),
  buy('Jam', 'lidl', 400),
  buy('Jam', 'aldi', 100),
]);
check('the biggest saving is listed first', ordered[0]?.name, 'Jam');

/* --------------------------------------------- spendByStore is untouched */

// Totals must NOT be normalised: what you spent at a shop is what you spent,
// whether it went on one big bottle or four small ones.
check(
  'spendByStore still sums whole prices',
  spendByStore([buy('Milk', 'lidl', 200, 2, 'L'), buy('Bread', 'lidl', 150)]),
  [{ store: 'lidl', cents: 350 }],
);

/* ------------------------------------------------------------ edge cases */

check(
  'a zero quantity does not divide by zero',
  cheaperStoreHints([buy('Milk', 'lidl', 120, 0, 'L'), buy('Milk', 'aldi', 100, 0, 'L')]).length,
  0,
);
check('an empty log gives no hints', cheaperStoreHints([]).length, 0);
check(
  'a blank name is skipped',
  cheaperStoreHints([buy('   ', 'lidl', 100), buy('   ', 'aldi', 200)]).length,
  0,
);
// Spelling and case must not split one item into two.
const drift = cheaperStoreHints([buy('milk', 'lidl', 200), buy('Milk', 'aldi', 100)]);
check('spelling drift still groups as one item', drift.length, 1);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
