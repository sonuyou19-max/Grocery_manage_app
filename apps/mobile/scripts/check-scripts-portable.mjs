/**
 * The guard scripts have to run on the machine that runs them.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * These checks are developed on Linux and run on Windows. That asymmetry has a
 * specific consequence: a path bug in a check script is INVISIBLE where it is
 * written and fatal where it is used. `check-list-sweep` did exactly this — it
 * built paths with `join`, which emits backslashes on Windows, then took the
 * filename with `f.split('/').pop()`. On Linux that returns `groceries.tsx`; on
 * Windows it returns the entire path, the lookup misses, and the check reports
 * a file that is plainly there as missing.
 *
 * The failure is worse than a wrong answer. It arrives as a red `1 FAILURE(S)`
 * in the middle of a thirty-script run, on a machine the author cannot
 * reproduce, about a file that is sitting right there — and it blocks a build
 * for something that was never broken.
 *
 * So: the separator is `path.sep`, and no script may assume otherwise.
 *
 * ---------------------------------------------------------------------------
 * What counts as a violation
 * ---------------------------------------------------------------------------
 *
 * Splitting or slicing a PATH on a literal '/'. Not every '/' — a relative path
 * that has already been normalised (`replace(/\\/g, '/')` or the equivalent
 * split/join) is fine and several scripts rely on it, which is the correct
 * pattern: normalise once at the boundary, then compare freely.
 *
 * Run with `pnpm --filter mobile check:scripts-portable`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};

const SELF = basename(fileURLToPath(import.meta.url));
const scripts = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs') && f !== SELF)
  .map((f) => ({ name: f, src: readFileSync(join(HERE, f), 'utf8') }));

/*
 * A variable holding a real filesystem path — one built by join/resolve or
 * handed to readFileSync — being cut on a literal '/'. The narrow shape is
 * deliberate: `'store/groceries.tsx'.split('/')` on a string literal is fine,
 * and `rel.split('/')` after normalisation is the intended idiom.
 */
const PATH_SPLIT = /\b(?:file|full|path|f|p)\s*\.\s*(?:split\(\s*['"]\/['"]\s*\)|lastIndexOf\(\s*['"]\/['"]\s*\))/g;

const offenders = [];
for (const s of scripts) {
  const code = s.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(PATH_SPLIT)) {
    const line = code.slice(0, m.index).split('\n').length;
    offenders.push(`${s.name}:${line}  ${m[0]}`);
  }
}

if (offenders.length) {
  fail(`${offenders.length} script(s) cut a filesystem path on a literal '/'`, [
    ...offenders.map((o) => `  ${o}`),
    "`join` emits '\\' on Windows, so this returns the whole path there and",
    'every filename comparison after it misses — silently, and only on the',
    'machine you cannot test. Use basename() for a filename, or normalise once',
    "with relative(...).replace(/\\\\/g, '/') and compare the normalised form.",
  ]);
} else {
  console.log(`ok   no script cuts a path on a literal '/' (${scripts.length} scanned)`);
}

/*
 * Scripts that DO compare relative paths must normalise them first. Checked by
 * pairing the two: if a file calls relative() and then compares the result to a
 * string containing '/', it needs a separator fix somewhere in between.
 */
const unnormalised = [];
for (const s of scripts) {
  const code = s.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (!/\brelative\s*\(/.test(code)) continue;
  // Either idiom counts: .replace(/\\/g,'/') or .split('\\').join('/').
  const normalises = /replace\(\s*\/\\\\\/g\s*,\s*['"]\/['"]\s*\)/.test(code) || /split\(\s*'\\\\'\s*\)/.test(code);
  // Only a problem if it then compares against a path-shaped literal.
  const comparesPaths = /['"][\w.-]+\/[\w.-]+\.tsx?['"]/.test(code);
  if (comparesPaths && !normalises) unnormalised.push(s.name);
}

if (unnormalised.length) {
  fail(`${unnormalised.length} script(s) compare un-normalised relative paths`, [
    ...unnormalised.map((u) => `  ${u}`),
    "They match against literals like 'store/groceries.tsx', which never equal",
    "a Windows 'store\\\\groceries.tsx'. Normalise the separator where the",
    'relative path is built, then compare.',
  ]);
} else {
  console.log('ok   every script that compares relative paths normalises them first');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
