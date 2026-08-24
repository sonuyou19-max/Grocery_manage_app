#!/usr/bin/env node
/**
 * Signing in as somebody else on a device that has already been used.
 *
 * ---------------------------------------------------------------------------
 * What went wrong, and why nothing noticed
 * ---------------------------------------------------------------------------
 *
 * The selected household id was restored from storage into React state once, at
 * mount, and after that only ever set. Sign-out removed the storage key but the
 * provider does not remount, so the STATE survived into the next person's
 * session — and a brand-new account has no households of its own to correct it
 * with.
 *
 * Everything downstream then worked exactly as written. GroceriesProvider
 * prefers the stored id on purpose, so the app mounts the cloud backend on the
 * first render instead of mounting the whole tree twice; that preference is
 * safe as long as a wrong id gets corrected, which it does — unless the new
 * user has no household at all. So the second user got the cloud backend
 * pointed at the FIRST user's household. Every read came back empty through
 * RLS, every write was refused, and creating a list showed the row optimistically
 * and then lost it: "This list no longer exists".
 *
 * Three separate symptoms, one cause. The name was never asked because swapping
 * the provider component unmounted the navigator mid-sign-up; the default
 * household was never created because the step that creates it never ran; and
 * the list failed because the insert named a household the user is not in.
 *
 * Nothing in the suite could have caught it, which is the point of this file.
 * The decision is now a pure function and the seven cases below are the whole
 * of it — including the one that was wrong, where the id resolves to nothing
 * and there is nothing to fall back to.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

let failures = 0;
function check(what, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}

/* ------------------------------------------------------- the decision itself */

// Lifted rather than imported: household.tsx is a provider full of React, and
// this function is deliberately free of it.
const householdSrc = readFileSync(join(SRC, 'store', 'household.tsx'), 'utf8');
const fn = householdSrc.match(/export function resolveActiveId\([\s\S]*?\n\}/);
if (!fn) {
  console.error('could not find resolveActiveId in store/household.tsx — has it moved?');
  process.exit(1);
}
const { outputText } = ts.transpileModule(fn[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { resolveActiveId } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
);

const H = (...ids) => ids.map((id) => ({ id }));

/* --- before the fetch has answered, the stored id is all we know ---------- */

/*
 * This half is the optimisation, not a nicety. Acting on an empty `households`
 * before the fetch lands would discard the stored id on every cold start, mount
 * the whole app under the local backend, and then swap it — which is the
 * full-tree remount half a second into launch that GroceriesProvider's comment
 * exists to describe.
 */
check('unsettled: a stored id is kept', resolveActiveId('h1', [], false), 'h1');
check('unsettled: kept even against a different list', resolveActiveId('h1', H('h2'), false), 'h1');
check('unsettled: nothing stored stays nothing', resolveActiveId(null, [], false), null);

/* --- once it has answered, the id is either real or it is not ------------- */

check('settled: a valid id survives', resolveActiveId('h1', H('h1', 'h2'), true), 'h1');
check('settled: an id from another user falls back', resolveActiveId('h1', H('h2'), true), 'h2');

/*
 * THE BUG. A brand-new account has no households, so there is nothing to fall
 * back to — and the old code, which only ever wrote a fallback when one
 * existed, left the previous user's id in place. Everything after this point
 * was the app faithfully using it.
 */
check(
  'settled: a stale id with NO households becomes null',
  resolveActiveId('h1', [], true),
  null,
);

check('settled: nothing stored picks the first', resolveActiveId(null, H('h2', 'h3'), true), 'h2');
check('settled: nothing stored and nothing to pick', resolveActiveId(null, [], true), null);

/* ----------------------------------------------- the wiring around it holds */

/*
 * Three things have to stay true for the function above to be reached at all,
 * and each of them is a line somebody could reasonably "tidy".
 */

// 1. The storage key must still be wiped on sign-out. The in-memory fix makes
//    this belt-and-braces, but leaving the key would hand the next person on a
//    shared device a pointer into someone else's household on the next launch.
const localData = readFileSync(join(SRC, 'lib', 'local-data.ts'), 'utf8');
check(
  'sign-out still clears the selected household from storage',
  /korb\.activeHousehold\.v1/.test(localData),
  true,
);

// 2. The correction must not be gated on a household existing again. That gate
//    is precisely what made the empty case unreachable.
/*
 * The anchor is matched with `\r?\n`, and a miss FAILS rather than slicing.
 *
 * Both halves were bugs, and the second is the dangerous one. A literal '\n'
 * inside the anchor does not appear in a file checked out with CRLF, so this
 * returned -1 on Windows; `slice(-1)` then handed back the file's last
 * character and `body` came out empty. Two of the three assertions below went
 * red — and the third, which asserts something is ABSENT, passed against the
 * empty string. A guard that reports success for a check it never performed is
 * worse than one that is simply wrong.
 *
 * The repo now pins LF via .gitattributes, so the CRLF half should not recur.
 * The tolerant match stays anyway: a working tree that predates that file is
 * still out there, and this is one regex.
 */
const anchor = /^ {2}useEffect\(\(\) => \{\r?\n {4}if \(!restoredRef\.current\) return;/m;
const at = householdSrc.search(anchor);
const end = at < 0 ? -1 : householdSrc.indexOf('  }, [', at);
if (at < 0 || end < 0) {
  check(
    'the household-correction effect is still findable',
    `${at < 0 ? 'start' : 'end'} anchor missing`,
    'both anchors present',
  );
}
const body = at < 0 || end < 0 ? '' : householdSrc.slice(at, end);
check('the correction runs through resolveActiveId', /resolveActiveId\(/.test(body), true);
check(
  'and is not short-circuited on there being a household',
  // `body &&` so this cannot be satisfied by an empty slice. Asserting the
  // ABSENCE of something is vacuously true of nothing, which is exactly how
  // this assertion passed while examining no code at all.
  body ? /!household\b/.test(body) : 'no body to check',
  false,
);
check(
  'a cleared selection removes the key rather than leaving it',
  /removeItem\(ACTIVE_KEY\)/.test(body),
  true,
);

// 3. GroceriesProvider must still prefer the stored id — if it stopped, these
//    tests would keep passing while protecting nothing, because the value they
//    describe would no longer be the one that picks the backend.
const groceries = readFileSync(join(SRC, 'store', 'groceries.tsx'), 'utf8');
check(
  'GroceriesProvider still chooses its backend from the selected id',
  /const householdId = activeId \?\? household\?\.id \?\? null;/.test(groceries),
  true,
);

/* ------------------------- signed in with no household is reported --------- */

/*
 * The residual the fix above does not cover. createHousehold at sign-up is
 * deliberately non-fatal — being signed in with no household beats being unable
 * to finish signing in — so a network blip at that moment still lands a user in
 * a session where the app looks signed in and syncs nothing. HouseholdNudge is
 * the only thing anywhere that says so.
 *
 * Two ways it could silently stop working, and neither would fail anything
 * else: it could be gated on the wrong condition and never appear, or it could
 * be gated on the naive one and appear for everybody, briefly, on every launch.
 */
const nudge = readFileSync(join(SRC, 'components', 'household-nudge.tsx'), 'utf8');

check(
  'the nudge asks the store, not the raw roster length',
  /needsHousehold/.test(nudge) && !/households\.length/.test(nudge),
  true,
);

// The derivation itself. `settledFor === user.id` is the whole guard: without
// it the banner renders on every cold start before the fetch answers, telling
// people with a household that their shopping is not backed up.
const derivation = householdSrc.match(/const needsHousehold = [^;]*;/);
check('needsHousehold is gated on the fetch having settled', /settledFor === user\.id/.test(derivation?.[0] ?? ''), true);
check('...and on the roster actually being empty', /households\.length === 0/.test(derivation?.[0] ?? ''), true);
check('...and on there being a signed-in user at all', /user != null/.test(derivation?.[0] ?? ''), true);

/*
 * And that the tap finishes the job rather than handing the user a form. That
 * screen asks them to name a household, which is the jargon sign-up exists to
 * avoid — and worse here, because it arrives as the price of fixing a problem
 * the app caused. The form stays only as the branch for when the name is gone
 * too.
 */
check(
  'tapping it creates the same default household sign-up would',
  /createHousehold\(t\('household\.defaultName'/.test(nudge),
  true,
);
check(
  'the form is the fallback, not the first answer',
  nudge.indexOf("router.push('/auth/household')") > nudge.indexOf('const name = myName'),
  true,
);
check(
  'a failed retry keeps the card rather than hiding the problem',
  /setError\(result\.error\);\s*\n\s*return;/.test(nudge),
  true,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
