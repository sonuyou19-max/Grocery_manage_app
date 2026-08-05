/**
 * The splash screen must always come down.
 *
 * ---------------------------------------------------------------------------
 * What happened
 * ---------------------------------------------------------------------------
 *
 * A gate was added to hold the splash until the app had really loaded, to stop
 * an empty dashboard flashing for ~200ms on launch. It waited on four flags,
 * one of which — `useHousehold().loading` — wraps two Supabase `select`s.
 * supabase-js applies no timeout of its own. One stalled request and
 * `setLoading(false)` never ran, so the splash never lifted, so the app never
 * started: the logo, forever, then an Android ANR.
 *
 * The gate's own doc comment said it waited on "the local read, not the
 * network fetch behind it". It was describing the design; the code on the next
 * line did the opposite. Prose cannot be trusted to hold an invariant, which
 * is the entire premise of this directory.
 *
 * ---------------------------------------------------------------------------
 * What is actually asserted
 * ---------------------------------------------------------------------------
 *
 *   1. Something calls preventAutoHideAsync — or the gate is decorative,
 *      because Expo hides the splash on first frame by default.
 *   2. An unconditional timeout exists that hides it regardless of state.
 *      This is what makes the worst case "a brief flash" instead of "a dead
 *      app", and it is the only assertion here that has to hold no matter how
 *      the readiness logic is rewritten later.
 *   3. The readiness expression names no network-backed flag. Kept as a
 *      denylist of the specific hooks known to wrap a fetch, because a general
 *      "is this local?" test is not something a regex can answer — and the
 *      failure being prevented is precise enough to name.
 *
 * Run with `pnpm --filter mobile check:splash`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};

const read = (rel) => {
  try {
    return readFileSync(join(SRC, rel), 'utf8');
  } catch {
    return null;
  }
};

/** Source with comments stripped — see the header for why that matters here. */
const code = (text) =>
  text == null ? null : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const layout = read('app/_layout.tsx');
if (!layout) {
  fail('app/_layout.tsx is missing', ['Nothing else to check.']);
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
const layoutCode = code(layout);

/* ------------------------------- 1. the splash is actually held */

if (!/preventAutoHideAsync/.test(layoutCode)) {
  fail('nothing prevents the splash from auto-hiding', [
    'Expo hides it on the first committed frame, which is before any hydration',
    'has answered — the gate below would then be decorative.',
  ]);
} else {
  console.log('ok   the splash is held past the first frame');
}

/* ------------------------------- 2. and it always comes back down */

/*
 * A hideAsync inside a setTimeout, with no condition wrapped around the
 * timer's own creation. Matched loosely — what matters is that a timer exists
 * whose body hides the splash, not how it is spelled.
 */
const hasTimeoutRelease = /setTimeout\(\s*\(\)\s*=>\s*\{[^}]*hideAsync/.test(layoutCode);
if (!hasTimeoutRelease) {
  fail('the splash has no unconditional timeout', [
    'Every flag the gate waits on is a promise, and a promise that never',
    'settles is an app that never starts — that shipped once already.',
    'Keep a setTimeout that calls SplashScreen.hideAsync() regardless of state.',
  ]);
} else {
  console.log('ok   the splash comes down on a timer no matter what');
}

/* --------------------- 3. readiness waits on local reads only */

/**
 * Hooks whose "loading"/"loaded" flag is settled by a NETWORK round trip.
 * Waiting on any of these ties app launch to request latency, and — with no
 * client-side timeout in supabase-js — to whether the request settles at all.
 */
const NETWORK_BACKED = ['useHousehold', 'useEntitlement', 'usePantryIntel'];

const readyLine = layoutCode.match(/const ready = [^;]+;/)?.[0] ?? '';
if (!readyLine) {
  fail('could not find the readiness expression', [
    'Expected a `const ready = ...;` inside the splash gate. If it was renamed,',
    'rename it here too rather than deleting this check.',
  ]);
} else {
  const gateBody = layoutCode.slice(
    Math.max(0, layoutCode.indexOf('function AppReadyGate')),
    layoutCode.indexOf(readyLine) + readyLine.length,
  );
  const offenders = NETWORK_BACKED.filter((hook) => gateBody.includes(hook));
  if (offenders.length) {
    fail('the splash gate must not wait on a network-backed flag', [
      ...offenders.map((h) => `${h}() resolves over the network; the splash gate reads it.`),
      'supabase-js has no default timeout, so a stalled request becomes a launch',
      'that never completes. Wait on AsyncStorage-backed flags only.',
    ]);
  } else {
    console.log('ok   readiness waits on local reads only');
  }
}

/* ------------------- 4. the session lookup cannot hang the gate */

/*
 * `auth.initializing` IS one of the flags the gate waits on, and getSession()
 * can reject — it refreshes an expired token over the network. Without a
 * settled path on both outcomes it is another way to never finish launching.
 */
const auth = code(read('store/auth.tsx'));
if (!auth || !/getSession\(\)[\s\S]{0,600}?\.catch\(/.test(auth)) {
  fail('auth.tsx: getSession() needs a rejection path', [
    'It hits the network to refresh an expired token, so it can reject. The',
    'splash gate waits on `initializing`; an unsettled promise there is a dead',
    'launch. Treat a failure as signed-out and always clear the flag.',
  ]);
} else if (!/getSession\(\)[\s\S]{0,900}?setInitializing\(false\)/.test(auth)) {
  fail('auth.tsx: initializing must be cleared on every path', [
    'Found a .catch() but no setInitializing(false) reachable from it.',
  ]);
} else {
  console.log('ok   getSession() settles initializing on success and failure');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
