/**
 * Category coverage check.
 *
 * Korb keeps three curated tables about grocery words:
 *
 *   ITEM_EMOJI  which glyph to draw
 *   ITEM_UNIT   how it is normally bought
 *   the category map — which aisle it belongs to
 *
 * The first two were built multilingual, 646 and 189 terms across seven
 * languages. The third was fifty-five English words, and nobody noticed for
 * months, because nothing failed: an unknown word simply falls through to the
 * AI, which answers correctly a second or two later. The only visible symptom
 * was an item sitting under "Other" with the right emoji and the right unit
 * next to it — which is what it took to spot it.
 *
 * So this check exists to make silence impossible. Four table assertions plus
 * a behaviour pass over the resolver itself:
 *
 *   1. Every emoji in the curated table has an aisle. Add a glyph without one
 *      and the build stops, rather than 7 more words quietly needing the AI.
 *   2. Every curated TERM resolves to a category. This is the property that
 *      actually matters and the one that was violated.
 *   3. No override names a term that does not exist, which would be a typo
 *      silently doing nothing.
 *
 * Run with `pnpm --filter mobile check:item-category`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib');

/**
 * Compile and run the real modules.
 *
 * Executed rather than parsed, so this checks the resolver people actually
 * call — accent folding, whole-name-before-words, the override layer — and not
 * merely the shape of two object literals. Both modules are pure: item-emoji
 * imports only a type, and item-category imports only from item-emoji.
 */
const compile = (file, req) => {
  const js = ts.transpileModule(readFileSync(join(LIB, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
};

const emojiMod = compile('item-emoji.ts', () => ({}));
const categoryMod = compile('item-category.ts', (spec) =>
  spec === '@/lib/item-emoji' ? emojiMod : {},
);

const objectLiteral = (_file, varName) =>
  ({
    ITEM_EMOJI: emojiMod.__ITEM_EMOJI,
    EMOJI_CATEGORY: categoryMod.__EMOJI_CATEGORY,
    TERM_CATEGORY: categoryMod.__TERM_CATEGORY,
  })[varName];

const ITEM_EMOJI = objectLiteral('item-emoji.ts', 'ITEM_EMOJI');
const EMOJI_CATEGORY = objectLiteral('item-category.ts', 'EMOJI_CATEGORY');
const TERM_CATEGORY = objectLiteral('item-category.ts', 'TERM_CATEGORY');

const CATEGORIES = new Set([
  'fruit_veg',
  'dairy_eggs',
  'meat_fish',
  'bakery',
  'pantry',
  'frozen',
  'drinks',
  'household',
  'personal_care',
  'other',
]);

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines.slice(0, 12)) console.log(`  ${line}`);
  if (lines.length > 12) console.log(`  …and ${lines.length - 12} more`);
};

/* -------------------------------------------- 1. every emoji has an aisle */

const emojisUsed = [...new Set(Object.values(ITEM_EMOJI))];
const withoutCategory = emojisUsed.filter((e) => !EMOJI_CATEGORY[e]);
if (withoutCategory.length) {
  fail(
    'every curated emoji needs an aisle',
    withoutCategory.map((e) => {
      const terms = Object.entries(ITEM_EMOJI)
        .filter(([, v]) => v === e)
        .map(([k]) => k);
      return `${e} has no entry in EMOJI_CATEGORY (${terms.length} terms: ${terms.slice(0, 5).join(', ')})`;
    }),
  );
} else {
  console.log(`ok   all ${emojisUsed.length} curated emoji have an aisle`);
}

/* -------------------------------------- 2. every curated TERM has an aisle */

const uncategorised = Object.keys(ITEM_EMOJI).filter(
  (term) => !TERM_CATEGORY[term] && !EMOJI_CATEGORY[ITEM_EMOJI[term]],
);
if (uncategorised.length) {
  fail(
    'every curated term must resolve to a category without asking the AI',
    uncategorised.map((t) => `"${t}" (${ITEM_EMOJI[t]}) falls through to 'other'`),
  );
} else {
  console.log(`ok   all ${Object.keys(ITEM_EMOJI).length} curated terms resolve to an aisle`);
}

/* ------------------------------------------ 3. overrides name real terms */

const strayOverrides = Object.keys(TERM_CATEGORY).filter((t) => !ITEM_EMOJI[t]);
if (strayOverrides.length) {
  fail(
    'every TERM_CATEGORY override must name a term the emoji table has',
    strayOverrides.map((t) => `"${t}" is not in ITEM_EMOJI — a typo here does nothing at all`),
  );
} else {
  console.log(`ok   all ${Object.keys(TERM_CATEGORY).length} overrides name real terms`);
}

/* ---------------------------------------------------- 4. values are valid */

const badValues = [
  ...Object.entries(EMOJI_CATEGORY).map(([k, v]) => [`EMOJI_CATEGORY[${k}]`, v]),
  ...Object.entries(TERM_CATEGORY).map(([k, v]) => [`TERM_CATEGORY.${k}`, v]),
].filter(([, v]) => !CATEGORIES.has(v));
if (badValues.length) {
  fail(
    'every aisle must be a real ItemCategory',
    badValues.map(([where, v]) => `${where} = "${v}"`),
  );
} else {
  console.log('ok   every aisle is a real ItemCategory');
}

/* ------------------------------------------------------------ the numbers */

if (failures === 0) {
  const byCategory = {};
  for (const [term, emoji] of Object.entries(ITEM_EMOJI)) {
    const cat = TERM_CATEGORY[term] ?? EMOJI_CATEGORY[emoji];
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }
  const summary = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${n}`)
    .join(', ');
  console.log(`\n${Object.keys(ITEM_EMOJI).length} terms categorised on-device: ${summary}`);
}

/* --------------------------------------------------- 5. the resolver itself */

/**
 * Spot-checks of the real function, one per language per aisle.
 *
 * The assertions above prove the tables are complete. These prove the lookup
 * on top of them works: accent folding ("crème" is what a French shopper
 * actually types), whole-name-before-words ("olive oil" is pantry, not the
 * produce that "olive" alone would give), the override layer, and the word
 * scan inside a phrase.
 */
const BEHAVIOUR = [
  // The report that started this: right emoji, right unit, wrong aisle.
  ['creme', 'dairy_eggs'], ['crème', 'dairy_eggs'], ['Crème', 'dairy_eggs'],
  // Dairy in all seven.
  ['cream', 'dairy_eggs'], ['sahne', 'dairy_eggs'], ['śmietana', 'dairy_eggs'],
  ['lait', 'dairy_eggs'], ['leche', 'dairy_eggs'], ['mleko', 'dairy_eggs'],
  ['fromage', 'dairy_eggs'], ['kaas', 'dairy_eggs'], ['jajka', 'dairy_eggs'],
  // A sweep of the other aisles.
  ['pomme', 'fruit_veg'], ['ziemniaki', 'fruit_veg'], ['zwiebeln', 'fruit_veg'],
  ['poulet', 'meat_fish'], ['łosoś', 'meat_fish'], ['prosciutto', 'meat_fish'],
  ['baguette', 'bakery'], ['brötchen', 'bakery'], ['ciasto', 'bakery'],
  ['makaron', 'pantry'], ['huile', 'pantry'],
  ['bière', 'drinks'], ['woda', 'drinks'], ['sok', 'drinks'],
  ['lody', 'frozen'], ['frytki', 'frozen'],
  ['waschmittel', 'household'], ['papier toilette', 'household'],
  ['szampon', 'personal_care'], ['dentifrice', 'personal_care'],
  // Every override group, so a deleted line is caught.
  ['muesli', 'pantry'], ['confiture', 'pantry'], ['ketchup', 'pantry'],
  ['lemonade', 'drinks'], ['ocet', 'pantry'], ['savon', 'personal_care'],
  // Whole name must beat any single word inside it.
  ['olive oil', 'pantry'], ['ice cream', 'frozen'],
  // And a word scan inside a real phrase somebody would type.
  ['2 litres de lait', 'dairy_eggs'],
  // Unknown stays unknown: a wrong guess is worse than asking the AI.
  ['zzzz', null],
];

const wrong = BEHAVIOUR.map(([name, want]) => [name, want, categoryMod.categoryFromTables(name)])
  .filter(([, want, got]) => got !== want);
if (wrong.length) {
  fail(
    'the resolver must return the right aisle',
    wrong.map(([name, want, got]) => `"${name}" -> ${String(got)}, wanted ${String(want)}`),
  );
} else {
  console.log(`ok   ${BEHAVIOUR.length} resolver cases across all seven languages`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
