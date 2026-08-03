/**
 * Sustainability check.
 *
 * The eco score is the most opinionated number Korb prints. It labels food the
 * user bought as heavy or light, invites them to improve the figure week over
 * week, and — behind Plus — compares one shop against another. Every one of
 * those is a claim, and a claim that moves is worse than no claim: a household
 * whose score drifts because two phones resolved "milk" differently, or whose
 * beef week scores higher than their lentil week, has been told something false
 * about their own shopping.
 *
 * So the properties tested here are mostly not arithmetic. They are the
 * promises the card makes:
 *
 *   - the same item always lands in the same band, in every language;
 *   - a heavier basket never scores higher than a lighter one;
 *   - bio/local moves the number a little and cannot rescue a heavy basket;
 *   - non-food is excluded rather than counted as clean;
 *   - a thin week produces no score at all rather than a wild one.
 *
 * Run with `pnpm --filter mobile check:eco`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib');

const compile = (file, req) => {
  const js = ts.transpileModule(readFileSync(join(LIB, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
};

const itemEmoji = compile('item-emoji.ts', () => ({}));
const nutrition = compile('nutrition.ts', () => ({}));
const purchaseLog = compile('purchase-log.ts', () => ({}));
const eco = compile('eco.ts', (spec) => {
  if (spec === '@/lib/item-emoji') return itemEmoji;
  if (spec === '@/lib/nutrition') return nutrition;
  return {};
});
const { carbonOf, ecoScore, ecoSwaps, weeklyEco, ecoByStore, CARBON_COLORS } = eco;
const { weekStartOf } = purchaseLog;

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(
      `FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok   ${name}`);
  }
};
const assert = (name, cond) => check(name, cond === true, true);

/* ------------------------------------------------------- the bands hold */

check('beef is high', carbonOf('Beef', 'meat_fish'), 'high');
check('lentils are low', carbonOf('Lentils', 'pantry'), 'low');
check('chicken is medium', carbonOf('Chicken breast', 'meat_fish'), 'medium');
check('carrots are low', carbonOf('Carrots', 'fruit_veg'), 'low');

// The whole point of a per-item table on top of the group default: without it
// beef and lentils would both be "protein" and both come out medium.
check('cheese beats its group', carbonOf('Cheddar cheese', 'dairy_eggs'), 'high');
check('tofu beats its group', carbonOf('Tofu', 'dairy_eggs'), 'low');

/* ---------------------------------- the same food, in every language we ship */

// A German household and a Polish one must not see different dots for beef, and
// a household where one member types English must not see different dots from
// the member who types Dutch.
for (const [name, lang] of [
  ['Rindfleisch', 'de'], ['Bœuf', 'fr'], ['Manzo', 'it'],
  ['Ternera', 'es'], ['Rundvlees', 'nl'], ['Wołowina', 'pl'],
]) {
  check(`beef is high in ${lang} (${name})`, carbonOf(name, 'meat_fish'), 'high');
}
for (const [name, lang] of [
  ['Käse', 'de'], ['Fromage', 'fr'], ['Formaggio', 'it'],
  ['Queso', 'es'], ['Kaas', 'nl'], ['Ser', 'pl'],
]) {
  check(`cheese is high in ${lang} (${name})`, carbonOf(name, 'dairy_eggs'), 'high');
}
// Accents and ligatures must fold, or the entry is dead code matched by nothing.
check('an unaccented spelling still matches', carbonOf('kase', 'dairy_eggs'), 'high');
check('a multi-word name finds its keyword', carbonOf('organic beef mince', 'meat_fish'), 'high');

/* ------------------------------------------------- non-food is not clean */

check('washing-up liquid has no band', carbonOf('Washing-up liquid', 'household'), null);
check('shampoo has no band', carbonOf('Shampoo', 'personal_care'), null);
// A trolley of bleach must not score 100 by having nothing heavy in it.
check(
  'a non-food basket has no score',
  ecoScore([
    { name: 'Bleach', category: 'household' },
    { name: 'Shampoo', category: 'personal_care' },
  ]).score,
  null,
);

/* ------------------------------------------------------- the score ranks */

const veg = ecoScore([
  { name: 'Carrots', category: 'fruit_veg' },
  { name: 'Lentils', category: 'pantry' },
  { name: 'Bread', category: 'bakery' },
  { name: 'Apples', category: 'fruit_veg' },
]);
const meat = ecoScore([
  { name: 'Beef', category: 'meat_fish' },
  { name: 'Lamb', category: 'meat_fish' },
  { name: 'Cheese', category: 'dairy_eggs' },
  { name: 'Butter', category: 'dairy_eggs' },
]);
assert('a plant basket outscores a meat basket', veg.score > meat.score);
check('an all-low basket scores 100', veg.score, 100);
check('...and counts every item', veg.total, 4);
check('an all-high basket scores its floor', meat.score, 15);

// Monotonic: swapping one heavy item for a light one can never lower the score.
const before = ecoScore([
  { name: 'Beef', category: 'meat_fish' },
  { name: 'Carrots', category: 'fruit_veg' },
]).score;
const after = ecoScore([
  { name: 'Lentils', category: 'pantry' },
  { name: 'Carrots', category: 'fruit_veg' },
]).score;
assert('swapping beef for lentils raises the score', after > before);

/* ------------------------------------------- bio is a nudge, not a rescue */

const plain = ecoScore([
  { name: 'Beef', category: 'meat_fish' },
  { name: 'Carrots', category: 'fruit_veg' },
]);
const organic = ecoScore([
  { name: 'Beef', category: 'meat_fish', bio: true },
  { name: 'Carrots', category: 'fruit_veg', bio: true },
]);
assert('bio raises the score', organic.score > plain.score);
// The claim the comment in eco.ts makes, enforced: organic beef must never
// outscore ordinary vegetables. Organic is frequently HIGHER carbon per kilo,
// and a bonus large enough to invert the ranking would teach that backwards.
const organicBeef = ecoScore([{ name: 'Beef', category: 'meat_fish', bio: true }]).score;
const plainVeg = ecoScore([{ name: 'Carrots', category: 'fruit_veg' }]).score;
assert('organic beef never outscores plain vegetables', organicBeef < plainVeg);
check('the bonus is capped at ten points', organic.score - plain.score, 10);
check('bio is counted separately', organic.bioCount, 2);
check('...and reported as a share', organic.bioShare, 1);

/* --------------------------------------------------------- shares add up */

const mixed = ecoScore([
  { name: 'Beef', category: 'meat_fish' },
  { name: 'Chicken', category: 'meat_fish' },
  { name: 'Carrots', category: 'fruit_veg' },
  { name: 'Bleach', category: 'household' },
]);
check('non-food is left out of the total', mixed.total, 3);
check('shares sum to one', Math.round((mixed.shares.low + mixed.shares.medium + mixed.shares.high) * 1000) / 1000, 1);

/* ------------------------------------------------- an empty basket is null */

check('an empty basket has no score', ecoScore([]).score, null);
check('...and no total', ecoScore([]).total, 0);

/* --------------------------------------------------------------- history */

const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 15, 12, 0, 0);
const buy = (name, category, at, store = null, bio = false) => ({ name, category, at, store, bio });

const weeks = weeklyEco(
  [
    // Last week: a proper shop, all light.
    ...['Carrots', 'Apples', 'Bread', 'Lentils'].map((n) =>
      buy(n, n === 'Bread' ? 'bakery' : 'fruit_veg', now - WEEK),
    ),
    // This week: one item. Real, but not a week anyone can be scored on.
    buy('Beef', 'meat_fish', now),
  ],
  now,
  weekStartOf,
  4,
);
check('every week in the window is present', weeks.length, 4);
check('a full week is scored', weeks[2].score, 100);
check('a thin week is null, not a bad score', weeks[3].score, null);
check('...though its items are still counted', weeks[3].total, 1);

const stores = ecoByStore([
  ...['Carrots', 'Apples', 'Spinach', 'Bread'].map((n) =>
    buy(n, n === 'Bread' ? 'bakery' : 'fruit_veg', now, 'aldi'),
  ),
  ...['Beef', 'Lamb', 'Cheese', 'Butter'].map((n) =>
    buy(n, n === 'Beef' || n === 'Lamb' ? 'meat_fish' : 'dairy_eggs', now, 'lidl'),
  ),
  // Two items at one shop is not a basket worth naming.
  buy('Beef', 'meat_fish', now, 'carrefour'),
]);
check('shops are ranked best first', stores.map((s) => s.store), ['aldi', 'lidl']);
check('a shop with too few items is dropped', stores.find((s) => s.store === 'carrefour'), undefined);
check('an unnamed shop is not a shop', ecoByStore([buy('Beef', 'meat_fish', now, null)]).length, 0);

/* ----------------------------------------------------------------- swaps */

const swaps = ecoSwaps([
  { name: 'Beef mince', category: 'meat_fish' },
  { name: 'beef mince', category: 'meat_fish' },
  { name: 'Cheddar cheese', category: 'dairy_eggs' },
  { name: 'Carrots', category: 'fruit_veg' },
]);
check('only heavy items get advice', swaps.length, 2);
check('the most-bought comes first', swaps[0].from, 'beef');
check('...counted across spellings', swaps[0].times, 2);
check('a light basket needs no advice', ecoSwaps([{ name: 'Carrots', category: 'fruit_veg' }]).length, 0);
// Every swap must point at something genuinely lighter, or the advice is noise.
for (const s of swaps) {
  assert(`the swap for ${s.from} names a target`, typeof s.to === 'string' && s.to.length > 0);
  assert(`...and it is not itself`, s.to !== s.from);
}

/* ---------------------------------------------------------------- colours */

check('three bands, three colours', Object.keys(CARBON_COLORS).sort(), ['high', 'low', 'medium']);
for (const [tier, hex] of Object.entries(CARBON_COLORS)) {
  assert(`${tier} is a hex colour`, /^#[0-9A-F]{6}$/i.test(hex));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
