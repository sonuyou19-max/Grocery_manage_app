#!/usr/bin/env node
/**
 * Nothing may leave a screen in a way that can leave you on it.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * Create an account, type your name, tap Done — and nothing happens. In
 * development the console says why:
 *
 *     The action 'GO_BACK' was not handled by any navigator.
 *
 * In production that warning is silenced, so what ships is a dead button
 * thirty seconds into somebody's first use of the app.
 *
 * There was nothing to go back to. A first launch goes onboarding → REPLACE →
 * get-started → REPLACE → sign-in, and a replace swaps the screen rather than
 * stacking on it, so sign-in was the only entry in the history. The same
 * `back()` works perfectly when sign-in is opened from Settings — which is how
 * it was written, and how it was tested.
 *
 * ---------------------------------------------------------------------------
 * Why the rule is "nobody calls back()" rather than "check before you do"
 * ---------------------------------------------------------------------------
 *
 * The check already existed. `get-started` and `onboarding` both wrote
 * `if (router.canGoBack()) router.back(); else router.replace('/')` by hand —
 * and get-started is the file that navigates TO sign-in, with a comment
 * explaining that the replace is deliberate so that "sign-in's own back() lands
 * on the dashboard". Two files knew about the hazard and the screen they hand
 * off to did not. Nineteen files called `router.back()`; two guarded it.
 *
 * Whether a screen has anything behind it is not a property of that screen —
 * it depends on how it was reached, and every one of these can be reached both
 * ways. So the answer cannot live at the call sites, and a convention that has
 * to be remembered at thirty-seven of them is not a convention.
 *
 * Run with `pnpm --filter mobile check:navigate`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const OWNER = 'lib/navigate.ts';

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, lines = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of lines) console.log(`  ${line}`);
};
const assert = (what, cond, lines) => (cond ? ok(what) : fail(what, lines));

// Comments stripped, once. navigate.ts quotes the broken line in its own
// explanation, and lib/modal-nav does too — an assertion about the code that
// matches the prose about the code is this repo's most repeated guard bug.
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = (function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? collect(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
})(SRC);

const rel = (f) => relative(SRC, f).split('\\').join('/');

/* ------------------------------------- 1. the helper does what it claims -- */

const owner = code(readFileSync(join(SRC, OWNER), 'utf8'));

assert(
  'goBack asks whether there is anywhere to go',
  /if \(router\.canGoBack\(\)\)/.test(owner),
  ['Without the question this is `router.back()` with extra steps.'],
);
assert(
  '...and goes home when there is not',
  /router\.replace\('\/'\)/.test(owner),
  [
    'Doing nothing is the bug. The screen has finished its job and the person',
    'is standing on it with no way off.',
  ],
);
/*
 * `replace`, not `push`. Pushing the dashboard on top of a sign-up screen
 * leaves the sign-up screen in the history to be swiped back into, which is a
 * small confusion of its own — and it is one character away.
 */
assert(
  '...by replacing rather than pushing',
  !/router\.push\('\/'\)/.test(owner),
);

/* --------------------------------- 2. and it is the only one that may ----- */

const direct = files
  .filter((f) => rel(f) !== OWNER)
  .filter((f) => /router\.back\(\)/.test(code(readFileSync(f, 'utf8'))))
  .map(rel);

assert(
  `nothing outside ${OWNER} calls router.back()`,
  direct.length === 0,
  [
    ...direct.map((f) => `  ${f}`),
    '',
    'Whether a screen has history behind it depends on how it was REACHED, so',
    'the screen cannot answer it. Call goBack() from @/lib/navigate — it does',
    'the same thing whenever there is somewhere to go, and goes home instead of',
    'nothing when there is not.',
  ],
);

/*
 * ...and the hand-written form of the check is gone too. It is not wrong — it
 * is what goBack does — but a second copy is how the two drift, and it reads as
 * license to write a third.
 */
const handRolled = files
  .filter((f) => rel(f) !== OWNER)
  .filter((f) => /canGoBack\(\)/.test(code(readFileSync(f, 'utf8'))))
  .map(rel);

assert(
  '...nor rolls the check by hand',
  handRolled.length === 0,
  [...handRolled.map((f) => `  ${f}`), '', 'That is goBack(). Use it.'],
);

/* ------------------------------------ 3. the screens actually leave ------- */

/*
 * A screen that can be the first route needs SOME way off it, and the two that
 * hand off to each other during sign-up are the ones the bug was reported on.
 * Asserted by name rather than inferred, because "is this reachable first" is
 * not a question a regex can answer, and these three are the sign-up path.
 */
for (const screen of ['app/auth/sign-in.tsx', 'app/get-started.tsx', 'app/onboarding.tsx']) {
  const text = code(readFileSync(join(SRC, screen), 'utf8'));
  assert(
    `${screen} can be left`,
    /goBack\(\)/.test(text) || /router\.replace\(/.test(text),
    ['It is reachable as the FIRST route on a fresh install, with no history.'],
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
