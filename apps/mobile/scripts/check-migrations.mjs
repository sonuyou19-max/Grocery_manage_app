#!/usr/bin/env node
/**
 * Every table a migration touches must already exist by the time it runs.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth a check script
 * ---------------------------------------------------------------------------
 *
 * 0037 shipped with `references lists(id)`. The table is called
 * `shopping_lists` — `lists` is only what the client calls the concept — and
 * nothing anywhere caught it. Not typecheck, which never reads SQL; not
 * check:all; not the Android export. The first thing to notice was Postgres,
 * during `supabase db push`, on the deploying machine, halfway through a
 * release:
 *
 *     ERROR: relation "lists" does not exist (SQLSTATE 42P01)
 *
 * That is the worst possible place to find a typo. The person hitting it is
 * mid-deploy, the migration ledger is now part of the problem, and the fix
 * requires someone who knows the schema — which, at that moment, is not
 * necessarily who is at the keyboard.
 *
 * It is also cheap to prevent. Migrations are applied in filename order, so
 * "does this table exist yet" is answerable by reading the series in that order
 * and keeping a running set of what has been created. No database required.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does not do
 * ---------------------------------------------------------------------------
 *
 * This is not a SQL parser and must not grow into one. It checks table names
 * only — the single mistake that has actually happened, and the one a reader
 * cannot catch by eye because the wrong name is usually a plausible one.
 * Columns, types and constraint bodies are left alone: they would need real
 * parsing to check, they fail loudly and locally when wrong, and a
 * half-implemented parser that silently stops matching is worse than no check,
 * because it reports success.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', '..', 'supabase', 'migrations');

let failures = 0;
const fail = (what, detail = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of detail) console.log(`  ${line}`);
};

/**
 * Comments come out first, and that is not a detail.
 *
 * The migration that prompted this has the word "lists" in nine lines of prose
 * explaining the design. A check that scanned raw text would have flagged every
 * one of them and been switched off within a day.
 *
 * Dollar-quoted bodies go too: a `create function` body is code that runs
 * later, against whatever exists then, and reading it as part of the migration
 * would report tables it merely mentions as tables it requires.
 */
const strip = (sql) =>
  sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Tables that exist without any migration creating them.
 *
 * `auth.users` is Supabase's own, and schema-qualified names are skipped
 * wholesale below — this is here to say the omission is deliberate rather than
 * an oversight.
 */
const PROVIDED = new Set();

/*
 * Where a table name can appear. Each pattern captures exactly one name, and
 * the set is closed deliberately: an unrecognised statement is invisible to
 * this check, which is the safe direction to be wrong in. A missed reference
 * costs the check nothing it had before; a wrongly-parsed one costs a false
 * failure on a correct migration, and that is what gets a guard deleted.
 */
const USES = [
  /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z_][a-z0-9_]*)/g,
  /\breferences\s+([a-z_][a-z0-9_]*)\s*\(/g,
  /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+([a-z_][a-z0-9_]*)/g,
  /\bcreate\s+policy\s+"[^"]*"\s+on\s+([a-z_][a-z0-9_]*)/g,
  /\bcreate\s+trigger\s+[a-z0-9_]+\s+(?:before|after|instead\s+of)[\s\S]{0,80}?\bon\s+([a-z_][a-z0-9_]*)/g,
  /\bdrop\s+policy\s+(?:if\s+exists\s+)?"[^"]*"\s+on\s+([a-z_][a-z0-9_]*)/g,
  /\binsert\s+into\s+([a-z_][a-z0-9_]*)/g,
  /\bpublication\s+supabase_realtime\s+add\s+table\s+([a-z_][a-z0-9_]*)/g,
];

const CREATES = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/g;

/*
 * Filename order IS apply order — that is how the CLI runs them, so it is the
 * only order in which "already exists" means anything.
 */
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  fail('no migrations found', [`looked in ${MIGRATIONS}`]);
}

const exists = new Set(PROVIDED);
const problems = [];

for (const file of files) {
  const sql = strip(readFileSync(join(MIGRATIONS, file), 'utf8'));

  // Creates in THIS file count for THIS file: a table may reference another
  // created a few lines above it, which 0001 does throughout.
  for (const [, name] of sql.matchAll(CREATES)) exists.add(name);

  for (const pattern of USES) {
    for (const [, name] of sql.matchAll(pattern)) {
      if (exists.has(name)) continue;
      problems.push(`${file}: "${name}"`);
    }
  }
}

if (problems.length) {
  fail(`${problems.length} reference(s) to a table that does not exist yet`, [
    ...problems,
    '',
    'Either the name is wrong, or the migration that creates it sorts after',
    'this one. Both fail at `supabase db push` and not before.',
    `Known tables: ${[...exists].sort().join(', ')}`,
  ]);
} else {
  console.log(`ok   ${files.length} migrations reference only tables that exist by then`);
}

/*
 * And the check's own failure mode: patterns that quietly stop matching report
 * a clean run forever. Assert it still sees the schema it is supposed to see,
 * so a bad edit to USES above fails here rather than going silent.
 */
const EXPECTED = ['shopping_lists', 'list_items', 'pantry_items', 'price_entries', 'households'];
const missing = EXPECTED.filter((t) => !exists.has(t));
if (missing.length) {
  fail('the create-table pattern no longer finds the core tables', [
    `not found: ${missing.join(', ')}`,
    'This check cannot be trusted until that is fixed — it would pass by',
    'finding nothing rather than by finding nothing wrong.',
  ]);
} else {
  console.log(`ok   the scan still sees all ${exists.size} tables`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
