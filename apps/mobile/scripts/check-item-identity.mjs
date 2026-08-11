/**
 * One rule for "is this the same item", implemented once.
 *
 * ---------------------------------------------------------------------------
 * What this is protecting
 * ---------------------------------------------------------------------------
 *
 * Item identity is decided in three places that must agree:
 *
 *   1. `normalizeKey` in lib/pantry-intel — the client's answer, used by the
 *      pantry, the purchase log, item-memory and the home-list map;
 *   2. `item_key` on list_items — a STORED GENERATED column (migration 0018),
 *      with a unique index over the unticked rows;
 *   3. every duplicate check in the UI.
 *
 * When 3 uses its own trim-and-lowercase, it is not merely a bit laxer than 1.
 * It lets an insert through that 2 will reject — and the insert is optimistic,
 * so the user watches the row they just added quietly vanish. That is exactly
 * what "Olive  oil" with two spaces did: the client saw no duplicate, Postgres
 * saw one, and nothing on screen explained it.
 *
 * So this asserts two different things:
 *
 *   - no file re-implements the rule with an ad-hoc `.trim().toLowerCase()`
 *     comparison against an item name;
 *   - `normalizeKey` and the SQL expression in migration 0018 produce the same
 *     answer, checked by running the JS and reading the SQL rather than by
 *     trusting that two people wrote the same thing twice.
 *
 * Run with `pnpm --filter mobile check:item-identity`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const MIGRATION = join(HERE, '..', '..', '..', 'supabase', 'migrations', '0018_no_duplicate_items.sql');

let failures = 0;
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};
const check = (title, actual, expected) => {
  if (Object.is(actual, expected)) console.log(`ok   ${title}`);
  else fail(title, [`expected ${JSON.stringify(expected)}`, `actual   ${JSON.stringify(actual)}`]);
};

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = walk(SRC).map((full) => ({
  rel: relative(SRC, full).split('\\').join('/'),
  src: code(readFileSync(full, 'utf8')),
}));

/* ------------------------- 1. nobody re-implements the rule -------------- */

/*
 * Files allowed their own normaliser, and why. Each is a DIFFERENT question,
 * not a looser version of this one:
 *
 *   pantry-intel  defines normalizeKey itself.
 *   item-emoji    `fold` is deliberately STRONGER — it strips accents too, for
 *                 lexicon lookup, where "crème" and "creme" should hit one row.
 *   nutrition     splits a name into words and looks each up in a keyword
 *                 table; it never compares two item names to each other.
 */
const EXEMPT = new Set(['lib/pantry-intel.ts', 'lib/item-emoji.ts', 'lib/nutrition.ts']);

/**
 * An ad-hoc normalisation applied to something that looks like an item name.
 * Deliberately narrow: `query.trim().toLowerCase()` for a SEARCH box is fine
 * and common, so the match requires the receiver to be name-ish.
 */
const AD_HOC = /\b(?:it|item|p|entry|row)\.name\s*\.\s*trim\(\)\s*\.\s*toLowerCase\(\)/;

const offenders = files.filter((f) => !EXEMPT.has(f.rel) && AD_HOC.test(f.src));
if (offenders.length) {
  fail(`${offenders.length} file(s) normalise an item name by hand`, [
    ...offenders.map((f) => `  ${f.rel}`),
    'Use normalizeKey from lib/pantry-intel. A local trim-and-lowercase does',
    'not collapse runs of whitespace, so it disagrees with item_key in the',
    'database — and the insert it lets through is rejected there, which the',
    'user sees as the row silently disappearing.',
  ]);
} else {
  console.log('ok   no file normalises an item name by hand');
}

/* ------------------- 2. the client rule and the SQL agree ---------------- */

const js = ts.transpileModule(readFileSync(join(SRC, 'lib', 'pantry-intel.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { normalizeKey } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

const sql = readFileSync(MIGRATION, 'utf8');

/*
 * Read the generated column's expression out of the migration and re-implement
 * THAT, rather than hard-coding what it is supposed to say. If someone edits
 * the SQL, this reads the edit.
 */
const generated = sql.match(/generated always as \(([\s\S]*?)\) stored/i)?.[1];
if (!generated) {
  fail('could not find item_key\'s expression in migration 0018', [
    'This check compares it against normalizeKey. If the column moved to a',
    'later migration, point MIGRATION at it.',
  ]);
} else {
  const flat = generated.replace(/\s+/g, ' ').trim();
  const expected = "lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))";
  if (flat !== expected) {
    fail('item_key is no longer the expression this check knows how to model', [
      `  sql: ${flat}`,
      `  had: ${expected}`,
      'Update the Postgres model below to match, then re-run — do not just',
      'widen this string, or the two rules drift silently again.',
    ]);
  } else {
    console.log('ok   item_key still reads as the expression modelled here');
    /*
     * `[[:space:]]` resolves through glibc's iswspace, NOT through JavaScript's
     * `\s`. Measured against Postgres 16 (UTF8), the two agree on every
     * whitespace codepoint except four — every one of them a NON-BREAKING
     * space, which iswspace rejects and `\s` accepts:
     *
     *   U+00A0  U+2007  U+202F  U+FEFF
     *
     * That is not a detail: U+00A0 is everywhere in text copied from a web
     * page, and the recipe importer's whole input is pasted text.
     *
     * `btrim` with no second argument strips ' ' only, not all whitespace —
     * hence the plain-space trim rather than \s, applied AFTER the collapse,
     * matching the nesting in the SQL.
     */
    const pgItemKey = (name) =>
      name
        .replace(/[\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/g, ' ')
        .replace(/^ +| +$/g, '')
        .toLowerCase();

    const CASES = [
      'Milk',
      'milk',
      '  Milk  ',
      'Olive  oil',
      'Olive\toil',
      'Olive \t oil',
      'olive oil',
      'Crème fraîche',
      'CRÈME FRAÎCHE',
      'Śliwki',
      'Vollmilch  3,5%',
      'a\nb',
      '   ',
      '',
      'Ben & Jerry’s',
      'pão de queijo',
      // The four that disagree with JS `\s`. Each must survive as itself.
      'Olive\u00a0oil',
      'Olive\u2007oil',
      'Olive\u202foil',
      'Olive\ufeffoil',
      // Representatives of the ones that DO collapse, so the class cannot be
      // narrowed to ASCII and quietly pass.
      'Olive\u2009oil',
      'Olive\u3000oil',
      'Olive\u1680oil',
      'Olive\u2028oil',
      // Zero-width space is not whitespace to either, and must not be eaten.
      'Olive\u200boil',
    ];
    let mismatch = null;
    for (const c of CASES) {
      if (normalizeKey(c) !== pgItemKey(c)) {
        mismatch = { c, js: normalizeKey(c), pg: pgItemKey(c) };
        break;
      }
    }
    if (mismatch) {
      fail('normalizeKey and item_key disagree', [
        `  input     ${JSON.stringify(mismatch.c)}`,
        `  client    ${JSON.stringify(mismatch.js)}`,
        `  postgres  ${JSON.stringify(mismatch.pg)}`,
        'The client would let this through and the unique index would reject it.',
      ]);
    } else {
      console.log(`ok   ...and agrees with normalizeKey on all ${CASES.length} cases`);
    }
  }
}

/* ---------------- 3. the cases that motivated the fix -------------------- */

// The exact bug: two spaces read as one item by Postgres, two by the old check.
check('a double space collapses', normalizeKey('Olive  oil'), 'olive oil');
/*
 * And the subtler one underneath it. normalizeKey used `\s`, which collapses
 * a no-break space; Postgres does not. A name pasted from a web page was
 * therefore one item to the pantry and another to the unique index.
 */
check('a no-break space is NOT collapsed, as in Postgres', normalizeKey('Olive\u00a0oil'), 'olive\u00a0oil');
check('a thin space IS collapsed, as in Postgres', normalizeKey('Olive\u2009oil'), 'olive oil');
check('an ideographic space IS collapsed', normalizeKey('Olive\u3000oil'), 'olive oil');
check('a BOM survives', normalizeKey('Olive\ufeffoil'), 'olive\ufeffoil');
check('a tab collapses', normalizeKey('Olive\toil'), 'olive oil');
check('case folds', normalizeKey('MILK'), 'milk');
check('edges trim', normalizeKey('  Milk  '), 'milk');
// And the cases it must NOT merge — normalizeKey is not accent-folding, which
// is item-emoji's `fold`. Merging these would silently join two real items.
check('accents are preserved', normalizeKey('Crème'), 'crème');
check('a plural stays its own item', normalizeKey('Tomaten'), 'tomaten');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
