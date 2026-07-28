/**
 * AI spend-cap arithmetic check.
 *
 * This is the code that decides whether a bill can run away, and every one of
 * its failure modes is silent — a cap that is too high, an off-by-one that
 * refuses the last legitimate call of the day, or a NaN from a typo'd
 * environment variable all look exactly like normal operation until someone
 * reads an invoice. None of it has a UI, so this is the only place it gets
 * exercised.
 *
 * Four things it pins:
 *
 *  1. **Integer money.** Everything is micro-USD in whole numbers. A single
 *     float in this path drifts, silently, in whichever direction the error
 *     accumulates.
 *
 *  2. **The reservation is never smaller than the real cost.** The whole
 *     concurrency argument rests on that: reserve the worst case, refund the
 *     difference. Under-reserving would let a burst through the check before
 *     any of it settled.
 *
 *  3. **Global before caller.** When the platform ceiling trips, a caller who
 *     has barely used the app must be told that, not sent chasing a personal
 *     limit they never hit.
 *
 *  4. **A bad env var falls back rather than becoming NaN.** `NaN > cap` is
 *     false, so a typo'd override would wave every request through — the exact
 *     opposite of what the variable was set to do.
 *
 * Run with `pnpm --filter mobile check:ai-cost`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'ai-cost.ts');

const { outputText } = ts.transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${String(expected)}\n  actual   ${String(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
  return ok;
};
const checkTrue = (name, actual) => check(name, actual, true);

/* ------------------------------------------------------------ integer money */

check('1000 input tokens costs 1000 micros', mod.costMicros(1000, 0), 1000);
check('1000 output tokens costs 5000 micros', mod.costMicros(0, 1000), 5000);
check('mixed adds up', mod.costMicros(1500, 300), 1500 + 1500);
check('zero is zero', mod.costMicros(0, 0), 0);
// Every path must yield a whole number — one float here and the ledger drifts.
for (const [i, o] of [[1, 1], [7, 3], [1234, 567], [999999, 1]]) {
  checkTrue(`cost(${i},${o}) is an integer`, Number.isInteger(mod.costMicros(i, o)));
}
// Garbage from a malformed API response must not poison the ledger.
check('negative input is treated as zero', mod.costMicros(-500, 0), 0);
check('NaN is treated as zero', mod.costMicros(NaN, NaN), 0);
check('undefined is treated as zero', mod.costMicros(undefined, undefined), 0);
check('fractional tokens round', mod.costMicros(10.4, 0), 10);

/* -------------------------------------------- the reservation bounds reality */

// The core safety property. If this ever fails, the concurrency argument in
// migration 0022 stops holding and a burst can outrun the cap.
const PROMPTS = ['', 'milk', 'x'.repeat(1000), 'x'.repeat(8192), 'ü'.repeat(400)];
for (const p of PROMPTS) {
  for (const maxTokens of [140, 220, 1024]) {
    const reserved = mod.worstCaseMicros(p, maxTokens);
    // Real usage can never exceed the estimate's input assumption by much, but
    // output is hard-capped by the API at maxTokens — so the reservation must
    // cover at least the full output ceiling.
    const outputCeiling = mod.costMicros(0, maxTokens);
    checkTrue(
      `reservation(${p.length} chars, ${maxTokens}) covers the output ceiling`,
      reserved >= outputCeiling,
    );
  }
}
checkTrue('an empty prompt still reserves something', mod.worstCaseMicros('', 140) > 0);
checkTrue(
  'a longer prompt reserves more',
  mod.worstCaseMicros('x'.repeat(4000), 140) > mod.worstCaseMicros('x'.repeat(40), 140),
);

// Concretely: quick-add-parse is by far the most expensive reservation, which
// is the fact that made "120 quick-adds ≈ 400 categorizes" wrong.
const quickAdd = mod.worstCaseMicros('x'.repeat(1000), 1024);
const categorize = mod.worstCaseMicros('milk', 140);
checkTrue('quick-add reserves far more than categorize', quickAdd > categorize * 5);

/* ------------------------------------------------------------- the verdict */

const caps = { callerMicros: 250_000, globalMicros: 25_000_000, fnCalls: 400 };
const under = { callerMicros: 100, globalMicros: 100, fnCalls: 1 };

check('a fresh caller is allowed', mod.verdict(under, caps).allowed, true);

// Boundary. The totals already include this call's reservation, so landing
// EXACTLY on the cap means the allowance was spent, not exceeded. Getting this
// backwards refuses the last legitimate call of every single day.
check(
  'exactly at the caller cap is still allowed',
  mod.verdict({ ...under, callerMicros: caps.callerMicros }, caps).allowed,
  true,
);
check(
  'one micro over the caller cap is refused',
  mod.verdict({ ...under, callerMicros: caps.callerMicros + 1 }, caps).reason,
  'caller_budget',
);
check(
  'exactly at the global cap is still allowed',
  mod.verdict({ ...under, globalMicros: caps.globalMicros }, caps).allowed,
  true,
);
check(
  'one micro over the global cap is refused',
  mod.verdict({ ...under, globalMicros: caps.globalMicros + 1 }, caps).reason,
  'global_budget',
);
check(
  'over the call cap is refused',
  mod.verdict({ ...under, fnCalls: caps.fnCalls + 1 }, caps).reason,
  'caller_calls',
);

// Precedence: when the platform is over budget, that is the true reason, even
// for a caller who is also over their own. Reporting the personal limit would
// send someone chasing the wrong problem.
check(
  'global trips before caller',
  mod.verdict(
    { callerMicros: caps.callerMicros + 1, globalMicros: caps.globalMicros + 1, fnCalls: 1 },
    caps,
  ).reason,
  'global_budget',
);
check(
  'global trips before the call cap',
  mod.verdict(
    { callerMicros: 0, globalMicros: caps.globalMicros + 1, fnCalls: caps.fnCalls + 1 },
    caps,
  ).reason,
  'global_budget',
);

/* --------------------------------------------------------- env var handling */

const env = (map) => (key) => map[key];

const defaults = mod.capsFromEnv('categorize', env({}));
check('default caller cap', defaults.callerMicros, 250_000);
check('default global cap', defaults.globalMicros, 25_000_000);
check('default call cap comes from the per-function table', defaults.fnCalls, 400);
check(
  'an unknown function still gets a call cap',
  mod.capsFromEnv('not-a-function', env({})).fnCalls,
  100,
);

const overridden = mod.capsFromEnv(
  'categorize',
  env({ AI_DAILY_CAP_MICROS_CALLER: '500', AI_DAILY_CAP_MICROS_GLOBAL: '9000' }),
);
check('caller override applies', overridden.callerMicros, 500);
check('global override applies', overridden.globalMicros, 9000);

// The dangerous cases. `NaN > cap` is false, so a cap that became NaN would
// wave through every request — the precise opposite of setting the variable.
for (const bad of ['', 'lots', 'NaN', '-1', '0', 'null', '1e', 'abc123']) {
  const got = mod.capsFromEnv('categorize', env({ AI_DAILY_CAP_MICROS_GLOBAL: bad }));
  checkTrue(
    `a global cap of "${bad}" falls back to the default`,
    got.globalMicros === 25_000_000,
  );
}
check(
  'a fractional override is floored, not left fractional',
  mod.capsFromEnv('categorize', env({ AI_DAILY_CAP_MICROS_CALLER: '10.9' })).callerMicros,
  10,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
