/**
 * Every server write reports its failures.
 *
 * ---------------------------------------------------------------------------
 * What this is protecting
 * ---------------------------------------------------------------------------
 *
 * Mutations in this app are optimistic: the row appears on tap, the network
 * call follows, and when the call fails the store re-reads from the server so
 * the optimistic row quietly disappears. That recovery is correct and it is
 * completely silent — the user watches the thing they just added not be there,
 * and no trace of the failure exists anywhere else.
 *
 * The unique-violation branch is the proof it matters: `recoverFrom` has always
 * had a case for SQLSTATE 23505, so the code has always known this happens, and
 * for the whole life of the project it said nothing to anyone.
 *
 * A write added later inherits that silence by default — `.then(({ error }) =>
 * { if (error) scheduleRefetch(); })` looks complete, and the omission is
 * invisible in review because there is nothing on the line to notice. So this
 * checks it structurally: find every mutating supabase call in the stores, and
 * require a reporting call within its statement.
 *
 * The `op` labels are checked too. They must be string LITERALS: Sentry groups
 * issues by message, and one interpolated op turns every write failure in the
 * app into a single unreadable issue with a thousand events.
 *
 * Run with `pnpm --filter mobile check:write-reporting`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let failures = 0;
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
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

/** Comments stripped, so this file's prose and the stores' cannot trip it. */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = walk(SRC).map((full) => ({
  rel: relative(SRC, full).split('\\').join('/'),
  src: code(readFileSync(full, 'utf8')),
}));

/** The four mutating verbs. `.select()` and `.rpc()` are reads and excluded. */
const MUTATION = /\.(insert|update|upsert|delete)\s*\(/g;

/**
 * The statement a mutation sits in: from the start of the line back to the
 * previous `;` or block brace, forward to the `;` that ends it. Crude, and
 * enough — a supabase call is always one chained expression statement.
 */
const statementAround = (src, idx) => {
  let start = idx;
  const back = () => {
    while (start > 0 && !';{}'.includes(src[start - 1])) start -= 1;
  };
  back();
  /*
   * A destructuring pattern is braces too. `const { error: listError } = await
   * supabase…` stops the walk at its own `{`, and the slice then begins at
   * `= await`, losing the very binding this needs to see. When that happens,
   * step over the brace and keep going. Looped, not a single retry, because
   * `const { data, error } = ` nests one level deeper.
   */
  let guard = 0;
  const looksTruncated = (t) => /^([\w\s:,]*\})?\s*=[^=]/.test(t);
  while (looksTruncated(src.slice(start, idx)) && start > 0 && guard < 5) {
    start -= 1; // step over the '{'
    back();
    guard += 1;
  }
  let end = idx;
  let depth = 0;
  while (end < src.length) {
    const c = src[end];
    if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') depth -= 1;
    else if (c === ';' && depth <= 0) break;
    end += 1;
  }
  return { text: src.slice(start, end + 1), end: end + 1 };
};

const REPORTER = /\b(reportWriteFailure|recoverFrom)\s*\(/;

let checked = 0;
const unreported = [];
const dynamicOps = [];

for (const f of files) {
  // Only the stores write. A screen that starts writing directly is itself a
  // problem, and this will say so by counting zero writes it knows about.
  if (!f.rel.startsWith('store/')) continue;
  MUTATION.lastIndex = 0;
  let m;
  while ((m = MUTATION.exec(f.src)) !== null) {
    const { text: stmt, end: stmtEnd } = statementAround(f.src, m.index);
    // `.delete()` also matches AsyncStorage-ish calls; require supabase nearby.
    if (!/supabase/.test(stmt)) continue;
    checked += 1;
    /*
     * Three shapes count as reported, because all three appear in the stores
     * and all three are correct:
     *
     *   a. the reporter is inside the chained statement (`.then(...)`);
     *   b. the statement destructures `{ error: name }` and that name is passed
     *      to reportWriteFailure on a following line — the `await` shape;
     *   c. the statement assigns the query to a const which is `.then`-ed with
     *      a reporter later, which is how the insert-vs-update branch works.
     *
     * Anything else is silence.
     */
    const destructured =
      stmt.match(/\{[^}]*\berror\s*:\s*(\w+)/)?.[1] ??
      (/\{[^}]*\berror\s*[,}]/.test(stmt) ? 'error' : null);
    const assigned = stmt.match(/const\s+(\w+)\s*=/)?.[1];
    /*
     * For b and c the reporter is on a later line, so the search window is the
     * source that FOLLOWS this statement rather than the whole file. `error` is
     * a common enough name that a file-wide search would let one reported write
     * vouch for every unreported one in the same file.
     */
    const after = f.src.slice(stmtEnd, stmtEnd + 600);
    const reported =
      REPORTER.test(stmt) ||
      (destructured && new RegExp(`reportWriteFailure\\([^)]*\\b${destructured}\\b`).test(after)) ||
      (assigned && new RegExp(`\\b${assigned}\\s*\\.then\\([\\s\\S]{0,400}?reportWriteFailure`).test(after));
    if (!reported) {
      unreported.push(`${f.rel}: ${stmt.trim().replace(/\s+/g, ' ').slice(0, 110)}`);
    }
    /*
     * BOTH entry points. recoverFrom takes the same op and forwards it, so
     * scanning only reportWriteFailure would leave the five busiest writes in
     * the app — every insert, toggle and update on a list — unchecked.
     */
    for (const call of stmt.matchAll(/(?:reportWriteFailure|recoverFrom)\(\s*([^,]+),/g)) {
      const arg = call[1].trim();
      /*
       * A literal, or a ternary between two literals (insert-vs-update).
       *
       * camelCase after the dot, because the codebase already writes ops that
       * way — `pantry_items.homeList` predates this and lives in a file this
       * scan does not reach, so the narrower pattern was not enforcing a
       * convention, it was enforcing one on the files it happened to see. What
       * the rule is actually for is unchanged: a CONSTANT, so Sentry has
       * something stable to group by, never an interpolation.
       */
      const literal = /^'[a-zA-Z_.]+'$/;
      const ternary = /^[\w.!?]+\s*\?\s*'[a-zA-Z_.]+'\s*:\s*'[a-zA-Z_.]+'$/;
      if (!literal.test(arg) && !ternary.test(arg)) dynamicOps.push(`${f.rel}: ${arg}`);
    }
  }
}

if (checked === 0) {
  fail('found no supabase writes to check', [
    'The scan matched nothing, which means it is broken rather than that the',
    'app stopped writing. Check MUTATION and the store/ prefix above.',
  ]);
} else if (unreported.length) {
  fail(`${unreported.length} supabase write(s) fail silently`, [
    ...unreported.map((u) => `  ${u}`),
    'Every mutation is optimistic, so a failure just makes the row disappear',
    'and tells nobody. Add reportWriteFailure(<literal op>, error) in the same',
    'statement — or route it through recoverFrom, which now does it for you.',
  ]);
} else {
  console.log(`ok   all ${checked} supabase writes report their failures`);
}

if (dynamicOps.length) {
  fail('a reportWriteFailure op is not a literal', [
    ...dynamicOps.map((d) => `  ${d}`),
    'Sentry groups by message. An interpolated op collapses every write failure',
    'in the app into one issue with thousands of events, which is the same as',
    'not reporting at all.',
  ]);
} else if (checked > 0) {
  console.log('ok   ...with a literal op, so each one groups on its own');
}

/* --------------------- the reporter itself must stay safe ---------------- */

const monitoring = files.find((f) => f.rel === 'lib/monitoring.ts');
if (!monitoring) {
  fail('lib/monitoring.ts is missing');
} else {
  const notes = [];
  if (!/export function reportWriteFailure/.test(monitoring.src)) {
    notes.push('reportWriteFailure is gone — the call sites above reference it');
  }
  /*
   * PostgREST puts the offending VALUES in `details` and `hint`:
   *   Key (list_id, item_key)=(…, milk) already exists.
   * Forwarding those ships the user's shopping list to the crash reporter,
   * which contradicts sendDefaultPii: false three lines away in the same file.
   */
  if (/\bdetails\b/.test(monitoring.src) || /\bhint\b/.test(monitoring.src)) {
    notes.push("it forwards `details` or `hint`, which carry the row's values");
  }
  if (notes.length) fail('the write reporter is unsafe or missing', notes.map((n) => `  ${n}`));
  else console.log('ok   the reporter exists and forwards no row data');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
