#!/usr/bin/env node
/**
 * Storage tips: the curated table, and the rules every sentence in it obeys.
 *
 * ---------------------------------------------------------------------------
 * Why a table exists at all
 * ---------------------------------------------------------------------------
 *
 * The tip was first built as an AI answer riding along with `categorize`, and
 * it could never have worked: that function only runs for terms the app does
 * NOT already know, so milk, spinach and bread — the items advice is for —
 * never reached it. The table answers the common vocabulary offline; the AI
 * path stays for the long tail, which is the half it is actually good at.
 *
 * ---------------------------------------------------------------------------
 * The rules a sentence has to obey
 * ---------------------------------------------------------------------------
 *
 * The same ones isShareableTip enforces on the AI's tips, applied here because
 * a curated sentence reaching every customer is no safer for having been typed
 * by hand. Above all: NO NUTRITION OR HEALTH CLAIMS. "High in iron" is a
 * regulated claim under EU 1924/2006 with a legal threshold behind it; where to
 * keep a bag of leaves is not.
 *
 * Run with `pnpm --filter mobile check:item-tip`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

let failures = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
};

const load = async (rel, ...strip) => {
  let src = readFileSync(join(SRC, rel), 'utf8').replace(/^import\s+type\s[^;]*?;/gm, '');
  for (const d of strip) {
    src = src.replace(new RegExp(`^import\\s[^;]*?from '${d.replace(/[/@]/g, '\\$&')}';`, 'gm'), '');
  }
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
};

const emoji = await load('lib/item-emoji.ts', '@korb/shared');
const tipSrc = readFileSync(join(SRC, 'lib', 'item-tip.ts'), 'utf8');

/*
 * item-tip CONCATENATED with item-emoji, not loaded with the import stripped.
 *
 * Stripping it left `emojiFor` undefined, so every call to tipKeyFor either
 * returned early or threw — and a mutation removing the empty-name guard
 * crashed the script instead of failing an assertion. The function was not
 * under test at all; only its first line was.
 */
const tipMod = await (async () => {
  const em = readFileSync(join(SRC, 'lib', 'item-emoji.ts'), 'utf8')
    .replace(/^import\s[^;]*?from '@korb\/shared';/gm, '');
  const tip = tipSrc
    .replace(/^import\s+type\s[^;]*?;/gm, '')
    .replace(/^import\s[^;]*?from '@\/lib\/item-emoji';/gm, '');
  const { outputText } = ts.transpileModule(em + '\n' + tip, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
})();

/*
 * And the resolution is exercised through the REAL function now, not through a
 * table this script re-parsed for itself. A parsed copy tests the parser.
 */
check('tipKeyFor resolves through item-emoji', tipMod.tipKeyFor('tomaten', 'fruit_veg'), 'tips.tomato');

/* ------------------------------------------------- the table resolves ---- */

/*
 * The point of keying on the glyph: item-emoji already maps 646 words across
 * seven languages onto a much smaller set of concepts, so the table works in
 * every language without holding a single translated key.
 */
{
  const TABLE = Object.fromEntries(
    [...tipSrc.matchAll(/'(\p{Extended_Pictographic}[️]?)': '(tips\.\w+)'/gu)].map((m) => [m[1], m[2]]),
  );
  check('the table was parsed', Object.keys(TABLE).length > 15, true);

  const keyFor = (name, category) => TABLE[emoji.emojiFor(name, category)] ?? null;

  // The same concept, in four languages, reaching the same sentence.
  check('English finds it', keyFor('tomatoes', 'fruit_veg'), 'tips.tomato');
  check('...and Dutch', keyFor('tomaten', 'fruit_veg'), 'tips.tomato');
  check('...and German', keyFor('Tomate', 'fruit_veg'), 'tips.tomato');
  check('...and Polish', keyFor('pomidory', 'fruit_veg'), 'tips.tomato');

  /*
   * THE THREE THAT MADE THIS WORTH DOING. Spinach, bread and any unrecognised
   * vegetable all resolve to their CATEGORY's glyph rather than one of their
   * own — which lib/receipt.ts correctly treats as no answer, because a
   * fallback says which aisle and matching needs the item.
   *
   * Here it is the right grain. "Some leafy thing from the produce aisle" is
   * exactly what storage advice is about, which is why the sentence behind 🥬
   * says "most greens" and not "spinach".
   */
  check('spinach gets the greens tip', keyFor('spinach', 'fruit_veg'), 'tips.greens');
  check('...and so does an unknown vegetable', keyFor('zzq unknown veg', 'fruit_veg'), 'tips.greens');
  check('bread gets the bread tip', keyFor('bread', 'bakery'), 'tips.bread');
  check('...and so does a baguette', keyFor('baguette', 'bakery'), 'tips.bread');

  /*
   * And the two category defaults deliberately left out. 🥛 covers milk,
   * cheese, yoghurt and eggs, which keep in four different ways; 🥫 covers the
   * whole dry-goods aisle. No sentence is true of either.
   */
  check('milk gets no tip, because dairy has no single answer', keyFor('milk', 'dairy_eggs'), null);
  check('...nor does an unknown pantry item', keyFor('zzq unknown thing', 'pantry'), null);
  check('...nor household', keyFor('bleach', 'household'), null);

  /*
   * An empty name against a category that DOES have a fallback tip. Asking with
   * 'other' proved nothing: 🛒 has no tip either way, so the guard passed
   * whether or not the name was checked at all.
   */
  check('an empty name gets nothing', tipMod.tipKeyFor('', 'fruit_veg'), null);
  check('...and neither does whitespace', tipMod.tipKeyFor('   ', 'fruit_veg'), null);
}

/* ------------------------------------------- every sentence, every locale - */

/*
 * The claim list from functions/_shared/lexicon.ts, applied to the curated
 * table too. A sentence reaching every customer is no safer for having been
 * typed by hand than for having been generated.
 */
const CLAIM = [
  'vitamin', 'vitamins', 'mineral', 'minerals', 'protein', 'calcium', 'iron',
  'omega', 'antioxidant', 'antioxidants', 'fibre', 'fiber', 'calorie',
  'calories', 'nutrient', 'nutrients', 'nutritious', 'nutrition', 'healthy',
  'health', 'immune', 'immunity', 'digestion', 'digestive', 'cholesterol',
  'diabetes', 'cancer', 'heart', 'detox', 'superfood', 'metabolism',
  'weight', 'slimming', 'cure', 'cures', 'heals', 'remedy', 'medicinal',
  // and the same words where a translation would carry the claim
  'vitamine', 'vitamina', 'gesund', 'gesundheit', 'sain', 'saludable', 'salute',
  'zdrowie', 'zdrowy', 'eisen', 'ijzer', 'hierro', 'ferro', 'żelazo',
];

const LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pl'];
{
  const bad = [];
  const long = [];
  const many = [];
  for (const loc of LOCALES) {
    const src = readFileSync(join(SRC, 'i18n', 'locales', `${loc}.ts`), 'utf8');
    // Indentation-agnostic: the block sits at the locale file's top level,
    // not nested, and a hard-coded indent is a guard that breaks on a reformat.
    const start = src.indexOf('tips: {');
    const block = src.slice(start, src.indexOf('status: {', start));
    const lines = [...block.matchAll(/^\s+(\w+): '(.*)',$/gm)];
    check(`${loc}: every tip is present`, lines.length, 21);
    for (const [, key, raw] of lines) {
      const text = raw.replace(/\\'/g, "'");
      // The shape rules from the column's CHECK and isShareableTip.
      if (text.length > 140) long.push(`${loc}.${key} (${text.length})`);
      if ((text.match(/[.!?](\s|$)/g) ?? []).length > 1) many.push(`${loc}.${key}`);
      const folded = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const w of CLAIM) {
        if (new RegExp(`\\b${w}\\b`).test(folded)) bad.push(`${loc}.${key}: "${w}"`);
      }
    }
  }
  check('no tip makes a nutrition or health claim', bad, []);
  check('no tip is longer than the column allows', long, []);
  check('every tip is a single sentence', many, []);
}

/* ------------------------------------------------- and the sheet uses it - */

{
  const sheet = readFileSync(join(SRC, 'components', 'staple-sheet.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Table FIRST, dictionary second: the AI answer only exists for terms the
  // table has never heard of, which is the half it is good at.
  check('the sheet asks the table first', /tipKeyFor\(displayName/.test(sheet), true);
  check(
    '...and falls back to the dictionary',
    /tipKey \? t\(tipKey\) :[\s\S]{0,60}storageTipFor\(displayName\)/.test(sheet),
    true,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
