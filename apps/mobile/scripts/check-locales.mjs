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

/** Transpile a TypeScript module in-process and return its exports. */
function loadTs(file) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => {});
  return mod.exports;
}

/** Load a locale's default export. */
const load = (locale) => loadTs(join(LOCALE_DIR, `${locale}.ts`)).default;

/**
 * The plural rules the APP actually runs, not a copy of them.
 *
 * This used to be a hand-written table in this file, which meant the check
 * could agree with itself while disagreeing with the engine — and that is
 * exactly the failure that shipped: the table said English needs one/other,
 * the locale files provided one/other, the check passed, and the running app
 * asked English for `many` anyway.
 */
const { PLURAL_RULES } = loadTs(join(HERE, '..', 'src', 'i18n', 'plural-rules.ts'));
const { LANGUAGES } = loadTs(join(HERE, '..', 'src', 'i18n', 'languages.ts'));

/**
 * Counts to exercise each rule against.
 *
 * 0-120 covers every boundary Polish cares about (mod 10 and mod 100 both turn
 * over inside it, including the 12-14 exception), and the fractions catch a
 * rule that forgets non-integers. Korb never pluralizes anything larger — item
 * counts, day counts, week counts.
 */
const PROBE_COUNTS = [...Array.from({ length: 121 }, (_, i) => i), 0.5, 1.5, 2.5];

/**
 * Which categories a language's rule can actually emit.
 *
 * Derived by running the rule, so it cannot drift from the code the app uses.
 */
function categoriesEmittedBy(rule) {
  const seen = new Set();
  for (const n of PROBE_COUNTS) seen.add(rule(n));
  return [...seen];
}

const REQUIRED_PLURALS = Object.fromEntries(
  Object.entries(PLURAL_RULES).map(([code, rule]) => [code, categoriesEmittedBy(rule)]),
);

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

/**
 * Every language the app offers must have its OWN registered plural rule.
 *
 * This is the check that would have caught the bug, and none of the ones below
 * could have. i18n-js resolves a pluralizer as
 *
 *     registry[requestedLocale] || registry[i18n.locale] || registry.default
 *
 * so a language with no entry silently borrows whichever rule the ENGINE-WIDE
 * locale happens to point at. With only Polish registered, switching Polish →
 * English rendered English strings through the Polish rule: count 5 asked for
 * `many`, English has no `many`, and every count on screen became
 * `[missing "en.lists.itemsCount.many" translation]`.
 *
 * Nothing about the locale FILES was wrong, which is why key-parity checking
 * had nothing to say about it. The defect was entirely in which rule ran.
 */
{
  const offered = LANGUAGES.map((l) => l.code);
  const missing = offered.filter((code) => !PLURAL_RULES[code]);
  const orphaned = Object.keys(PLURAL_RULES).filter((code) => !offered.includes(code));
  const problems = [];
  for (const code of missing) {
    problems.push(
      `"${code}" is offered in languages.ts but has no rule in plural-rules.ts — ` +
        'it will silently borrow whichever rule the engine-wide locale points at',
    );
  }
  for (const code of orphaned) {
    problems.push(`"${code}" has a plural rule but is not a language the app offers`);
  }
  if (problems.length) {
    fail('plural rules', problems);
    // Everything below indexes REQUIRED_PLURALS by language, which is derived
    // from the very table that just came up short. Continuing would replace a
    // clear diagnosis with a TypeError three checks later.
    console.error('\nFix plural-rules.ts before the remaining checks can run.');
    process.exit(1);
  }
  console.log(`✓ plural rules cover all ${offered.length} languages`);
}

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
