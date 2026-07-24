/**
 * Locale parity check.
 *
 * English is the source of truth; every other locale must mirror its keys.
 * Missing keys still render (the engine falls back to English), so this is the
 * only thing that catches a half-translated locale before it ships.
 *
 * Plural entries are checked per-language rather than key-for-key: Polish needs
 * one/few/many where English needs one/other, so a literal comparison would
 * wrongly flag correct Polish. Instead we assert each locale supplies exactly
 * the plural categories its own CLDR rule can produce.
 *
 * Run with `pnpm --filter mobile check:locales`. Exits non-zero on any problem.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALE_DIR = join(HERE, '..', 'src', 'i18n', 'locales');

const SOURCE = 'en';
const TARGETS = ['de', 'es', 'fr', 'it', 'nl', 'pl'];

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Plural categories each language must define. Everything here except Polish
 * uses the English-style one/other split.
 */
const REQUIRED_PLURALS = {
  en: ['one', 'other'],
  de: ['one', 'other'],
  es: ['one', 'other'],
  fr: ['one', 'other'],
  it: ['one', 'other'],
  nl: ['one', 'other'],
  pl: ['one', 'few', 'many'],
};

/** Load a locale's default export by transpiling it in-process. */
function load(locale) {
  const src = readFileSync(join(LOCALE_DIR, `${locale}.ts`), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => {});
  return mod.exports.default;
}

const isPluralGroup = (value) =>
  value !== null &&
  typeof value === 'object' &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((k) => PLURAL_CATEGORIES.has(k));

/** Walk a catalog into { leaves: Set<path>, plurals: Set<path> }. */
function walk(node, prefix = '', acc = { leaves: new Set(), plurals: new Set() }) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPluralGroup(value)) acc.plurals.add(path);
    else if (value !== null && typeof value === 'object') walk(value, path, acc);
    else acc.leaves.add(path);
  }
  return acc;
}

/** Every %{placeholder} used in a string (or in a plural group's strings). */
function placeholders(value) {
  const found = new Set();
  const scan = (s) => {
    for (const m of String(s).matchAll(/%\{(\w+)\}/g)) found.add(m[1]);
  };
  if (typeof value === 'object' && value !== null) Object.values(value).forEach(scan);
  else scan(value);
  return found;
}

const at = (catalog, path) =>
  path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), catalog);

const en = load(SOURCE);
const enShape = walk(en);
let failed = false;

const fail = (locale, lines) => {
  failed = true;
  console.error(`\n✗ ${locale}`);
  for (const line of lines) console.error(`    ${line}`);
};

// The source itself must declare the plural categories English needs.
for (const path of enShape.plurals) {
  const missing = REQUIRED_PLURALS[SOURCE].filter((c) => at(en, path)[c] === undefined);
  if (missing.length) fail(SOURCE, [`${path}: missing plural form(s) ${missing.join(', ')}`]);
}

for (const locale of TARGETS) {
  const catalog = load(locale);
  const shape = walk(catalog);
  const problems = [];

  const missingLeaves = [...enShape.leaves].filter((p) => !shape.leaves.has(p));
  const missingPlurals = [...enShape.plurals].filter((p) => !shape.plurals.has(p));
  const extra = [
    ...[...shape.leaves].filter((p) => !enShape.leaves.has(p) && !enShape.plurals.has(p)),
    ...[...shape.plurals].filter((p) => !enShape.plurals.has(p) && !enShape.leaves.has(p)),
  ];

  for (const p of missingLeaves) problems.push(`missing key: ${p}`);
  for (const p of missingPlurals) problems.push(`missing plural key: ${p}`);
  for (const p of extra) problems.push(`unknown key (not in ${SOURCE}): ${p}`);

  // Each plural group must carry exactly the categories this language needs.
  for (const path of enShape.plurals) {
    const group = at(catalog, path);
    if (!isPluralGroup(group)) continue;
    const missing = REQUIRED_PLURALS[locale].filter((c) => group[c] === undefined);
    if (missing.length) problems.push(`${path}: missing plural form(s) ${missing.join(', ')}`);
  }

  // A dropped %{placeholder} renders a literal gap in the UI, so treat it as an
  // error rather than something a reviewer has to spot by eye.
  for (const path of [...enShape.leaves, ...enShape.plurals]) {
    const source = at(en, path);
    const target = at(catalog, path);
    if (target === undefined) continue;
    const expected = placeholders(source);
    const actual = placeholders(target);
    const lost = [...expected].filter((p) => !actual.has(p));
    const gained = [...actual].filter((p) => !expected.has(p));
    if (lost.length) problems.push(`${path}: dropped placeholder(s) %{${lost.join('}, %{')}}`);
    if (gained.length) problems.push(`${path}: unexpected placeholder(s) %{${gained.join('}, %{')}}`);
  }

  if (problems.length) fail(locale, problems);
  else
    console.log(
      `✓ ${locale}  ${shape.leaves.size} keys + ${shape.plurals.size} plural groups, placeholders intact`,
    );
}

if (failed) {
  console.error('\nLocale check failed.');
  process.exit(1);
}
console.log(`\nAll locales match ${SOURCE}.`);
