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

const source = readFileSync(SRC, 'utf8').replace(/^import\s[^;]*?from '@korb\/shared';/gm, '');
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
/*
 * "cherry tomatoes" came back 🍒. `cherry` is in the table, comes first in the
 * word scan, and won — a qualifier that happens to be a food beating the noun
 * it qualifies, the same shape as the two above.
 *
 * It mattered more than a wrong icon. The glyph is evidence in two places: the
 * offline matcher's fourth rung, and the veto that refuses the model's
 * matches — so a cherry-tomato line would have been REFUSED its tomato row on
 * the strength of a fruit it is not.
 */
check('"cherry tomatoes" is a tomato', mod.emojiFor('Cherry tomatoes', 'fruit_veg'), '🍅');
check('...singular too', mod.emojiFor('cherry tomato', 'fruit_veg'), '🍅');
check('...and in Dutch, on a Belgian till', mod.emojiFor('Kerstomaten', 'fruit_veg'), '🍅');
check('...and in French', mod.emojiFor('Tomates cerises', 'fruit_veg'), '🍅');
// The plain fruit is untouched — the fix is a phrase, not a demotion.
check('a cherry is still a cherry', mod.emojiFor('Cherries', 'fruit_veg'), '🍒');
check('"icecream" joined also works', mod.emojiFor('icecream', 'frozen'), '🍨');
check('a modifier before a known word still matches', mod.emojiFor('Whole milk', 'dairy_eggs'), '🥛');
check('a modifier after a known word still matches', mod.emojiFor('Milk semi-skimmed', 'dairy_eggs'), '🥛');
check('brand noise around a known word still matches', mod.emojiFor('Alpro almond milk', 'dairy_eggs'), '🥛');

/* ----------------------------------------- a nut is a flavour, not the thing */

// Adding the individual nuts to the table broke "Alpro almond milk" above: the
// word scan reached "almond" first and served a peanut for a carton of milk.
// The fix lets a leading nut stand aside for the product it flavours, and these
// pin both halves of it — the deferral, and the cases where the nut IS the
// item and must win.
check('"almond milk" is a milk', mod.emojiFor('Almond milk', 'dairy_eggs'), '🥛');
check('"hazelnut milk" is a milk', mod.emojiFor('Hazelnut milk', 'dairy_eggs'), '🥛');
check('"almond flour" is a flour', mod.emojiFor('Almond flour', 'pantry'), '🌾');
check('"almond oil" is an oil', mod.emojiFor('Almond oil', 'pantry'), '🫒');
check('"peanut butter" stays a nut', mod.emojiFor('Peanut butter', 'pantry'), '🥜');
check('"almonds" alone is a nut', mod.emojiFor('Almonds', 'pantry'), '🥜');
check('"walnuts" alone is a nut', mod.emojiFor('Walnuts', 'pantry'), '🌰');
// Head-first languages never needed the rule — they stop at the head word —
// but they must not be disturbed by it either.
check('"latte di mandorla" is a milk', mod.emojiFor('Latte di mandorla', 'dairy_eggs'), '🥛');
check('"leche de almendras" is a milk', mod.emojiFor('Leche de almendras', 'dairy_eggs'), '🥛');

/* ------------------------------- a qualifier is not the item ------------- */

// The collision family, pinned as glyphs here and as aisles in
// check-item-category. Both answers come from one match now, so a fix to either
// has to keep both true.
check('"butter beans" is a legume', mod.emojiFor('Butter beans', 'pantry'), '🫘');
check('"butterbeans" joined also works', mod.emojiFor('Butterbeans', 'pantry'), '🫘');
check('"butter" alone is still butter', mod.emojiFor('Butter', 'dairy_eggs'), '🧈');
check('"water colour" is paint', mod.emojiFor('Water colour', 'other'), '🎨');
check('...spelled the American way', mod.emojiFor('Water color', 'other'), '🎨');
check('...and as one German word', mod.emojiFor('Wasserfarben', 'other'), '🎨');
check('...and in Dutch', mod.emojiFor('Waterverf', 'other'), '🎨');
check('"water" alone is still water', mod.emojiFor('Water', 'drinks'), '💧');
check('"sparkling water" is still water', mod.emojiFor('Sparkling water', 'drinks'), '💧');

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

/* ------------------------------------------- the two Insights cards -------- */

/*
 * `name` or `glyph`, and the choice is not cosmetic.
 *
 * ItemEmoji resolves a glyph from the NAME, falling back to the category. That
 * is right for a staple — "Bananas" has its own glyph and the aisle's generic
 * one would throw it away — and wrong for the spending card, whose rows are
 * AISLES. "Fruit & Veg" is not a thing anybody buys, so there is no name to
 * resolve, and asking emojiFor to match a translated category label finds
 * nothing in six languages out of seven. CATEGORY_EMOJI is keyed on the
 * category itself and is right in all of them.
 */
{
  const src = readFileSync(join(here, '..', 'src', 'app', '(tabs)', 'insights.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const failed = [];
  const want = (name, ok) => { if (!ok) failed.push(name); };

  want('a staple draws a glyph', /<ItemEmoji name=\{staple\.display\} category=\{staple\.category\}/.test(src));
  // From the purchase, not the pantry: the log records the aisle at buying
  // time, so a corrected category survives and a deleted item keeps its glyph.
  want('...with the aisle the purchase recorded', /category: p\.category \?\? 'other'/.test(src));

  want('a spending row draws one too', /glyph=\{CATEGORY_EMOJI\[x\.category\]\}/.test(src));
  want('...and imports the map to do it', /import \{ CATEGORY_EMOJI \} from "@\/lib\/item-emoji"/.test(src));
  /*
   * And the price-change row, which was the odd one out — a bare name in a card
   * whose neighbours above and below both carry a glyph. Resolved from the name
   * AND the recorded category, like the staple row: "Spinach" has a leaf of its
   * own and fruit_veg's fallback is also a leaf, so the category is what tells
   * the item's glyph from the aisle's.
   */
  want('a price change draws one as well', /<ItemEmoji name=\{move\.name\} category=\{move\.category \?\? "other"\}/.test(src));
}

/* -------------------------------------------------------------- the tile -- */

/*
 * ONE TILE, THREE PLACES.
 *
 * The pantry row, a list row and the item sheet all draw the same object at
 * different sizes — so the thing you tap in a list and the thing you land on in
 * the sheet are the same, and there is one place to change it. The sheet used
 * to roll its own 64pt pad, which is how two of them drift.
 *
 * The wash is NEUTRAL and that is the whole decision. Everything else coloured
 * on those rows already means something — green on track or ticked, amber due
 * or listed, red overdue — so a tinted tile either repeats a fact or borrows a
 * hue that had a job.
 */
{
  const read = (...p) => readFileSync(join(here, '..', 'src', ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const emoji = read('components', 'item-emoji.tsx');
  const pantry = read('app', '(tabs)', 'pantry.tsx');
  const list = read('app', 'list', '[id].tsx');
  const sheet = read('components', 'staple-sheet.tsx');
  const failed = [];
  const want = (name, ok) => { if (!ok) failed.push(name); };

  want('the tile is a neutral wash, not a tint', /backgroundColor: colors\.muted \+ '1F'/.test(emoji));
  want('...and never the accent', !/backgroundColor: colors\.accent/.test(emoji));
  // Derived from the glyph, so a caller asks for a picture and gets a frame.
  want('...sized from the glyph it holds', /width: size \* 1\.8,\s*height: size \* 1\.8,/.test(emoji));

  want('the pantry row leads with a tile', /<ItemEmoji name=\{item\.display\} category=\{item\.category\} size=\{20\} tile \/>/.test(pantry));
  /*
   * OUTSIDE the name row. A 36pt tile does not belong inside a 14pt sentence,
   * and leading the row is what gives a scrolled column a straight rail.
   */
  want('...outside the name row', pantry.indexOf('size={20} tile') < pantry.indexOf('styles.nameRow'));
  want('a list row draws one too', /size=\{18\}\s*tile/.test(list));
  /*
   * Smaller on a list, because a list row is one line and the tile IS its
   * height, where a pantry row is three lines and the tile costs nothing.
   */
  want('...smaller, because there it sets the row height', !/size=\{20\}\s*tile/.test(list));
  want('the sheet draws the same object', /<ItemEmoji name=\{item\.display\} category=\{item\.category\} size=\{38\} tile \/>/.test(sheet));
  want('...rather than a pad of its own', !/glyphPad/.test(sheet));

  if (failed.length) {
    failures += 1;
    console.log('FAIL the item tile is one object in three places');
    for (const f of failed) console.log(`  ${f}`);
  } else {
    console.log('ok   the item tile is one object in three places');
  }

  if (failed.length) {
    failures += 1;
    console.log('FAIL the Insights rows draw their glyphs');
    for (const f of failed) console.log(`  ${f}`);
  } else {
    console.log('ok   the staples and spending rows both draw a glyph');
  }
}

console.log(failures === 0 ? 'ALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
