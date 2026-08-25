/**
 * Canonicalisation parity + behaviour check.
 *
 * canonicalize() exists in two places — the client's lib/item-emoji.ts and the
 * edge function's _shared/canonical.ts — for the same reason fold() does, and
 * with the same silent failure mode: if they drift, the device and server swap
 * caches file the same food under different keys and quietly stop sharing work.
 * This loads BOTH and asserts:
 *
 *   1. client and server agree on canonicalize(fold(x)) for every case;
 *   2. the noise words are actually removed (it does its job);
 *   3. the two lines it must never cross hold — FORM words and PLANT qualifiers
 *      survive, because a canonical key that dropped them would serve the wrong
 *      food (a sauce for a solid) or freeze the eco score when a shopper swaps;
 *   4. it is idempotent and never returns empty.
 *
 * Run with `pnpm --filter mobile check:canonical`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'src', 'lib', 'item-emoji.ts');
const SERVER_FOLD = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fold.ts');
const SERVER_CANON = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'canonical.ts');

async function load(path, strip = []) {
  let source = readFileSync(path, 'utf8');
  for (const re of strip) source = source.replace(re, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const client = await load(CLIENT, [/^import\s[^;]*?from '@korb\/shared';/gm]);
const fold = await load(SERVER_FOLD);
const canon = await load(SERVER_CANON);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
};

// The client canonicalises what it just folded; so does the server. Both must
// agree end to end, which is what the cache actually depends on.
const cCanon = (s) => client.canonicalize(client.fold(s));
const sCanon = (s) => canon.canonicalize(fold.fold(s));

/* ---------------------------------------------- 1. client and server agree */

const PARITY_CASES = [
  'Sharp Cheddar', 'Extra Mature Cheddar', 'Organic Cheddar', 'Cheddar',
  'Grass Fed Beef', 'Free Range Eggs', 'Unsalted Butter', 'Salted Butter',
  'Bio Rindfleisch', 'Ser Wiejski', 'Fromage Fermier', 'Queso de Granja',
  'Premium Beef Mince', 'Value Chicken Breast', 'Belegen Kaas',
  'plant-based butter', 'Grated Parmesan', 'Extra Premium', 'ORGANIC',
  '', '   ', 'Beef', 'Formaggio Stagionato', 'Ostry Ser',
];
let drift = 0;
for (const input of PARITY_CASES) {
  const a = cCanon(input);
  const b = sCanon(input);
  if (a !== b) {
    drift += 1;
    console.log(`FAIL canonical drift on ${JSON.stringify(input)}\n  client ${JSON.stringify(a)}\n  server ${JSON.stringify(b)}`);
  }
}
if (drift) failures += drift;
check('client and server canonicalize() agree on every case', drift, 0);

/* --------------------------------------------------- 2. it removes the noise */

check('sharp cheddar collapses to cheddar', cCanon('Sharp Cheddar'), 'cheddar');
check('extra mature cheddar collapses to cheddar', cCanon('Extra Mature Cheddar'), 'cheddar');
check('organic strips', cCanon('Organic Cheddar'), 'cheddar');
check('grass-fed strips', cCanon('Grass Fed Beef'), 'beef');
check('free-range strips', cCanon('Free Range Eggs'), 'eggs');
check('unsalted strips', cCanon('Unsalted Butter'), 'butter');
check('salted strips', cCanon('Salted Butter'), 'butter');
check('premium strips', cCanon('Premium Beef Mince'), 'beef mince');
check('german bio strips', cCanon('Bio Rindfleisch'), 'rindfleisch');
check('polish wiejski strips', cCanon('Ser Wiejski'), 'ser');
check('dutch belegen strips', cCanon('Belegen Kaas'), 'kaas');
check('italian stagionato strips', cCanon('Formaggio Stagionato'), 'formaggio');

/* ------------------ 3. the two lines it must never cross (asserted per word) */

// FORM words survive — the steak-isn't-mince distinction the ladder rests on.
const FORM_WORDS = [
  'mince', 'ground', 'grated', 'shredded', 'sliced', 'block', 'whole',
  'fillet', 'breast', 'thigh', 'spread', 'powder', 'diced', 'roast', 'steak',
];
for (const w of FORM_WORDS) {
  check(`form word survives: ${w}`, cCanon(`cheese ${w}`).split(' ').includes(w), true);
}

// PLANT qualifiers survive — without them the eco score stops moving on a swap.
const PLANT_WORDS = ['plant', 'plantbased', 'vegan', 'oat', 'soya', 'soy', 'almond', 'coconut'];
for (const w of PLANT_WORDS) {
  check(`plant qualifier survives: ${w}`, cCanon(`${w} butter`).split(' ').includes(w), true);
}
// And the exact string the eco fix depends on.
check('"plant-based butter" keeps its qualifier', cCanon('Plant-based butter'), 'plant-based butter');

// Deliberately-kept ambiguous words (bias toward under-stripping).
check('fresh is kept (fresh vs hard cheese)', cCanon('Fresh Cheese'), 'fresh cheese');
check('smoked is kept', cCanon('Smoked Salmon'), 'smoked salmon');
check('dried is kept (dried fruit)', cCanon('Dried Fruit'), 'dried fruit');
check('light is kept (light spread)', cCanon('Light Spread'), 'light spread');
check('double is kept (double cream)', cCanon('Double Cream'), 'double cream');

/* --------------------------------------------- 4. idempotent, never empty */

for (const input of PARITY_CASES) {
  const once = cCanon(input);
  check(`idempotent: ${JSON.stringify(input)}`, client.canonicalize(once), once);
}
check('all-noise input keeps the original rather than emptying', cCanon('Extra Premium'), 'extra premium');
check('empty stays empty', cCanon(''), '');

console.log(failures === 0 ? 'ALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
