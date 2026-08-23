#!/usr/bin/env node
/**
 * The reconciler, against five real receipts.
 *
 * ---------------------------------------------------------------------------
 * Why these fixtures are the point
 * ---------------------------------------------------------------------------
 *
 * Receipt scanning writes money into the price history, and a language model
 * reading a photo cannot be asserted correct. What CAN be asserted is that the
 * arithmetic a receipt prints about itself agrees with the arithmetic we
 * derive from the lines — and that the rule doing the deriving works on real
 * paper rather than on an idealised layout nobody prints.
 *
 * So these are transcriptions of five actual receipts, from three countries and
 * five chains, each chosen for a shape the others do not have:
 *
 *   CARREFOUR  pack size in the NAME, count in a `#` column, weights on a
 *              sub-line to 3dp, and an article count to check them against.
 *   EVEREST    multiplier LEADING each line, a weight printed to 2dp when it
 *              was measured to 3 — the case that breaks a flat tolerance — and
 *              Belgian 5-cent cash rounding.
 *   COLRUYT    a `Hoev.` column carrying both kinds, unit prices to 3dp, a
 *              deposit COLUMN, and a discount as a negative line inside the
 *              item block.
 *   KAUFLAND   no quantity column at all, a weighed line with NO unit price,
 *              and a deposit as a section-headed line.
 *   ALDI       a deposit whose maths is in its name, and a deposit RETURN as a
 *              negative line.
 *
 * Between them they exercise every branch. If the rule needs a per-chain
 * special case, one of these will say so.
 *
 * ---------------------------------------------------------------------------
 * And the mutations
 * ---------------------------------------------------------------------------
 *
 * Passing on correct input proves little on its own — a reconciler that
 * returned `ok` unconditionally would pass every fixture above. So each check
 * is also run against a deliberately corrupted copy: a digit changed, a line
 * dropped, a weight reclassified as a count. Those must fail, and fail on the
 * check that owns that kind of error.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SHARED = join(here, '..', '..', '..', 'supabase', 'functions', '_shared');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, detail = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const d of detail) console.log(`  ${d}`);
};

const src = readFileSync(join(SHARED, 'receipt-reconcile.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { reconcile, classify, fingerprint } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
);

/* ----------------------------------------------------------- fixtures ---- */

/** A counted line: n packs at a per-pack price. */
const count = (raw, n, unitCents, totalCents, dp = { m: 0, p: 2 }) => ({
  raw, kind: 'item', multiplier: n, multiplierKind: 'count',
  multiplierDp: dp.m, unitPriceCents: unitCents, unitPriceDp: dp.p, totalCents,
});
/** A weighed line: kg at a per-kg price. */
const weigh = (raw, kg, perKgCents, totalCents, dp = 3) => ({
  raw, kind: 'item', multiplier: kg, multiplierKind: 'measure',
  multiplierDp: dp, unitPriceCents: perKgCents, unitPriceDp: 2, totalCents,
});
/** A line printing only a total — no multiplier, no unit price. */
const flat = (raw, totalCents, kind = 'item') => ({
  raw, kind, multiplier: null, multiplierKind: 'count',
  multiplierDp: null, unitPriceCents: null, unitPriceDp: null, totalCents,
});

const CARREFOUR = {
  name: 'Carrefour Market Heverlee',
  lines: [
    count('CAMPINA ENT TE 1L', 4, 167, 668),
    count('COCA ZER.OCAF 1,5L', 1, 234, 234),
    count('ALPRO KOKO ONG.1L', 2, 339, 678),
    count('ALPRO PROT DRK NAT', 2, 299, 598),
    weigh('TOMATE(S)N', 0.9, 199, 179),
    weigh('BUTTERNUT', 0.9, 199, 179),
    weigh('CLEMENTINES', 0.931, 319, 297),
    count('CAR SENS WRAP VOLK', 1, 199, 199),
    weigh('COURGETTES/N', 0.422, 199, 84),
    count('SIMPL SAL MIX 200G', 1, 70, 70),
    count('BANANEN PAPILLON', 1, 259, 259),
    count('PP/N1 MUESLI 1 KG', 2, 205, 410),
    count('CAR EIREN X30', 1, 899, 899),
    count('DANONE SKYR 450G', 2, 251, 502),
    count('PROU PROT WB', 1, 495, 495),
    count('DELIO CHICKY SAMOU', 1, 359, 359),
  ],
  totals: { goodsCents: 6110, paidCents: 6110, articleCount: 23 },
};

const EVEREST = {
  name: 'Everest BVBA, Leuven',
  lines: [
    count('1 x indiagate premium basmati rice 5kg', 1, 1595, 1595),
    count('1 x trs mustard oil 1 li', 1, 695, 695),
    // The line that breaks a flat tolerance: printed 0,49, measured 0,488.
    weigh('0,49 x paneer nvf (8,95/kg)', 0.49, 895, 437, 2),
    count('1 x trs turmeric powder 100gr', 1, 95, 95),
    count('1 x trs turmeric powder 100gr', 1, 95, 95),
    count('1 x gazi ayaran 250ml', 1, 80, 80),
    count('1 x gazi ayaran 250ml', 1, 80, 80),
    { ...flat('after rounding', -2, 'rounding') },
  ],
  totals: { goodsCents: 3077, paidCents: 3075, articleCount: null },
};

const COLRUYT = {
  name: 'Colruyt Cadi Heverlee',
  lines: [
    count('BONI Griekse yoghurt 10% 1kg', 1, 179, 179),
    count('BONI scharrelei Belgisch M 12st', 1, 449, 449),
    count('komkommer', 1, 69, 69),
    count('DUVEL Blond 6,66% blik 33cl', 1, 174, 174),
    count('TRIPEL KARMELIET Blond 8,0% blik 33cl', 1, 197, 197),
    // Unit price to three decimals — the other half of the tolerance rule.
    count('COCA-COLA Zero Sugar 15cl', 12, 52.3, 628, { m: 0, p: 3 }),
    count('FUZE TEA Green Lime-Mint 40cl', 1, 132, 132),
    count('FUZE TEA No Sugar Bl.Tea Peach-Eld. 40cl', 1, 132, 132),
    count('FUZE TEA Black Tea Peach-Hibiscus 40cl', 1, 129, 129),
    count('EVERYDAY Volle melk brik 1L', 2, 88.7, 177, { m: 0, p: 3 }),
    count('ALPRO kokosnootdrink 1L', 4, 259, 1036),
    count('FERRERO ROCHER tab.hazelno-melk cho. 90g', 1, 199, 199),
    count("CÔTE D'OR Bouchée Mini 122g", 1, 395, 395),
    count('BONI assortiment pralines 250g', 2, 449, 898),
    count('ASTRIO Pralines Dubai style 165g', 1, 649, 649),
    count('HAMLET pralines ballotin 250g', 1, 799, 799),
    count('RAFFAELLO T23 230g', 3, 419, 1257),
    count("CÔTE D'OR Mignonnette Melk 240g", 1, 399, 399),
    count('BONI Chocolade zeevruchten 250g', 3, 219, 657),
    count("BOUNTY mini's 333g", 1, 429, 429),
    count('MARS mini 333g', 1, 314, 314),
    count('BONI Cookies chocolade 225g', 3, 88, 264),
    count('DELACRE Marquisettes 175g', 1, 299, 299),
    count('LOTUS BISCOFF specu. specul.crème 15x10g', 1, 179, 179),
    count('LOTUS BISCOFF Specu.gevu.chocolad 15x10g', 1, 195, 195),
    count('JULES DESTROOPER boterwafels choco. 175g', 1, 349, 349),
    count('BONI Luikse wafels mini Cacaofant. 8x42g', 2, 214, 428),
    weigh('Rode uien', 1.208, 179, 216),
    weigh('San Marzano Romatomaat', 0.486, 389, 189),
    weigh('aubergine', 0.372, 169, 63),
    weigh('PAPILLON bananen ±1kg', 1.04, 249, 259),
    { ...count('Korting Colruyt Trakteert 1182', 1, -1000, -1000), kind: 'discount' },
  ],
  totals: { goodsCents: 11739, paidCents: 10739, articleCount: null },
};

const KAUFLAND = {
  name: 'Kaufland Bad Rappenau',
  lines: [
    flat('Baguette 250g', 49),
    flat('Bas.Rindfl.Topf', 129),
    flat('Coca-Cola', 352),
    flat('Jac.Krönung gemah.', 375),
    flat('Olmützer Quargel', 99),
    flat('Trauben 500g hell', 209),
    flat('Pfandartikel', 100, 'deposit'),
    // Weighed, and the unit price is simply not printed.
    { ...weigh('Schweineschnitzel 0,329 kg', 0.329, null, 125), unitPriceDp: null },
    flat('Hähnchenbrustfilet', 139),
    flat('Bratenkasseler', 99),
    flat('Ferr.Duplo', 139),
    flat('Kinder Bueno', 149),
    flat('K.XXL.Katzennahr.', 400),
  ],
  // Summe includes the deposit, so goods alone is 23,64 − 1,00.
  totals: { goodsCents: 2264, paidCents: 2364, articleCount: null },
};

const ALDI = {
  name: 'Aldi Süd Freiburg',
  lines: [
    flat('Pfandrückgabe Pfandbon', -100, 'deposit'),
    flat('Gold-Bier', 179),
    { ...count('Pfand 6 x EUR 0,25', 6, 25, 150), kind: 'deposit' },
    flat('Fairtrade-Bio Bananen', 169),
    flat('Kiwi grün', 35),
    flat('Kiwi grün', 35),
    flat('Avocado', 119),
    flat('Avocado', 119),
    flat('Mini-Rispentomaten 500', 149),
  ],
  // 8 Artikel against 9 lines — the deposit RETURN is not an article, and the
  // Pfand charge is. Goods = 8,55 − 1,50 + 1,00.
  totals: { goodsCents: 805, paidCents: 855, articleCount: 8 },
};

const RECEIPTS = [CARREFOUR, EVEREST, COLRUYT, KAUFLAND, ALDI];

/* ------------------------------------------- every real receipt holds ---- */

let reconciled = 0;
for (const r of RECEIPTS) {
  const res = reconcile(r.lines, r.totals);
  if (res.ok) {
    reconciled += 1;
    ok(`${r.name} reconciles`);
  } else {
    fail(`${r.name} does not reconcile`, res.problems);
  }
}
console.log(
  `\n     reconciliation rate ${reconciled}/${RECEIPTS.length} = ` +
    `${Math.round((100 * reconciled) / RECEIPTS.length)}%\n`,
);

/* ------------------------------------------------- and the mutations ----- */

/*
 * A reconciler that always returned ok would pass everything above. Each of
 * these breaks one thing and names the check that must notice.
 */
const mutate = (r, f) => {
  const copy = { lines: r.lines.map((l) => ({ ...l })), totals: { ...r.totals } };
  f(copy);
  return reconcile(copy.lines, copy.totals);
};

const mustFail = (what, res, expect) => {
  if (res.ok) return fail(`${what} — but it reconciled anyway`);
  if (!res.problems.some((p) => p.includes(expect))) {
    return fail(`${what} — failed, but not on the right check`, res.problems);
  }
  ok(what);
};

mustFail(
  'a digit changed in a line total is caught',
  mutate(CARREFOUR, (r) => { r.lines[0].totalCents = 686; }),
  'do not multiply out',
);

mustFail(
  'a line dropped entirely is caught by the goods total',
  mutate(COLRUYT, (r) => { r.lines.splice(5, 1); }),
  'items add up to',
);

mustFail(
  'a duplicated line — an overlap between two photos — is caught',
  mutate(CARREFOUR, (r) => { r.lines.push({ ...r.lines[9] }); }),
  'items add up to',
);

mustFail(
  'a missed discount is caught by the paid total, not the goods total',
  mutate(COLRUYT, (r) => { r.lines.pop(); }),
  'was paid',
);

/*
 * The realistic misclassification, and the only one the article check alone can
 * catch: the model reads the weight correctly and calls it a pack count. The
 * line still multiplies out — 0,9 × 1,99 really is 1,79 — so LINE, GOODS and
 * PAID all pass. Only the article count notices that you cannot buy nine tenths
 * of an article.
 */
mustFail(
  'a weight labelled as a pack count is caught by the article count alone',
  mutate(CARREFOUR, (r) => { r.lines[4].multiplierKind = 'count'; }),
  'articles',
);

mustFail(
  'a deposit imported as an item is caught',
  mutate(KAUFLAND, (r) => { r.lines[6].kind = 'item'; }),
  'items add up to',
);

/*
 * And the case the tolerance exists for, in both directions: the Everest weight
 * must pass, and a genuinely wrong figure at the same precision must not.
 */
{
  const res = reconcile([EVEREST.lines[2]], { goodsCents: null, paidCents: null, articleCount: null });
  if (res.badLines.length === 0) ok('a weight printed to 2dp still reconciles');
  else fail('the display-precision tolerance is too tight', res.problems);
}
mustFail(
  '...but a real misread at that precision is still caught',
  mutate(EVEREST, (r) => { r.lines[2].totalCents = 537; }),
  'do not multiply out',
);

/* ------------------------------------------------------ classify() ------- */

const cls = (m, u, want) => {
  const got = classify(m, u);
  if (got === want) ok(`classify(${m}, ${u ?? 'null'}) = ${want}`);
  else fail(`classify(${m}, ${u ?? 'null'})`, [`expected ${want}, got ${got}`]);
};
cls(4, null, 'count');
cls(1, null, 'count');
cls(0.9, null, 'measure');
cls(1.208, 'kg', 'measure');
// An integer weight is still a weight — 1 kg of onions is not one onion.
cls(1, 'kg', 'measure');
cls(null, null, 'count');
cls(12, 'pcs', 'count');

/* ---------------------------------------------------- fingerprint() ------ */

{
  const a = fingerprint('Carrefour Market Heverlee', 6110, '2026-08-18T19:27:00Z');
  const b = fingerprint('carrefour market  heverlee', 6110, '2026-08-18T19:27:31Z');
  if (a === b) ok('a re-scan of the same receipt fingerprints the same');
  else fail('the fingerprint moves between scans of one receipt', [a, b]);

  const c = fingerprint('Carrefour Market Heverlee', 6111, '2026-08-18T19:27:00Z');
  if (a !== c) ok('...and a different total is a different receipt');
  else fail('two different totals fingerprint the same');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
