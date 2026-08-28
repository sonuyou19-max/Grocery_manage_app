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
const check_ = (what, cond) => (cond ? ok(what) : fail(what));
const fail = (what, detail = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const d of detail) console.log(`  ${d}`);
};

const src = readFileSync(join(SHARED, 'receipt-reconcile.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { reconcile, classify, fingerprint, MONEY_CODES } = await import(
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

/* ------------------------- the extract function's contract --------------- */

/*
 * The receipt is read by a model, and the fields it returns are the ONLY thing
 * the reconciler above can act on. A field the prompt never explains gets
 * narrated from its name — which is how a count of every list row once became
 * "you grabbed 17 items this week", and how `multiplierDp` would quietly become
 * "however many decimals seem right" rather than "however many were printed".
 *
 * Same assertion as check-recap-payload, for the same reason and against a far
 * more expensive call.
 */
const fn = readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', 'receipt-scan', 'index.ts'), 'utf8');


/**
 * The example ANSWER, and only that — not the paragraph explaining it.
 *
 * The slice used to run to "WHAT EVERY FIELD MEANS", which swept in the prose
 * under the JSON. That prose names fields in order to talk about them, so a
 * field mentioned there counted as demonstrated in the example — the check
 * could be satisfied by a sentence rather than by the thing a model copies.
 */
const exampleJson = (src) => {
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT'));
  const text = prompt.slice(0, prompt.indexOf('`;'));
  const from = text.indexOf('{"store"');
  const to = text.indexOf(']}', from);
  return from < 0 || to < 0 ? '' : text.slice(from, to + 2);
};

{
  const schema = fn.match(/const lineSchema = z\.object\(\{[\s\S]*?\n\}\);/);
  const receipt = fn.match(/const receiptSchema = z\.object\(\{[\s\S]*?\n\}\);/);
  if (!schema || !receipt) {
    fail('the receipt schemas are gone or renamed', ['This check cannot verify anything without them.']);
  } else {
    const fields = [
      ...[...schema[0].matchAll(/^  (\w+):/gm)].map((m) => m[1]),
      ...[...receipt[0].matchAll(/^  (\w+):/gm)].map((m) => m[1]),
    ].filter((f) => f !== 'lines');

    const prompt = fn.slice(fn.indexOf('const SYSTEM_PROMPT'));
    const text = prompt.slice(0, prompt.indexOf('`;'));
    const defs = text.slice(text.indexOf('WHAT EVERY FIELD MEANS'), text.indexOf('\nRULES.'));

    // Introduced under the definitions, as `- name:` or `- a / b:`. A mention
    // in a later rule is not a definition — check-recap-payload learned that
    // one the hard way, by passing a deliberately broken prompt.
    const undef = fields.filter((f) => !new RegExp(`\\b${f}\\b\\s*(?::|/)`).test(defs));
    if (undef.length) {
      fail(`${undef.length} extracted field(s) the prompt never explains`, [
        ...undef.map((f) => `  ${f}`),
        '',
        'The model answers from the field NAME when nothing defines it.',
      ]);
    } else {
      ok(`all ${fields.length} extracted fields are defined in the prompt`);
    }

    // And the example object, which is what a model actually copies. The
    // categorize function shipped for weeks answering with two of its five keys
    // because the example named two.
    const example = exampleJson(fn);
    /*
     * `expanded` and `translated` are alternatives — one description per line,
     * in the reader's language — so the example can only ever demonstrate one
     * of them. Whichever it shows, the other must be absent, which is the
     * assertion above. Requiring both here would demand exactly the answer that
     * costs the shopper a second description on every line.
     */
    const ALTERNATIVES = ['expanded', 'translated'];
    const shown = ALTERNATIVES.some((f) => example.includes(`"${f}"`));
    const missing = fields.filter(
      (f) => !example.includes(`"${f}"`) && !(shown && ALTERNATIVES.includes(f)),
    );
    if (missing.length) {
      fail(`${missing.length} field(s) missing from the prompt's example object`, [
        ...missing.map((f) => `  ${f}`),
        '',
        'A model handed an example answers with that example. See fe4d3ba.',
      ]);
    } else {
      ok('...and every one appears in the example object');
    }
  }
}

/*
 * Three structural rules the arithmetic cannot enforce, each of which would
 * silently disable a check above.
 */
check_(
  'the function reconciles server-side rather than trusting the parse',
  /reconcile\(lines, \{/.test(fn),
);
check_(
  'a failed reconciliation is repaired on a stronger model',
  /MODEL_CAREFUL/.test(fn) && /better\.problems\.length < result\.problems\.length/.test(fn),
);
/*
 * ONE full transcription, ever.
 *
 * The escalation used to be a second `ask` — every line on the paper read again
 * on a slower model, which is roughly two thousand output tokens generated
 * twice, and output is what the shopper actually waits for. It is a REPAIR now:
 * the same images, the numbers already read, and the rows in dispute.
 *
 * Counted rather than described, because the way this regresses is somebody
 * reaching for `ask` again — it is right there, it works, and it is the reason
 * a seventeen-line receipt took minutes.
 */
check_(
  'the receipt is transcribed exactly once',
  (fn.match(/await ask\(/g) ?? []).length === 1,
);
check_(
  '...and the repair asks only for corrections',
  /const repair = async \(/.test(fn) && /max_tokens: REPAIR_TOKENS/.test(fn),
);
/*
 * THE REPAIR IS TOLD THE SIZE OF THE GAP.
 *
 * The first version sent only the rows that failed to multiply out, as an
 * either/or against the totals case. On a real Delhaize receipt that pointed at
 * one row while the damage was a different line read sixty cents light: the
 * repair looked exactly where it was told, found nothing, and cost three
 * seconds to change nothing.
 *
 * A totals mismatch names no row, but it names the AMOUNT — and an amount is
 * something you can scan a column of figures for. Both halves go now, because a
 * receipt can have one row whose arithmetic is broken AND a different row read
 * wrongly.
 */
check_(
  '...told which rows do not multiply out',
  /Rows \$\{disputed\.join\(', '\)\} do not multiply out/.test(fn),
);
check_(
  '...AND by how much the totals are out',
  /a difference of \$\{Math\.abs\(gap\)\} cents/.test(fn),
);
check_(
  '...with the direction stated, not left to be worked out',
  /gap > 0 \? 'TOO LOW' : 'TOO HIGH'/.test(fn),
);
/*
 * Not an either/or. `if` twice, never a ternary between them — the ternary is
 * exactly what shipped and exactly what failed.
 */
check_(
  '...and the two are not alternatives',
  /if \(disputed\.length > 0\)/.test(fn) && /for \(const d of details\)/.test(fn),
);
check_(
  '...the reconciler’s own numbers reaching it',
  /await repair\(parsed, result\.badLines, result\.details\)/.test(fn),
);
/*
 * And the prompt must not undo it. It used to read "your job is the rows in
 * dispute and nothing else" — precisely the wrong instruction when the evidence
 * is a shortfall against the printed total, because the row responsible for that
 * is usually one nobody named. A better hint and a prompt that forbids acting on
 * it is no better than the old hint.
 */
check_(
  '...and the prompt does not fence it into those rows',
  !/rows in dispute and nothing else/.test(fn) && /not where to stop/.test(fn),
);
/*
 * A CORRECTED ROW MUST STILL MULTIPLY OUT.
 *
 * The repair closed a 60-cent gap against the printed total and the scan still
 * came back with one row not multiplying out. Raising a row's total to make the
 * sums agree breaks that row's own arithmetic unless one of the other two
 * numbers moves with it — and nothing in the prompt said so, while the
 * acceptance rule (fewer problems than before) happily keeps a repair that
 * trades three failures for one.
 */
check_(
  'the repair is told a row it corrects must still multiply out',
  /A ROW YOU CORRECT MUST STILL MULTIPLY OUT/.test(fn) &&
    /Sending a total alone is right only when/.test(fn),
);

/*
 * And the log names the row. "1 line does not multiply out" is a count, and a
 * count cannot be acted on — it says a row is wrong without saying which, so
 * finding it meant reading the paper beside the screen.
 */
/*
 * Scoped to the LOG call, not searched across the file. `badLines:
 * result.badLines,` also appears in the response payload at the bottom of the
 * function, so a whole-file match passed with the log line deleted — it was
 * asserting on the response the device already had.
 */
const logCall = fn.slice(
  fn.indexOf("at: 'receipt-scan',"),
  fn.indexOf('Teach the shared dictionary'),
);
check_('the log block was found', logCall.length > 100 && logCall.length < 3000);
check_('the log names which rows failed', /badLines: result\.badLines,/.test(logCall));
check_(
  '...with the three numbers that did not multiply out',
  /badRows: result\.badLines\.map/.test(logCall) &&
    /unit: l\.unitPriceCents, total: l\.totalCents/.test(logCall),
);
/*
 * But NOT what was bought. A function log is not the place for somebody's
 * shopping, and the index is enough to find the row in the response the device
 * already holds.
 */
check_('...and not what was bought', !/badRows[\s\S]{0,300}raw:/.test(logCall));

/* --------------------------------------------- the matcher's own prompt -- */

/*
 * A different function, checked here because it is the same failure: the model
 * matched "RODE AZIJN 750G" — red vinegar — to a list row called "red onion",
 * on the one word they share. The device now vetoes that (see receipt.ts), but
 * a veto that has to fire is a round trip nobody needed.
 */
const matcher = readFileSync(
  join(here, '..', '..', '..', 'supabase', 'functions', 'receipt-match', 'index.ts'),
  'utf8',
);
check_(
  'the matcher is told an adjective is not the product',
  /AN ADJECTIVE IS NOT THE PRODUCT/.test(matcher),
);
check_(
  '...and to require the nouns to agree',
  /require\s+those to agree/.test(matcher) && /If the nouns do not agree, answer null/.test(matcher),
);
check_(
  '...and that a shared aisle is not a match either',
  /Two things from the same aisle are not\s+each other/.test(matcher),
);
/*
 * A repair big enough to re-transcribe is a repair that has not understood the
 * question. Capping it means such an answer fails to parse and the first
 * reading stands, rather than costing a second full read to arrive there.
 */
check_(
  '...within a budget too small to re-transcribe',
  /const REPAIR_TOKENS = (\d+)/.test(fn) && Number(fn.match(/const REPAIR_TOKENS = (\d+)/)[1]) <= 2048,
);
/*
 * The repair is handed numbers, not prose. Every name it reads back is a token
 * the shopper waits for, and the names were never in dispute.
 */
check_(
  '...and is not sent the names it does not need',
  /raw: l\.raw\.slice\(0, 40\)/.test(fn) && !/expanded: l\.expanded/.test(fn.slice(fn.indexOf('const repair'))),
);
/*
 * A fix for a row the reading does not have is the one answer that could
 * corrupt a good line, and renumbering is exactly what the prompt forbids.
 */
check_(
  'a fix for a line that does not exist is dropped',
  /const line = lines\[f\.i\];\s*if \(!line\) continue;/.test(fn),
);
/*
 * The lexicon offer has to carry an EMOJI. offerToLexicon drops any candidate
 * without one, so an offer built from the expansion alone would be a silent
 * no-op — the compounding this feature depends on, quietly doing nothing.
 */
check_(
  'lexicon offers carry the glyph the matcher actually compares',
  /emoji: l\.emoji as string/.test(fn) && /l\.emoji\)/.test(fn),
);
check_(
  '...filed under the RAW printed line, not the expansion',
  /term: l\.raw/.test(fn),
);
/* Images are the cost. An unbounded one is somebody else's budget. */
check_('image size and count are bounded', /MAX_IMAGE_CHARS/.test(fn) && /MAX_IMAGES/.test(fn));
check_(
  'the budget reservation counts the images, not just the prompt',
  /images\.length \* 6_400/.test(fn),
);

/*
 * The model has no clock. Without today's date it cannot distinguish a receipt
 * dated in the future from one it misread — and it does misread them: a Colruyt
 * receipt printed 30/07/2026 came back as 2028, on two separate scans.
 *
 * The device catches an impossible date and substitutes now(), so nothing bad
 * lands either way. But a substituted date is a worse answer than a correct
 * one, and the fix costs one line of context.
 */
if (/Today is \$\{new Date\(\)\.toISOString\(\)/.test(fn)) {
  ok("today's date is sent with the images");
} else {
  fail("today's date is sent with the images", [
    'The prompt tells the model a receipt cannot be dated after today, which',
    'is only checkable if it is told what today is.',
  ]);
}

check_('...and the prompt says a future date is a misreading', /A receipt cannot be dated in the future/.test(fn));

/*
 * The expansion is what the app SHOWS and what an unmatched line becomes in the
 * pantry, so what the prompt asks for there is load-bearing. Two things:
 * the brand must stay out of it (it has its own field, and a brand inside a
 * product name fragments that item's history), and the model is expected to
 * correct the camera's slips rather than pass DOUNE through as a product word.
 */
{
  const promptText = fn.slice(fn.indexOf('const SYSTEM_PROMPT'));
  const defs = promptText.slice(promptText.indexOf('- expanded:'), promptText.indexOf('- translated:'));
  /*
   * The rule moved. It used to sit on `expanded`, which was being asked to be a
   * readable description AND the item's identity at once — and the model
   * resolved that tension toward description every time, so pantry entries came
   * out as "Provital toast 50 pieces" and "1 litre Delhaize full fat milk".
   *
   * Two fields now, one job each: `product` is short and is what the shopper
   * ends up with, `expanded` is complete and is what the purchase history
   * shows. Asserting both, because the pair only works if each stays in its
   * lane.
   */
  const productDef = promptText.slice(promptText.indexOf('- product:'), promptText.indexOf('- expanded:'));
  check_('the PRODUCT name is asked for without brand, size or count', /No brand, no size, no pack count/.test(productDef));
  check_('...and short enough to be a pantry entry', /Two or three words/.test(productDef));
  check_('...in the reader’s language, since it becomes their item', /READER's language/.test(productDef));
  check_('the expansion is allowed to be complete', /completeness is what matters here/.test(defs));
  check_('...and is where scanning slips get corrected', /FIX what the camera got wrong/i.test(defs));
  check_('...but never a number', /never a number/.test(defs));
}

/* --------------------------------------- the retry, and what it is worth --- */

/*
 * The retry is a whole second vision call on a slower model — the single
 * largest thing a shopper waits for. A seventeen-line Delhaize receipt took
 * over two minutes, and most of that was reading it twice.
 *
 * The COUNT check does not justify that. It already accepts two conventions
 * because the chains disagree with each other, so a receipt satisfying neither
 * is usually a third convention nobody has catalogued — and re-reading the
 * pixels cannot fix a counting rule. The money checks are the opposite: they
 * are evidence that a NUMBER was misread, which is exactly what a better look
 * fixes.
 */
{
  const codesOf = (r) => r.details.map((d) => d.code).join(',');

  // A count-only failure, built by claiming an article count nothing supports.
  const countOnly = reconcile(
    [
      { raw: 'A', kind: 'item', multiplier: 1, multiplierKind: 'count', multiplierDp: 0,
        unitPriceCents: 100, unitPriceDp: 2, totalCents: 100 },
    ],
    { goodsCents: 100, paidCents: 100, articleCount: 9 },
  );
  check_('a count-only mismatch is coded as such', codesOf(countOnly) === 'count');
  check_('...and nothing about money is claimed', !countOnly.details.some((d) => MONEY_CODES.includes(d.code)));

  // A line that does not multiply out.
  const badLine = reconcile(
    [
      { raw: 'A', kind: 'item', multiplier: 2, multiplierKind: 'count', multiplierDp: 0,
        unitPriceCents: 100, unitPriceDp: 2, totalCents: 500 },
    ],
    { goodsCents: 500, paidCents: 500, articleCount: 2 },
  );
  check_('a misread number IS coded as money', badLine.details.some((d) => d.code === 'line'));
  check_('...so it is worth a second look', badLine.details.some((d) => MONEY_CODES.includes(d.code)));

  check_(
    'every failed check contributes a code',
    countOnly.problems.length === countOnly.details.length &&
      badLine.problems.length === badLine.details.length,
  );
}

{
  const gate = /const worthRetrying = result\.details\.some\(\(d\) => MONEY_CODES\.includes\(d\.code\)\);/;
  check_('the function gates its retry on money', gate.test(fn));
  check_(
    '...and only retries when the first read actually failed',
    /if \(!result\.ok && worthRetrying\)/.test(fn),
  );
}

{
  check_(
    'the prompt asks for null fields to be omitted',
    /OMIT any field you would answer null/.test(fn),
  );
  /*
   * ONE DESCRIPTION PER LINE, and this is the rule that costs real time.
   *
   * `expanded` and `translated` are the same sentence in two languages, and the
   * app shows one of them — displayName prefers `translated` and falls back.
   * Asking for both on a Dutch receipt read in English is a whole second
   * description typed per line, on the one field that is a sentence rather than
   * a number, and output is what the shopper waits for: a 93-second read that
   * the phone gave up on before it finished.
   *
   * The rule used to be half-stated — drop `translated` when it would repeat
   * `expanded` — which covers a Dutch reader and says nothing about the case
   * that actually costs anything.
   */
  check_(
    '...and for exactly one description per line, never the pair',
    /WRITE THE DESCRIPTION ONCE/.test(fn) && /Never both\./.test(fn),
  );
  /*
   * And the EXAMPLE has to obey it. A model handed an example answers with that
   * example whatever the prose says — the example here demonstrated writing
   * both, on the very line the prose was about to forbid.
   */
  {
    check_(
      '...which the example object demonstrates rather than contradicts',
      !(exampleJson(fn).includes('"expanded"') && exampleJson(fn).includes('"translated"')),
    );
  }
  check_(
    'no `name` field is asked for, because `raw` is the printing',
    !/^\s*name: z\./m.test(fn),
  );
}

{
  check_('the read is timed', /readMs = Date\.now\(\) - started;/.test(fn));
  check_('...and so is the retry', /retryMs = Date\.now\(\) - retryAt;/.test(fn));
  check_(
    '...and both are logged, so "it took two minutes" is answerable',
    /at: 'receipt-scan'/.test(fn) && /readMs,/.test(fn) && /retryMs,/.test(fn),
  );
}

/* ----------------------------- the prompt rules this receipt forced ------- */

/*
 * A Delhaize receipt came back with every price from the seventh line down
 * shifted onto the product above it. The model had read the names down one
 * column and the amounts down the other, and a single missed row put every
 * remaining amount against the wrong thing — with each amount genuinely
 * present on the paper, so nothing looked invented.
 *
 * Two rules answer it, and the second is the one that matters most: the printed
 * totals are the only thing on the receipt that can CONTRADICT the model. A
 * subtotal derived from its own lines agrees with its own lines however wrong
 * they are, which turns the whole reconciliation into a tautology.
 */
check_('the prompt says to read across rows, not down columns', /READ ACROSS EACH ROW, NEVER DOWN THE COLUMNS/.test(fn));
check_('...and names the failure it prevents', /shifts every\s+remaining price onto the wrong product/.test(fn));
check_('the model is told to check its own sum first', /ADD UP THE LINES YOU HAVE WRITTEN AND COMPARE THE SUM WITH\s+THE PRINTED TOTAL/.test(fn));
check_('...and never to move the printed total to fit', /Do not adjust the\s+printed total to fit your lines/.test(fn));
check_('goodsCents is READ, never derived', /READ IT OFF THE PAPER\. Never add up your own lines/.test(fn));
check_('...and so is paidCents', /paidCents: the amount actually paid, also READ OFF THE PAPER and never\s+computed/.test(fn));
check_('the date rule names the middle number', /The middle number is the month/.test(fn));

/* ------------------ the numbers travel; the sentence is the client's ------ */

/*
 * The reconciler used to write the sentence and the review sheet printed it
 * verbatim, so a shopper holding a receipt that says €48,02 was shown
 *
 *     ITEMS ADD UP TO 4827 BUT THE RECEIPT SAYS 5020
 *
 * — cents as bare integers, in English, on a phone that might be running in any
 * of seven languages. Neither is fixable on a server: the separator, the symbol
 * and its position come from the reader's locale, and so does the language.
 */
{
  const r = reconcile(
    [
      { raw: 'A', kind: 'item', multiplier: 1, multiplierKind: 'count', multiplierDp: 0,
        unitPriceCents: 100, unitPriceDp: 2, totalCents: 100 },
    ],
    { goodsCents: 4827, paidCents: 4718, articleCount: 9 },
  );

  const goods = r.details.find((d) => d.code === 'goods');
  check_('a goods failure carries both numbers, in cents', goods.got === 100 && goods.printed === 4827);

  const paid = r.details.find((d) => d.code === 'paid');
  check_('...and so does a paid failure', paid.got === 100 && paid.printed === 4718);

  const count = r.details.find((d) => d.code === 'count');
  check_(
    'a count failure carries BOTH readings it accepts',
    count.units === 1 && count.asLines === 1 && count.printed === 9,
  );

  check_(
    'no detail carries a formatted string',
    r.details.every((d) => Object.values(d).every((v) => typeof v === 'number' || typeof v === 'string' && d.code === v)),
  );
}

check_(
  'the wire sends the details, not the prose',
  /problems: result\.details,/.test(fn),
);
check_(
  '...and the prose survives only in the log',
  /problems: result\.problems,/.test(fn) && /at: 'receipt-scan'/.test(fn),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
