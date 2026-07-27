/**
 * Item-emoji check.
 *
 * Two things can go wrong here and neither shows up in a typecheck:
 *
 *  * **A gap in one language.** The table is written concept-by-concept across
 *    seven languages, and it is very easy to add "cucumber / Gurke / concombre"
 *    and forget Polish. A German user seeing 🥬 for everything is the feature
 *    silently not working for them, so this walks a per-language sample and
 *    asserts each one resolves to the same emoji its English twin does.
 *
 *  * **A greedy match.** The stem trimming and the word-by-word scan can both
 *    over-reach — "ice cream" becoming an ice cube, or "olive oil" picking up
 *    whichever of the two words comes first. Those cases are pinned below.
 *
 * Run with `pnpm --filter mobile check:item-emoji`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'item-emoji.ts');

const source = readFileSync(SRC, 'utf8').replace(/^import .*from '@korb\/shared';$/gm, '');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
  }
  return ok;
};

/* ---------------------------------------------------- every category answers */

const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
];
for (const c of CATEGORIES) {
  const got = mod.emojiFor('zzzqqq nonsense', c);
  check(`unknown item in ${c} still gets an emoji`, Boolean(got) && got.length > 0, true);
  check(`unknown item in ${c} falls back to its category`, got, mod.CATEGORY_EMOJI[c]);
}
check('an empty name still returns something', mod.emojiFor('', 'other'), mod.CATEGORY_EMOJI.other);
check('whitespace-only name is handled', mod.emojiFor('   ', 'bakery'), mod.CATEGORY_EMOJI.bakery);
check('no category given still works', Boolean(mod.emojiFor('zzzqqq')), true);

/* ----------------------------------------------- the same concept, 7 languages */

// [concept, en, de, fr, nl, es, it, pl] — every row must resolve to one emoji.
const MULTILINGUAL = [
  ['milk',     'Milk', 'Milch', 'Lait', 'Melk', 'Leche', 'Latte', 'Mleko'],
  ['cheese',   'Cheese', 'Käse', 'Fromage', 'Kaas', 'Queso', 'Formaggio', 'Ser'],
  ['eggs',     'Eggs', 'Eier', 'Œufs', 'Eieren', 'Huevos', 'Uova', 'Jajka'],
  ['bread',    'Bread', 'Brot', 'Pain', 'Brood', 'Pan', 'Pane', 'Chleb'],
  ['apple',    'Apples', 'Äpfel', 'Pommes', 'Appels', 'Manzanas', 'Mele', 'Jabłka'],
  ['tomato',   'Tomatoes', 'Tomaten', 'Tomates', 'Tomaten', 'Tomates', 'Pomodori', 'Pomidory'],
  ['potato',   'Potatoes', 'Kartoffeln', 'Patates', 'Aardappels', 'Patatas', 'Patate', 'Ziemniaki'],
  ['onion',    'Onion', 'Zwiebeln', 'Oignons', 'Uien', 'Cebolla', 'Cipolla', 'Cebula'],
  ['garlic',   'Garlic', 'Knoblauch', 'Ail', 'Knoflook', 'Ajo', 'Aglio', 'Czosnek'],
  ['carrot',   'Carrots', 'Karotten', 'Carottes', 'Wortels', 'Zanahoria', 'Carote', 'Marchew'],
  ['chicken',  'Chicken', 'Hähnchen', 'Poulet', 'Kip', 'Pollo', 'Pollo', 'Kurczak'],
  ['fish',     'Fish', 'Fisch', 'Poisson', 'Vis', 'Pescado', 'Pesce', 'Ryba'],
  ['coffee',   'Coffee', 'Kaffee', 'Café', 'Koffie', 'Café', 'Caffè', 'Kawa'],
  ['water',    'Water', 'Wasser', 'Eau', 'Water', 'Agua', 'Acqua', 'Woda'],
  ['beer',     'Beer', 'Bier', 'Bière', 'Bier', 'Cerveza', 'Birra', 'Piwo'],
  ['rice',     'Rice', 'Reis', 'Riz', 'Rijst', 'Arroz', 'Riso', 'Ryż'],
  ['sugar',    'Sugar', 'Zucker', 'Sucre', 'Suiker', 'Azúcar', 'Zucchero', 'Cukier'],
  ['salt',     'Salt', 'Salz', 'Sel', 'Zout', 'Sal', 'Sale', 'Sól'],
  ['soap',     'Soap', 'Seife', 'Savon', 'Zeep', 'Jabón', 'Sapone', 'Mydło'],
  ['butter',   'Butter', 'Butter', 'Beurre', 'Boter', 'Mantequilla', 'Burro', 'Masło'],
];
const LANGS = ['en', 'de', 'fr', 'nl', 'es', 'it', 'pl'];

for (const [concept, ...words] of MULTILINGUAL) {
  const english = mod.emojiFor(words[0], 'other');
  if (!check(`${concept}: English resolves to a specific emoji`, english !== mod.CATEGORY_EMOJI.other, true)) {
    continue;
  }
  words.forEach((word, i) => {
    check(`${concept} in ${LANGS[i]} ("${word}")`, mod.emojiFor(word, 'other'), english);
  });
}

/* --------------------------------------------------- accents fold, not break */

check('accents fold (Käse)', mod.emojiFor('Käse', 'other'), mod.emojiFor('Kase', 'other'));
check('ligature folds (Œufs)', mod.emojiFor('Œufs', 'other'), mod.emojiFor('OEufs', 'other'));
check('Polish ł folds (Mleko/Masło)', mod.emojiFor('Masło', 'other'), mod.emojiFor('Maslo', 'other'));
check('case is ignored', mod.emojiFor('MILCH', 'other'), mod.emojiFor('milch', 'other'));
check('surrounding space is ignored', mod.emojiFor('  Milk  ', 'other'), mod.emojiFor('Milk', 'other'));

/* ------------------------------------------------ the whole name wins first */

check('"olive oil" is the oil, not the olive', mod.emojiFor('Olive oil', 'pantry'), '🫒');
check('"ice cream" is not an ice cube', mod.emojiFor('Ice cream', 'frozen'), '🍨');
check('"icecream" joined also works', mod.emojiFor('icecream', 'frozen'), '🍨');
check('a modifier before a known word still matches', mod.emojiFor('Whole milk', 'dairy_eggs'), '🥛');
check('a modifier after a known word still matches', mod.emojiFor('Milk semi-skimmed', 'dairy_eggs'), '🥛');
check('brand noise around a known word still matches', mod.emojiFor('Alpro almond milk', 'dairy_eggs'), '🥛');

/* --------------------------------------------- stemming must not over-reach */

// "sale" (Italian salt) must not be stemmed to "sal"→ nothing weird, and short
// words must not be stemmed down to a coincidental match.
check('short words are not stemmed into nonsense', mod.emojiFor('ta', 'other'), mod.CATEGORY_EMOJI.other);
check('"tea" is tea, not stemmed away', mod.emojiFor('Tea', 'pantry'), '🍵');
check('"pear" is not stemmed to "pea"', mod.emojiFor('Pear', 'fruit_veg'), '🍐');
check('"beans" resolves', mod.emojiFor('Beans', 'pantry'), '🫘');
check('"bacon" is not matched by "ba"', mod.emojiFor('Bacon', 'meat_fish'), '🥓');

/* ----------------------------------------- every table key must be reachable */

// A key that fold() can never produce is dead code that looks alive. This bit
// the Polish and Spanish entries for toothpaste and toilet paper, which were
// written with underscores ("pasta_de_dientes") and so could never match the
// space-separated string fold() actually emits — the feature silently didn't
// work in two languages, and nothing failed. Re-derive every key through fold()
// and demand it comes back unchanged.
{
  const source = readFileSync(SRC, 'utf8');
  const body = source.slice(
    source.indexOf('const ITEM_EMOJI'),
    source.indexOf('const LIGATURES'),
  );
  const tableKeys = [...body.matchAll(/(?:^|[,{]\s*)'?([A-Za-z_][A-Za-z_ '-]*?)'?\s*:\s*'/gm)]
    .map((m) => m[1]);
  check('the key regex actually found the table', tableKeys.length > 200, true);
  // Joined, not compared as arrays: this file's `check` uses ===, and two empty
  // arrays are never identical — the assertion would "fail" with both sides
  // printing as nothing, which is worse than no test at all.
  const unreachable = tableKeys.filter((k) => mod.fold(k) !== k);
  check('every ITEM_EMOJI key survives fold() unchanged', unreachable.join(', '), '');
}

/* ------------------------------------------------------ table sanity checks */

const values = Object.values(mod.CATEGORY_EMOJI);
check('every category has a distinct-enough set', values.length, CATEGORIES.length);
check('no category emoji is empty', values.every((v) => typeof v === 'string' && v.length > 0), true);

console.log(failures === 0 ? 'ALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
