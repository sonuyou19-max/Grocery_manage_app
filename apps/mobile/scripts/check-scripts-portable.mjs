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
 * And the same asymmetry in package.json, which this did not look at
 * ---------------------------------------------------------------------------
 *
 * The three `:tz` scripts were shell loops — `for tz in UTC …; do … done` —
 * written on Linux and run on Windows, where pnpm hands scripts to cmd.exe.
 * cmd has no such construct and answers `tz was unexpected at this time.`
 *
 * Exactly the failure described above, in a file this guard had never opened:
 * invisible where it was written, fatal where it was used, and reported as a
 * broken command rather than as a broken check. It shipped three times, because
 * one copy of a mistake teaches nobody and three copies of it look like a
 * convention.
 *
 * So package.json is read too, and a script may be a plain command with plain
 * arguments. A loop, a conditional, an inline env var or a pipe belongs in a
 * .mjs file where both platforms run the same code — see run-tz.mjs, which is
 * what those three became.
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

/*
 * ---------------------------------------------------------------------------
 * Line endings: the same bug wearing different clothes
 * ---------------------------------------------------------------------------
 *
 * Git on Windows checks text out with CRLF unless told otherwise, and a guard
 * that searches source for a literal containing a newline then finds nothing.
 * check-account-switch did exactly this: it looked for
 *
 *     '  useEffect(() => {\n    if (!restoredRef.current) return;'
 *
 * which is simply not present in a file whose newlines are '\r\n'. indexOf
 * returned -1, slice(-1) handed back one character, and the block it was meant
 * to examine came out empty. Two assertions went red on a machine where nothing
 * was wrong — and a third, asserting something was ABSENT, passed against the
 * empty string. Reporting success for a check that never ran is the worse half.
 *
 * The root cause is fixed at the repo level by .gitattributes. This catches the
 * next script written against a working tree that already has CRLF in it, where
 * the author would see it pass.
 *
 * A leading '\n' is FINE — '\nRULES.' does occur inside '\r\nRULES.'. The
 * hazard is a newline with literal text before it, which is what splits.
 */
const NEWLINE_SEARCH = /\.(?:indexOf|includes|lastIndexOf|split)\(\s*'((?:[^'\\]|\\.)*)'/g;

const crlfBlind = [];
for (const s of scripts) {
  const code = s.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Any of the usual ways of flattening line endings before matching.
  const normalises =
    /replace\(\s*\/\\r\\n\/g/.test(code) ||
    /replace\(\s*\/\\r\/g/.test(code) ||
    /split\(\s*\/\\r\?\\n\//.test(code);
  if (normalises) continue;

  for (const m of code.matchAll(NEWLINE_SEARCH)) {
    const literal = m[1];
    const at = literal.indexOf('\\n');
    // Not present, or present only at the very start: both safe.
    if (at <= 0) continue;
    crlfBlind.push(`${s.name}: ${JSON.stringify(m[0].slice(0, 72))}`);
    break;
  }
}

if (crlfBlind.length) {
  fail(`${crlfBlind.length} script(s) search source across a newline without normalising`, [
    ...crlfBlind.map((c) => `  ${c}`),
    'A literal with text before its \\n cannot match a CRLF working tree.',
    "Read the source through .replace(/\\r\\n/g, '\\n') first, or match with a",
    "regex using \\r?\\n — and make a miss FAIL rather than slice on -1.",
  ]);
} else {
  console.log('ok   no script matches across a newline without allowing for CRLF');
}

/* ------------------------------------------------- package.json scripts --- */

/*
 * What cmd.exe cannot do. Not an exhaustive shell grammar — a list of the
 * constructs that actually appear in npm scripts and actually break, each of
 * which has a portable home in a .mjs file.
 */
const SHELLISMS = [
  [/\bfor\s+\w+\s+in\b/, 'a for loop'],
  [/;\s*do\b/, 'a do block'],
  [/\bdone\b/, 'a done'],
  [/\bif\s+\[/, 'a test conditional'],
  [/(^|\s)\w+=[^\s]+\s+\w/, 'an inline environment variable'],
  [/\$\{?\w+\}?/, 'a shell variable'],
  [/\|\s*(tail|head|grep|sed|awk)\b/, 'a unix pipe'],
  [/&&\s*echo\s+"[^"]*\\n/, 'an echo with a backslash escape'],
];

const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
const shellish = [];
for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
  for (const [re, what] of SHELLISMS) {
    if (re.test(command)) {
      shellish.push(`${name}: ${what} — ${command.slice(0, 70)}`);
      break;
    }
  }
}

if (shellish.length) {
  fail(`${shellish.length} package.json script(s) assume a unix shell`, [
    ...shellish,
    '',
    'pnpm runs these through cmd.exe on Windows, which answers',
    '"… was unexpected at this time." — a broken command, reported as though',
    'the check itself had failed. Put the logic in a .mjs file instead;',
    'run-tz.mjs is what the three timezone loops became.',
  ]);
} else {
  console.log(`ok   all ${Object.keys(pkg.scripts ?? {}).length} package scripts run on either shell`);
}

/*
 * And the repo-level guarantee those scripts rest on. One line in one file is
 * what keeps every working tree byte-identical across platforms; losing it
 * would put the failure above back on a Windows machine, where whoever removed
 * it would not see it.
 */
const attributes = (() => {
  try {
    return readFileSync(join(HERE, '..', '..', '..', '.gitattributes'), 'utf8');
  } catch {
    return null;
  }
})();

if (attributes == null) {
  fail('.gitattributes is missing', [
    'Without it Git on Windows checks this repo out with CRLF and the guard',
    'scripts start failing against code that is perfectly correct.',
  ]);
} else if (!/^\*\s+text=auto\s+eol=lf\s*$/m.test(attributes)) {
  fail('.gitattributes no longer pins LF', [
    'Expected a line reading exactly: * text=auto eol=lf',
  ]);
} else {
  console.log('ok   .gitattributes pins LF for every text file');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
