#!/usr/bin/env node
/**
 * lib/item-plural, and the rule about where it may be used.
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * The first is the stemmer itself. Its whole value is that "Potato" and
 * "Potatoes" reach the same key, and its whole risk is that two words which are
 * NOT the same item reach the same key too — at which point the app starts
 * refusing to let someone add a real second thing to their list, silently, with
 * no error anywhere. So the misses are pinned as hard as the hits: the Italian
 * and Polish cases the module deliberately does not handle are asserted to stay
 * separate, so that a later "improvement" that starts merging them has to come
 * past this file and say so.
 *
 * The second is the use-site split. findEquivalent is safe on an add (it
 * prevents a write) and wrong on a rename (it would block one the database
 * allows). That distinction lives in a comment in lib/item-dup, and a comment
 * cannot stop the next edit from reaching for the wrong one — so the rename
 * paths are checked directly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');

let failures = 0;
function check(what, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}

/* ------------------------------------------------------------- the stemmer */

// Transpiled and concatenated rather than imported: item-plural depends on
// fold() from item-emoji, and item-emoji has no runtime imports of its own, so
// the two sources joined in order are a valid module with no stubbing needed.
// Same loader as check-item-emoji, which is why the `@korb/shared` type import
// is the only thing that has to come out.
const strip = (file) =>
  readFileSync(join(src, 'lib', file), 'utf8')
    .replace(/^import\s[^;]*?from '@korb\/shared';/gm, '')
    .replace(/^import\s[^;]*?from '@\/lib\/item-emoji';/gm, '');

const { outputText } = ts.transpileModule(strip('item-emoji.ts') + '\n' + strip('item-plural.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const module = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
);

const { singularKey, samePlural } = module;

/* --- the pairs that must merge ------------------------------------------- */

const MERGE = [
  ['English -s', 'Apple', 'Apples'],
  ['English -s, four letters', 'Egg', 'Eggs'],
  ['English -oes', 'Potato', 'Potatoes'],
  ['English -oes again', 'Tomato', 'Tomatoes'],
  ['English -ies', 'Berry', 'Berries'],
  ['English -es after a sibilant', 'Dish', 'Dishes'],
  ['English -es after ss', 'Glass', 'Glasses'],
  ['English -n after -s stripping', 'Chicken', 'Chickens'],
  ['French -s', 'Oeuf', 'Oeufs'],
  ['Spanish -s', 'Huevo', 'Huevos'],
  ['Dutch -s', 'Aardappel', 'Aardappels'],
  ['German -n', 'Banane', 'Bananen'],
  ['German -n on a longer word', 'Tomate', 'Tomaten'],
  ['case and accents fold on the way in', 'TOMATÉ', 'tomate'],
  ['a phrase pluralises on its own head', 'Spring onion', 'spring onions'],
  ['identical names still match', 'Milk', 'Milk'],
  // The hand-written lists, for the plurals no suffix rule can reach.
  ['Italian, listed', 'Pomodoro', 'Pomodori'],
  ['Italian, listed', 'Uovo', 'Uova'],
  ['Polish, listed, ł folded', 'Jabłko', 'Jabłka'],
  ['Polish, listed', 'Pomidor', 'Pomidory'],
  ['Dutch vowel doubling, listed', 'Tomaat', 'Tomaten'],
  ['Dutch, listed', 'Ei', 'Eieren'],
  ["Dutch 's, listed", 'Avocado', "Avocado's"],
  // ...without pulling apart what the rules already merged in other languages.
  ['German Tomate still meets Tomaten', 'Tomate', 'Tomaten'],
  ['and Dutch tomaat lands on the same key', 'Tomaat', 'Tomate'],
  ['German Banane still meets Bananen', 'Banane', 'Bananen'],
  ['English Olive still meets Olives', 'Olive', 'Olives'],
  ['Dutch and Italian pears share one key', 'Peren', 'Pere'],
];
for (const [what, a, b] of MERGE) {
  check(`${what}: "${a}" = "${b}"`, samePlural(a, b), true);
}

/* --- the pairs that must NOT merge --------------------------------------- */

// Every one of these is a word the rules could plausibly chew into the other if
// a length floor or an exclusion were dropped.
const KEEP_APART = [
  ['a sibilant singular is not a plural', 'Hummus', 'Hummu'],
  ['-us is left alone', 'Asparagus', 'Asparagu'],
  ['-ss is left alone', 'Dress', 'Dres'],
  ['short words are not stemmed', 'Gas', 'Ga'],
  ['two real items that merely rhyme', 'Pear', 'Pea'],
  // Italian and Polish have no RULE, only a list: a word off the list is still
  // left alone, which is what keeps the list from becoming a rule by accident.
  ['Italian off the list is not attempted', 'Cono', 'Coni'],
  ['Polish off the list is not attempted', 'Kubek', 'Kubki'],
  ['different items stay different', 'Milk', 'Bread'],
];
for (const [what, a, b] of KEEP_APART) {
  check(`${what}: "${a}" != "${b}"`, samePlural(a, b), false);
}

/* --- structural properties ------------------------------------------------ */

check('an empty name has no key', singularKey('   '), '');
check('an empty name never matches another empty one', samePlural('', ''), false);
check('the key is idempotent', singularKey(singularKey('Potatoes')), singularKey('Potatoes'));

/* --- every listed pair, and nothing else --------------------------------- */

// Read from the source rather than retyped, so a pair added there is checked
// here without anyone remembering to.
const pluralSrc = readFileSync(join(src, 'lib', 'item-plural.ts'), 'utf8');
const listBody = pluralSrc.match(/const PLURAL_PAIRS[\s\S]*?\n\];/);
check('the plural list is where the guard expects it', listBody != null, true);
const pairs = [...(listBody?.[0] ?? '').matchAll(/\[\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*\]/g)].map(
  (m) => [m[2], m[4]],
);
check('the list was read', pairs.length > 100, true);
let pairMisses = 0;
let notIdempotent = 0;
for (const [one, many] of pairs) {
  if (!samePlural(one, many)) {
    pairMisses += 1;
    console.log(`  ✗ listed pair does not merge: ${one} / ${many}`);
  }
  for (const w of [one, many]) {
    if (singularKey(singularKey(w)) !== singularKey(w)) {
      notIdempotent += 1;
      console.log(`  ✗ key not idempotent: ${w}`);
    }
  }
}
check('every listed pair merges', pairMisses, 0);
check('every listed word has an idempotent key', notIdempotent, 0);

// No two DIFFERENT pairs may share a key unless they are the same food.
// Each group below is a cross-language merge that was looked at and is meant.
const INTENDED = new Set([
  'pera|pere|peer|peren',
  'banana|banane',
  'zucchina|zucchine|zucchino|zucchini',
]);
const groups = new Map();
for (const [one, many] of pairs) {
  const k = singularKey(one);
  groups.set(k, [...(groups.get(k) ?? []), one, many]);
}
let surprise = 0;
for (const words of groups.values()) {
  if (words.length <= 2) continue;
  const id = words.join('|');
  if (!INTENDED.has(id)) {
    surprise += 1;
    console.log(`  ✗ unexpected merge across pairs: ${id}`);
  }
}
check('listed pairs only merge where intended', surprise, 0);

/* --------------------------------------------- 2. the use-site split holds */

/*
 * A rename may legally change an item's number: the unique index is over
 * item_key, and "potato" and "potatoes" are two different keys, so Postgres
 * accepts the edit. If a rename asked findEquivalent it would refuse a write
 * the database would have taken — the app inventing a constraint of its own and
 * blocking an edit the user is entitled to make. Both backends, both renames.
 */
const groceries = readFileSync(join(src, 'store', 'groceries.tsx'), 'utf8');

// Sliced from each implementation's opening line rather than matched as a
// balanced body: the two differ in length by a factor of three (the cloud one
// carries the optimistic write and its recovery) and a single length-bounded
// pattern found only the short one.
const renames = [...groceries.matchAll(/^      renameItem: \(/gm)].map((m) =>
  groceries.slice(m.index, groceries.indexOf('\n      },', m.index)),
);
check('both backends still have a renameItem', renames.length, 2);
for (const [i, body] of renames.entries()) {
  check(
    `renameItem #${i + 1} checks strictly, not up to plural`,
    /findDuplicate\(/.test(body) && !/findEquivalent\(/.test(body),
    true,
  );
}

/*
 * And the mirror of it: every path that ADDS asks the loose question, or the
 * duplicate the user can see on screen is one the app was never going to catch.
 */
const addSites = [
  ['store addOrReviveItem', groceries, /addOrReviveItem: \([\s\S]{0,900}?findEquivalent\(/g, 2],
  [
    'the list page add bar',
    readFileSync(join(src, 'app', 'list', '[id].tsx'), 'utf8'),
    /findEquivalent\(list\.items, name\)/g,
    1,
  ],
  [
    'the quick-add sheet',
    readFileSync(join(src, 'components', 'quick-add-sheet.tsx'), 'utf8'),
    /findEquivalent\(listItems, /g,
    2,
  ],
];
for (const [what, text, pattern, expected] of addSites) {
  check(`${what} asks up to plural`, [...text.matchAll(pattern)].length, expected);
}

/*
 * dedupeByName collapses a batch before any of it is written, so it is on the
 * safe side of the split too — and it is the only defence against one AI parse
 * saying "tomato" and "tomatoes" in the same breath.
 */
const dup = readFileSync(join(src, 'lib', 'item-dup.ts'), 'utf8');
const dedupe = dup.match(/export function dedupeByName[\s\S]*?\n\}/);
check('dedupeByName collapses plurals', /singularKey\(/.test(dedupe?.[0] ?? ''), true);

const findDup = dup.match(/export function findDuplicate[\s\S]*?\n\}/);
check(
  'findDuplicate still models the index exactly',
  /normalizeKey\(/.test(findDup?.[0] ?? '') && !/singularKey\(/.test(findDup?.[0] ?? ''),
  true,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
