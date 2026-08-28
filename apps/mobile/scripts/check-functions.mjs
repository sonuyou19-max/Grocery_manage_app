#!/usr/bin/env node
/**
 * The edge functions have to parse.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 *
 * `pnpm typecheck` compiles apps/mobile. Nothing compiled supabase/functions —
 * they are Deno, not part of the app's tsconfig, and the only thing that ever
 * read them was the deploy.
 *
 * So receipt-scan sat broken in main for the whole of one session. A stray pair
 * of backticks around a word inside SYSTEM_PROMPT ended the template literal
 * early, which turned the rest of the prompt's prose into code, and the file
 * has not compiled since. `check:all` passed every time, forty-eight scripts
 * of it, because not one of them opened the file. It failed at `supabase
 * functions deploy` with a parse error pointing at a sentence — the worst place
 * to learn, because by then you are mid-deploy and the error reads as a server
 * problem.
 *
 * ---------------------------------------------------------------------------
 * Parsing, not typechecking
 * ---------------------------------------------------------------------------
 *
 * These import from `npm:` and `https:` specifiers and run on Deno's globals,
 * so a full typecheck would need Deno's types and its module resolution —
 * neither of which this repo has, and installing them to catch a syntax error
 * is a lot of machinery for the wrong layer.
 *
 * TypeScript's own parser answers the exact question the deploy asks: is this
 * file syntactically a TypeScript module. That is what broke, it is what breaks
 * again when somebody edits a long prompt, and it costs nothing.
 *
 * Run with `pnpm --filter mobile check:functions`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, '..', '..', '..', 'supabase', 'functions');

let failures = 0;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });

const files = walk(FUNCTIONS);
if (files.length === 0) {
  console.log('FAIL no edge functions found — has the path moved?');
  process.exit(1);
}

for (const file of files) {
  const rel = relative(FUNCTIONS, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = sf.parseDiagnostics ?? [];

  if (diagnostics.length === 0) {
    console.log(`ok   ${rel}`);
    continue;
  }

  failures += 1;
  console.log(`FAIL ${rel} does not parse`);
  for (const d of diagnostics.slice(0, 5)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    console.log(`  ${line + 1}:${character + 1}  ${message}`);
  }
  /*
   * The likeliest cause, named, because the error TypeScript gives for it
   * points at whatever prose happened to follow — a sentence, with no hint that
   * a quote character is what ended the string.
   */
  console.log('  A backtick inside a template literal ends it. Prompts are the usual place.');
}

/*
 * And the specific trap, checked directly rather than left to the parser.
 *
 * A template literal that closes early does not always fail to parse — it can
 * land somewhere that still happens to be valid TypeScript, and then the prompt
 * silently ships truncated. That is worse than a build error: the model gets
 * half its instructions and the receipts come back subtly wrong.
 */
for (const file of files) {
  const rel = relative(FUNCTIONS, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  for (const [, name, body] of text.matchAll(/const (\w*PROMPT\w*) = `([\s\S]*?)`;/g)) {
    if (!body.includes('`')) continue;
    failures += 1;
    console.log(`FAIL ${rel}: ${name} contains a backtick`);
    console.log('  It ends the template literal there. Use "quotes" in prompt prose.');
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
