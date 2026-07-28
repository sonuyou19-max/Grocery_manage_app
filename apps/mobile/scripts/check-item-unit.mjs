/**
 * Item-unit check.
 *
 * unitFor() is allowed to return null, and that makes it much easier to get
 * quietly wrong than emojiFor(), which always has something to show. Three
 * failure modes, none of which a typecheck can see:
 *
 *  * **An unreachable key.** Keys must be what fold() produces. A key with an
 *    accent, an uppercase letter or an underscore can never be matched and is
 *    dead weight that looks like coverage — this is exactly the bug that made
 *    Polish and Spanish toothpaste unreachable in the emoji table, so every key
 *    here is re-derived through fold() and any that doesn't survive fails.
 *
 *  * **A confident wrong answer.** The whole design rests on preferring null to
 *    a guess. A category default leaking into a genuinely mixed category
 *    (dairy, pantry, frozen) would put "kg" on a bottle of milk, so those are
 *    pinned as null.
 *
 *  * **The lexicon's null being swallowed.** A term the model has seen and
 *    declined to unit must STOP the search, not fall through to the category
 *    default — otherwise the model's "I'm not sure" silently becomes a guess.
 *    That distinction is `undefined` vs `null` from the resolver and is the
 *    single easiest thing here to break with an innocent `?.`.
 *
 * Run with `pnpm --filter mobile check:item-unit`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, '..', 'src', 'lib');

/**
 * item-unit.ts imports fold from item-emoji.ts, so both are transpiled and the
 * import is rewritten to point at the inlined module. Same trick the emoji
 * check uses to run TS in plain Node, one dependency deeper.
 */
const compile = (file, rewrite = (s) => s) => {
  const source = rewrite(
    readFileSync(join(LIB, file), 'utf8').replace(/^import .*from '@korb\/shared';$/gm, ''),
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
};

const emojiUrl = compile('item-emoji.ts');
const mod = await import(
  compile('item-unit.ts', (s) => s.replace("'@/lib/item-emoji'", JSON.stringify(emojiUrl)))
);
const { fold } = await import(emojiUrl);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${String(expected)}\n  actual   ${String(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
  return ok;
};

const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'];

/* ------------------------------------------------ every key must be reachable */

let unreachable = 0;
for (const key of Object.keys(mod.__ITEM_UNIT)) {
  if (fold(key) !== key) {
    failures += 1;
    unreachable += 1;
    console.log(`FAIL key "${key}" does not survive fold() — it can never match`);
  }
}
check('every ITEM_UNIT key is fold()-stable', unreachable, 0);

/* ---------------------------------------------- every value is a real unit */

let badValue = 0;
for (const [key, value] of Object.entries(mod.__ITEM_UNIT)) {
  if (!UNITS.includes(value)) {
    failures += 1;
    badValue += 1;
    console.log(`FAIL "${key}" has unit "${value}", which is not one of ${UNITS.join(', ')}`);
  }
}
check('every ITEM_UNIT value is a known unit', badValue, 0);

for (const [cat, unit] of Object.entries(mod.CATEGORY_UNIT)) {
  if (!UNITS.includes(unit)) {
    failures += 1;
    console.log(`FAIL category ${cat} defaults to "${unit}", not a known unit`);
  }
}

/* -------------------------------------------------- the user's two examples */

check('milk is litres', mod.unitFor('milk', 'dairy_eggs'), 'L');
check('potato is kilos', mod.unitFor('potato', 'fruit_veg'), 'kg');
check('Milk, capitalised, is still litres', mod.unitFor('Milk', 'dairy_eggs'), 'L');

/* -------------------------------------------------- silence where it belongs */

// The point of the whole design: a mixed category must NOT produce a guess.
check('an unknown dairy item has no unit', mod.unitFor('zzz curd thing', 'dairy_eggs'), null);
check('an unknown pantry item has no unit', mod.unitFor('zzz sauce thing', 'pantry'), null);
check('an unknown frozen item has no unit', mod.unitFor('zzz frozen thing', 'frozen'), null);
check('an unknown "other" item has no unit', mod.unitFor('zzz thing', 'other'), null);
check('an empty name has no unit', mod.unitFor('   ', 'fruit_veg'), null);

/* ------------------------------------------------- category defaults do apply */

check('unknown produce falls back to kg', mod.unitFor('zzz vegetable', 'fruit_veg'), 'kg');
check('unknown meat falls back to kg', mod.unitFor('zzz cut', 'meat_fish'), 'kg');
check('unknown drink falls back to L', mod.unitFor('zzz squash', 'drinks'), 'L');
check('unknown bakery falls back to pcs', mod.unitFor('zzz loaf', 'bakery'), 'pcs');
check('unknown cleaning product falls back to pcs', mod.unitFor('zzz spray', 'household'), 'pcs');

/* ------------------------------------------ the table overrides its category */

// cheese is dairy (no default) but is weighed; beer is a drink but is counted.
check('cheese is grams', mod.unitFor('cheese', 'dairy_eggs'), 'g');
check('beer is counted, not litres', mod.unitFor('beer', 'drinks'), 'pcs');
check('eggs are counted', mod.unitFor('eggs', 'dairy_eggs'), 'pcs');
// A cucumber is produce, whose default is kg — the table has to win.
check('cucumber beats the produce default', mod.unitFor('cucumber', 'fruit_veg'), 'pcs');

/* ----------------------------------------------------------- whole-name wins */

// "olive oil" must be read whole before "oil" is matched by the word scan.
// Both are ml, so assert via a case where they'd differ: "ice cream" must not
// be read as "cream".
check('"ice cream" is not read as "cream"', mod.unitFor('ice cream', 'frozen'), 'ml');
check('a multi-word miss still scans words', mod.unitFor('organic basmati rice', 'pantry'), 'kg');

/* ------------------------------------------------- languages agree on a unit */

// A German user must get the same answer an English one does, or the feature
// is silently off for them. Sampled per concept across all seven languages.
const TRANSLATIONS = {
  L: ['milk', 'melk', 'milch', 'lait', 'leche', 'latte', 'mleko'],
  g: ['cheese', 'kaas', 'kase', 'fromage', 'queso', 'formaggio', 'ser'],
  pcs: ['egg', 'ei', 'oeuf', 'huevo', 'uovo', 'jajko'],
  kg: ['rice', 'rijst', 'reis', 'riz', 'arroz', 'riso', 'ryz'],
};
for (const [expected, words] of Object.entries(TRANSLATIONS)) {
  for (const word of words) {
    // Category 'other' has no default, so anything that resolves here came
    // from the table itself rather than from a lucky category fallback.
    check(`"${word}" is ${expected}`, mod.unitFor(word, 'other'), expected);
  }
}

/* ------------------------------------------------------- the lexicon contract */

// Absent from the lexicon (undefined) → keep looking, reach the category.
mod.setUnitLexicon(() => undefined);
check(
  'lexicon miss falls through to the category',
  mod.unitFor('zzz unknown drink', 'drinks'),
  'L',
);

// Known to the lexicon with a unit → use it, over the category default.
mod.setUnitLexicon(() => 'ml');
check('lexicon hit beats the category default', mod.unitFor('zzz unknown drink', 'drinks'), 'ml');

// Known to the lexicon WITHOUT a unit (explicit null) → stop. This is the
// model having looked and declined, and re-deriving a guess from the category
// would throw that away. The regression this pins is a `?.` collapsing the two.
mod.setUnitLexicon(() => null);
check(
  'lexicon null means null, not the category default',
  mod.unitFor('zzz unknown drink', 'drinks'),
  null,
);

// ...but the curated table still outranks the lexicon, since it is the one
// source a human wrote deliberately.
mod.setUnitLexicon(() => null);
check('curated table beats a lexicon null', mod.unitFor('milk', 'dairy_eggs'), 'L');

mod.setUnitLexicon(() => undefined);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
