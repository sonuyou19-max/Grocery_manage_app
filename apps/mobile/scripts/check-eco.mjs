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
 * The per-shop roll-up and the swap suggestions were cut from the product, and
 * their assertions went with them rather than being kept "in case": a check
 * over code nothing calls is a check that will one day fail for a reason nobody
 * has to care about.
 *
 * Run with `pnpm --filter mobile check:eco`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib');

const compileAt = (path, req = () => ({})) => {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
};
const compile = (file, req) => compileAt(join(LIB, file), req);

const itemEmoji = compile('item-emoji.ts', () => ({}));
const nutrition = compile('nutrition.ts', () => ({}));
const purchaseLog = compile('purchase-log.ts', () => ({}));
const seasonal = compile('seasonal.ts', () => ({}));
const eco = compile('eco.ts', (spec) => {
  if (spec === '@/lib/item-emoji') return itemEmoji;
  if (spec === '@/lib/nutrition') return nutrition;
  return {};
});
const { carbonOf, ecoScore, heaviestStaple, weeklyEco, CARBON_COLORS } = eco;
const { inSeason, SEASONAL_PRODUCE, PRODUCE_KIND, PRODUCE_EMOJI } = seasonal;
// The shared glyph vocabulary, so the seasonal icons are held to exactly the set
// the AI is held to rather than to whatever looked fine while typing.
const allowlist = compileAt(
  join(HERE, '..', '..', '..', 'supabase', 'functions', '_shared', 'emoji-allowlist.ts'),
);
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

/* ------------------------------------------------- the biggest lever */

const bought = (name, category, times) =>
  Array.from({ length: times }, () => ({ name, category, store: null, at: now, bio: false }));

const lever = heaviestStaple([
  ...bought('Cheese', 'dairy_eggs', 5),
  ...bought('Beef', 'meat_fish', 3),
  ...bought('Carrots', 'fruit_veg', 20),
]);
check('the heaviest regular buy is named', lever?.name, 'Cheese');
check('...with how often it was bought', lever?.times, 5);
// Twenty bags of carrots must never win: the whole point is the HEAVY item you
// buy most, not the item you buy most.
check('a light item never wins, however often it is bought', lever?.name !== 'Carrots', true);
// Two is a coincidence. The sentence this feeds says "regularly" out loud, so
// it must not fire on a one-off roast.
check('twice is not a habit', heaviestStaple(bought('Beef', 'meat_fish', 2)), null);
check('three times is', heaviestStaple(bought('Beef', 'meat_fish', 3))?.times, 3);
check('a basket with nothing heavy has no lever', heaviestStaple(bought('Carrots', 'fruit_veg', 9)), null);
// Spelling drift is one habit, not two half-habits that each miss the cut.
check(
  'spellings of one item are counted together',
  heaviestStaple([...bought('Cheese', 'dairy_eggs', 2), ...bought('cheese', 'dairy_eggs', 1)])?.times,
  3,
);

/* ------------------------------------------------------------- in season */

// Every month must have something to say, or the card ends on a blank line in
// whichever month nobody thought about.
for (let m = 0; m < 12; m++) {
  const items = inSeason(new Date(Date.UTC(2026, m, 15)));
  assert(`month ${m + 1} has produce`, items.length > 0);
  // Six, and exactly six, because the section is a two-column grid: five leaves
  // a half-empty last row and seven starts a fourth row with one cell in it.
  // Asserted as equality rather than a ceiling so a month cannot quietly thin
  // out to three again while the grid keeps its shape.
  assert(`month ${m + 1} names exactly six`, items.length === 6);
  // A key with no locale string renders as a missing-translation error in the
  // one line of this feature that is supposed to feel like a gift.
  for (const k of items) {
    assert(`month ${m + 1}: "${k}" is a known produce key`, SEASONAL_PRODUCE.includes(k));
  }
  // Repeating an item inside one month would print "apples, apples, pears".
  assert(`month ${m + 1} has no duplicates`, new Set(items).size === items.length);

  // A balanced mix, not three of a kind. "In season now: pumpkin, parsnips,
  // cabbage" answers half the question somebody planning a shop is asking, and
  // three months of the calendar used to read exactly like that.
  const kinds = items.map((k) => PRODUCE_KIND[k]);
  assert(`month ${m + 1}: every item is classified`, kinds.every(Boolean));
  assert(`month ${m + 1} names a fruit`, kinds.includes('fruit'));
  assert(`month ${m + 1} names a vegetable`, kinds.includes('veg'));

  // No two items in the SAME month may share a glyph. Repeats across the table
  // are unavoidable — the allowlist has one leaf for five leafy greens — but two
  // cells side by side showing the same icon reads as a rendering bug rather than
  // as two vegetables. The assignments dodge this by pairing each shared glyph
  // with keys from opposite seasons, and that only stays true if it is checked:
  // moving kale into spring, or currants into autumn, breaks it silently.
  const glyphs = items.map((k) => PRODUCE_EMOJI[k]);
  assert(`month ${m + 1} has no repeated emoji`, new Set(glyphs).size === glyphs.length);
}

// The classification has to cover the list, or a new key would silently make
// the balance check above vacuous for whatever month it lands in.
assert(
  'every produce key is classified as fruit or veg',
  SEASONAL_PRODUCE.every((k) => PRODUCE_KIND[k] === 'fruit' || PRODUCE_KIND[k] === 'veg'),
);

// The emoji map has to be TOTAL over the keys. It replaced the generic
// item-emoji lookup, which took the translated name and matched none of these
// words — so every seasonal row drew the fruit_veg fallback and "plums" rendered
// as a head of lettuce. A key added without an emoji here would silently bring
// that back for one item, so the gap fails the build instead.
check(
  'every produce key has an emoji',
  SEASONAL_PRODUCE.filter((k) => typeof PRODUCE_EMOJI[k] !== 'string' || !PRODUCE_EMOJI[k]),
  [],
);
// And each one is from the shared allowlist, so the seasonal icons stay inside
// the same vocabulary the model is restricted to — no flags, no people, nothing
// that renders as two glyphs on one platform and a box on another.
check(
  'every produce emoji is in the shared allowlist',
  SEASONAL_PRODUCE.filter((k) => !allowlist.isAllowedEmoji(PRODUCE_EMOJI[k])),
  [],
);

// Strawberries in December would be the single most obvious way to lose the
// reader's trust in the whole calendar, so the two sentinel cases are pinned.
assert('strawberries are not in season in December', !inSeason(new Date(Date.UTC(2026, 11, 15))).includes('strawberries'));
assert('asparagus is not in season in October', !inSeason(new Date(Date.UTC(2026, 9, 15))).includes('asparagus'));
assert('strawberries do appear in early summer', inSeason(new Date(Date.UTC(2026, 4, 15))).includes('strawberries'));

// Every produce key must have a name in every language. check-i18n-keys can see
// that `eco.season.` is a live namespace but not that all 24 members are in it,
// and a gap renders as [missing "en.eco.season.parsnips" translation] on the one
// line of this whole feature that is meant to feel like a gift.
const LOCALES = join(HERE, '..', 'src', 'i18n', 'locales');
for (const lang of ['en', 'de', 'fr', 'it', 'es', 'nl', 'pl']) {
  const catalog = compileAt(join(LOCALES, `${lang}.ts`)).default;
  const season = catalog?.eco?.season ?? {};
  const missing = SEASONAL_PRODUCE.filter((k) => typeof season[k] !== 'string' || !season[k].trim());
  check(`${lang} names all ${SEASONAL_PRODUCE.length} seasonal items`, missing, []);
}

/* ---------------------------------------------------------------- colours */

check('three bands, three colours', Object.keys(CARBON_COLORS).sort(), ['high', 'low', 'medium']);
for (const [tier, hex] of Object.entries(CARBON_COLORS)) {
  assert(`${tier} is a hex colour`, /^#[0-9A-F]{6}$/i.test(hex));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
