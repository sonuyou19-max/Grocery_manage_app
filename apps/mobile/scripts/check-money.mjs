/**
 * Money formatting: one implementation, and it must survive the UI thread.
 *
 * ---------------------------------------------------------------------------
 * What this is protecting
 * ---------------------------------------------------------------------------
 *
 * Spend figures now count to their new value, which means formatting them
 * sixty times a second on Reanimated's UI thread. That runtime is not the JS
 * one: worklets capture a COPY of what they close over, and only simple things
 * survive the trip. A Set, a Map, a module-level mutable, or anything reaching
 * for Intl either fails outright or — worse — silently formats differently
 * there than it does in the static text beside it.
 *
 * The obvious way to build the counter was a small formatter inside the
 * component. That is two implementations of one rule, and they would agree in
 * English and part company in Polish, on whichever screen nobody rebuilt. So
 * `assembleMoney` is a worklet in i18n/regions and `formatMoney` calls it —
 * a worklet is an ordinary function when called from JS, so both threads run
 * the same lines by construction.
 *
 * This file checks the things that construction depends on, none of which a
 * typecheck can see:
 *
 *   1. `assembleMoney` still carries the 'worklet' directive.
 *   2. It touches nothing that cannot cross into the UI runtime.
 *   3. `formatMoney` still delegates rather than growing its own copy.
 *   4. The output is right, for every locale and currency the app ships.
 *
 * Run with `pnpm --filter mobile check:money`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const REGIONS = join(here, '..', 'src', 'i18n', 'regions.ts');

const raw = readFileSync(REGIONS, 'utf8');

let failures = 0;
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};
const check = (title, actual, expected) => {
  if (Object.is(actual, expected)) console.log(`ok   ${title}`);
  else fail(title, [`expected ${JSON.stringify(expected)}`, `actual   ${JSON.stringify(actual)}`]);
};

/** The body of a top-level function declaration, comments stripped. */
const bodyOf = (name) => {
  const start = raw.indexOf(`export function ${name}(`);
  if (start === -1) return null;
  const open = raw.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < raw.length; i += 1) {
    if (raw[i] === '{') depth += 1;
    else if (raw[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw
          .slice(open, i + 1)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
      }
    }
  }
  return null;
};

/* ------------------------------- 1. it is still a worklet ---------------- */

const assemble = bodyOf('assembleMoney');
if (assemble == null) {
  fail('i18n/regions.ts must export assembleMoney', [
    'components/animated-money.tsx calls it from a worklet. If it moved, move',
    'this check with it.',
  ]);
} else if (!/^\s*\{\s*['"]worklet['"];/.test(assemble)) {
  fail("assembleMoney has lost its 'worklet' directive", [
    'Without it the Babel plugin does not compile the function for the UI',
    'runtime, and a counting figure either throws or silently stops updating.',
    "The directive must be the FIRST statement in the body.",
  ]);
} else {
  console.log("ok   assembleMoney is marked 'worklet'");
}

/* --------------------- 2. it captures nothing that cannot cross ---------- */

/*
 * Worklets copy what they capture. These are the things that do not survive,
 * and each of them is something the JS-side formatter used to use — the
 * currency lookup was an object literal and the decimal-comma test was a Set,
 * which is exactly why the parts are resolved on the JS thread and passed in.
 */
const FORBIDDEN = [
  ['Intl', /\bIntl\./],
  ['a Set lookup', /\.\s*has\s*\(/],
  ['a Map lookup', /\bMap\b/],
  ['the CURRENCY_SYMBOL table', /\bCURRENCY_SYMBOL\b/],
  ['the COMMA_DECIMAL set', /\bCOMMA_DECIMAL\b/],
];

if (assemble) {
  const caught = FORBIDDEN.filter(([, re]) => re.test(assemble)).map(([label]) => label);
  if (caught.length) {
    fail('assembleMoney reaches for something a worklet cannot capture', [
      ...caught.map((c) => `  ${c}`),
      'Worklets get a COPY of what they close over, and rich values do not make',
      'the trip. Resolve it on the JS thread in moneyParts() and pass the result',
      'in as a plain string or boolean.',
    ]);
  } else {
    console.log('ok   ...and touches only primitives');
  }
}

/* -------------------- 3. formatMoney has not grown its own copy ---------- */

const format = bodyOf('formatMoney');
if (format == null) {
  fail('i18n/regions.ts must export formatMoney');
} else if (!/assembleMoney\s*\(/.test(format)) {
  fail('formatMoney no longer delegates to assembleMoney', [
    'Two formatters is the bug this arrangement exists to prevent: they agree',
    'in English and disagree in a comma-decimal locale, and the screen that',
    'shows both is the only place it is visible.',
  ]);
} else {
  console.log('ok   formatMoney delegates rather than duplicating');
}

/* ----------------------------- 4. the output is actually right ----------- */

const js = ts.transpileModule(raw, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const { formatMoney: fmt, assembleMoney: asm, moneyParts: parts } = mod;

/*
 * REGIONS, not languages — which is the change these fixtures caught.
 *
 * The decimal mark used to be looked up by UI language, so a Belgian household
 * reading the app in English got British formatting for Belgian money. It is a
 * property of the country somebody shops in, and nothing to do with the
 * language they read.
 *
 * Point-decimal prefix, comma-decimal prefix, and a suffix currency — the three
 * shapes, in countries the app ships to.
 */
check('IE/EUR', fmt(1250, 'EUR', 'IE'), '€12.50');
check('DE/EUR uses a decimal comma and a space', fmt(1250, 'EUR', 'DE'), '€ 12,50');
check('FR/EUR', fmt(1250, 'EUR', 'FR'), '€ 12,50');
check('NL/EUR', fmt(1250, 'EUR', 'NL'), '€ 12,50');
check('PL/PLN puts the symbol after', fmt(1250, 'PLN', 'PL'), '12,50 zł');
check('GB/GBP', fmt(1250, 'GBP', 'GB'), '£12.50');
/*
 * The case the language lookup got wrong, pinned directly: same money, same
 * country, and it must not matter what language the app is being read in.
 */
check('BE/EUR is Belgian however the app is read', fmt(1250, 'EUR', 'BE'), '€ 12,50');
check('an unknown currency falls back to the euro', fmt(100, 'XYZ', 'GB'), '€1.00');
check('zero', fmt(0, 'EUR', 'GB'), '€0.00');
check('a negative amount keeps its sign', fmt(-550, 'EUR', 'GB'), '€-5.50');
check('rounding is to two places', fmt(1, 'EUR', 'GB'), '€0.01');

/*
 * The two paths must agree on every combination, not just the ones spot-checked
 * above — that equality is the whole reason assembleMoney exists.
 */
const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'nl', 'pl'];
const CURRENCIES = ['EUR', 'PLN', 'GBP', 'SEK', 'DKK', 'NOK', 'CZK', 'RON', 'HUF'];
const AMOUNTS = [0, 1, 99, 100, 1250, 99999, -550];

let mismatch = null;
let combos = 0;
for (const language of LANGUAGES) {
  for (const currency of CURRENCIES) {
    const p = parts(currency, language);
    for (const minor of AMOUNTS) {
      combos += 1;
      const viaStatic = fmt(minor, currency, language);
      const viaWorklet = asm(minor, p);
      if (viaStatic !== viaWorklet) {
        mismatch = { language, currency, minor, viaStatic, viaWorklet };
        break;
      }
    }
  }
}

if (mismatch) {
  fail('the static and animated formatters disagree', [
    `${mismatch.language}/${mismatch.currency} at ${mismatch.minor}:`,
    `  static  ${mismatch.viaStatic}`,
    `  worklet ${mismatch.viaWorklet}`,
  ]);
} else {
  console.log(`ok   both paths agree across all ${combos} locale/currency/amount combinations`);
}

/*
 * The counting figure interpolates, so it renders fractional minor units on the
 * way. Those must format cleanly rather than showing a float — a total reading
 * "€12.4999999" for one frame is worse than not animating at all.
 */
const midFlight = asm(1249.6837, parts('EUR', 'GB'));
if (!/^€\d+\.\d{2}$/.test(midFlight)) {
  fail('a mid-animation value does not format to two places', [
    `assembleMoney(1249.6837) gave ${midFlight}`,
    'The counter passes fractional minor units every frame while interpolating.',
  ]);
} else {
  console.log(`ok   a mid-animation value formats cleanly (${midFlight})`);
}

/* ================================================================== reading */

/*
 * READING A TYPED NUMBER — which had no coverage here at all, and was wrong.
 *
 * parsePriceToCents did `input.replace(',', '.')` — one comma, no count — then
 * stripped everything but digits and dots. "1.234,56" became "1.234.56", which
 * parseFloat reads as 1.234, so a €1234.56 shop was entered as €1.23. The same
 * for "1,234.56". EVERY four-figure amount typed with a thousands separator was
 * out by a factor of a thousand, in every country, and nothing looked.
 *
 * The rules below are the ones that make the ambiguous cases decidable rather
 * than guessed. They are the whole feature, so they are all pinned.
 */
{
  const load = async (rel, ...strip) => {
    let src = readFileSync(join(here, '..', 'src', rel), 'utf8')
      .replace(/^import\s+type\s[^;]*?;/gm, '');
    for (const d of strip) {
      src = src.replace(new RegExp(`^import\\s[^;]*?from '${d.replace(/[/@]/g, '\\$&')}';`, 'gm'), '');
    }
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
  };
  const money = await load('lib/money.ts', '@korb/shared', '@/i18n/regions');
  const regions = await load('i18n/regions.ts');

  const cents = (input, mark) => money.parsePriceToCents(input, mark);

  /* --------------------------------------------- the mark belongs to a country */

  /*
   * The decimal mark is a property of the COUNTRY, not the language. It lived
   * on the language, which is wrong in exactly the case this app is built for:
   * a Belgian household running the interface in English got British formatting
   * for Belgian money.
   */
  check('Belgium writes a comma', regions.decimalMarkFor('BE'), ',');
  check('Britain writes a point', regions.decimalMarkFor('GB'), '.');
  check('Ireland too', regions.decimalMarkFor('IE'), '.');
  // The one that surprises people: unlike all of its neighbours.
  check('and so does Switzerland', regions.decimalMarkFor('CH'), '.');
  check('an unknown country falls back to the comma', regions.decimalMarkFor('ZZ'), ',');
  check('...and so does no country at all', regions.decimalMarkFor(null), ',');

  /* ------------------------------------------------------------ the simple case */

  check('a comma country reads 3,50', cents('3,50', ','), 350);
  check('a point country reads 3.50', cents('3.50', '.'), 350);

  /* -------------------------------------------------- THE BUG: grouped numbers */

  check('1.234,56 is twelve hundred euros in Belgium', cents('1.234,56', ','), 123456);
  check('1,234.56 is the same in Britain', cents('1,234.56', '.'), 123456);
  // France groups with a space, which must not survive into the number either.
  check('a space group is stripped', cents('1 234,56', ','), 123456);
  /*
   * A space INSIDE a grouped number, which is where stripping them earns its
   * keep. Without it "1. 234" reads as one euro twenty-three rather than twelve
   * hundred, because the grouping mark is no longer followed by three digits —
   * it is followed by a space. Mutation testing said the strip did not matter;
   * it said that because no case here had a space in that position.
   */
  check('a space inside the grouping is stripped too', cents('1. 234', ','), 123400);
  check('...in either convention', cents('1, 234', '.'), 123400);

  /* ------------------------------------------ one mark, decided by its shape */

  /*
   * Grouping has a shape — exactly three digits follow it — and that shape is
   * what settles the cases that look ambiguous from the string alone.
   */
  check('1,234 in Belgium is one euro twenty-three', cents('1,234', ','), 123);
  check('1,234 in Britain is one thousand two hundred and thirty four', cents('1,234', '.'), 123400);
  check('1.234 in Belgium is the thousand', cents('1.234', ','), 123400);
  check('1.234 in Britain is the euro twenty-three', cents('1.234', '.'), 123);

  /*
   * THE ONE THAT WAS SILENTLY DANGEROUS. "1,5" is not a number in British
   * notation at all — it is somebody typing the mark their other keyboard uses.
   * The old parser stripped the comma and returned FIFTEEN EUROS.
   */
  check('1,5 typed in Britain means one fifty', cents('1,5', '.'), 150);
  check('...and 1.5 typed in Belgium means the same', cents('1.5', ','), 150);

  /* ----------------------------------------------------- refusing, not guessing */

  /*
   * The whole lesson of the bug this replaces: the old version reached an
   * answer for every input, and was silently wrong for a class of them.
   */
  check('two decimal marks is not a number', cents('1,2,3', ','), null);
  check('...in either country', cents('1.2.3', '.'), null);
  check('a group of the wrong length is refused', cents('1,23,456', '.'), null);
  check('empty is refused', cents('', ','), null);
  check('letters alone are refused', cents('abc', ','), null);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
