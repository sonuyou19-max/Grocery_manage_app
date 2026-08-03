/**
 * Recap markup check.
 *
 * The weekly recap is the only text in Korb that a language model formats, and
 * the model is asked to do it in seven languages. It will get it wrong. What
 * matters is not that the bold lands but that a malformed answer still reads as
 * a normal paragraph — no stray asterisks, no dropped words, no crash.
 *
 * Every case below is a way the model, or a recap cached before the prompt
 * asked for markers, actually reaches this parser.
 *
 * Run with `pnpm --filter mobile check:recap-markup`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'lib', 'recap-markup.ts');

const js = ts.transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { recapRuns } = mod.exports;

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

/** Text as the reader sees it — the invariant that must never break. */
const flatten = (s) =>
  recapRuns(s)
    .map((r) => r.text)
    .join('');

/* ------------------------------------------------------- the happy path */

check('a marked figure comes back bold', recapRuns('You bought **13 items** today.'), [
  { text: 'You bought ', bold: false },
  { text: '13 items', bold: true },
  { text: ' today.', bold: false },
]);

check('two marks in one sentence', recapRuns('**13 items**, **€43** spent.'), [
  { text: '13 items', bold: true },
  { text: ', ', bold: false },
  { text: '€43', bold: true },
  { text: ' spent.', bold: false },
]);

/* ------------------------------------- what the model gets wrong instead */

// The whole reason this parser is defensive. An unclosed marker must not make
// the rest of the recap bold, and must not eat the asterisks into nothing.
check('an unclosed marker leaves its text plain', recapRuns('You bought **13 items today.'), [
  { text: 'You bought ', bold: false },
  { text: '13 items today.', bold: false },
]);

// Every recap written before the prompt asked for markers — still cached on
// devices and in household_recaps.
check('unmarked prose is one plain run', recapRuns('A quiet week.'), [
  { text: 'A quiet week.', bold: false },
]);

check('an empty recap yields no runs', recapRuns(''), []);

// A marker at the very edge would otherwise emit a zero-width <Text>, which
// React Native renders as a line-height bump rather than as nothing.
check('a leading marker produces no empty run', recapRuns('**13 items** today.'), [
  { text: '13 items', bold: true },
  { text: ' today.', bold: false },
]);
check('adjacent markers produce no empty run', recapRuns('**a****b**'), [
  { text: 'a', bold: true },
  { text: 'b', bold: true },
]);

/* --------------------------------------------- the invariant that matters */

// Whatever the model emits, the words must survive. Asterisks are the only
// thing allowed to disappear.
for (const sample of [
  'Plain text with no markers at all.',
  '**Bold** at the start.',
  'Bold at the **end**',
  'An **unclosed run',
  '*** three markers ** here',
  '**',
  '****',
  'Ünïcödé and emoji 🛒 with **€43** in it',
]) {
  check(`no words lost: ${JSON.stringify(sample)}`, flatten(sample), sample.split('**').join(''));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
