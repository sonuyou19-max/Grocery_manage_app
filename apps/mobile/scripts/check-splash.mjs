/**
 * Rules for anyone who tries to hold the splash screen again.
 *
 * ---------------------------------------------------------------------------
 * What happened, and why this file outlived the feature it guarded
 * ---------------------------------------------------------------------------
 *
 * A gate was added to hold the native splash until the app had really loaded,
 * to stop an empty dashboard flashing for ~200ms on launch. It shipped twice
 * and broke the app both times — the logo on screen forever, then an Android
 * ANR. The second attempt added an unconditional 2.5s timeout that should have
 * made a hang impossible, and the app STILL never started, which means the
 * failure was never the readiness logic at all: something about taking
 * ownership of the native splash in this app does not release it.
 *
 * That was three rounds of a user's time on a cosmetic flash. The gate has
 * been reverted; Expo's default (hide on first frame) is back, which is the
 * behaviour every working build has shipped with.
 *
 * The feature is gone, so this file no longer asserts it exists. It asserts
 * the conditions under which it may come BACK — because the flash is a real
 * (if small) blemish and somebody will reasonably try again, and everything
 * below was learned the expensive way:
 *
 *   1. Do not call preventAutoHideAsync() without also being able to
 *      demonstrate hideAsync() works in a release build on a device. A
 *      release APK, not Expo Go, not a dev client.
 *   2. If you hold it, an unconditional timer must release it. Necessary but
 *      NOT sufficient — attempt two had exactly that and still hung.
 *   3. Never gate the release on a network-backed flag. supabase-js applies
 *      no timeout, so `useHousehold().loading` and friends can simply never
 *      settle.
 *
 * The alternative worth trying first, which needs none of this: render a
 * branded full-screen View *inside* React while the local reads are pending.
 * It cannot outlive the JS that draws it, ErrorBoundary catches its failures,
 * and no native API is involved.
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

/** Source with comments stripped, so this file's own prose cannot trip it. */
const code = (text) =>
  text == null ? null : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const layout = code(read('app/_layout.tsx'));
if (layout == null) {
  fail('app/_layout.tsx is missing', ['Nothing to check.']);
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}

const holdsSplash = /preventAutoHideAsync/.test(layout);

if (!holdsSplash) {
  console.log('ok   the splash is left to Expo (no manual hold) — see this file’s header');
} else {
  /*
   * Someone has taken ownership again. Everything below is the minimum bar,
   * and passing it is still not evidence the app launches — only a device is.
   */
  console.log('note the splash is held manually; checking the conditions for that');

  const hasTimeoutRelease = /setTimeout\(\s*(?:\(\)|async\s*\(\))\s*=>\s*\{[^}]*hideAsync/.test(
    layout,
  );
  if (!hasTimeoutRelease) {
    fail('a held splash needs an unconditional timeout release', [
      'Every readiness flag is a promise, and a promise that never settles is an',
      'app that never starts. Add a setTimeout that calls hideAsync() regardless',
      'of state — and note this was necessary but not sufficient last time.',
    ]);
  } else {
    console.log('ok   ...it is released on an unconditional timer');
  }

  /**
   * Hooks whose flag is settled by a network round trip. Waiting on any of
   * these ties launch to request latency and, with no client-side timeout in
   * supabase-js, to whether the request settles at all.
   */
  const NETWORK_BACKED = ['useHousehold', 'useEntitlement', 'usePantryIntel'];
  const readyLine = layout.match(/const ready = [^;]+;/)?.[0] ?? '';
  const offenders = readyLine ? NETWORK_BACKED.filter((h) => layout.includes(`${h}(`)) : [];
  if (offenders.length) {
    fail('a held splash must not wait on a network-backed flag', [
      ...offenders.map((h) => `${h}() resolves over the network and _layout.tsx calls it.`),
      'Wait on AsyncStorage-backed flags only.',
    ]);
  } else {
    console.log('ok   ...and does not wait on a network-backed flag');
  }
}

/* ----------------------- the React boot gate ---------------------------- */

/*
 * The replacement for the native splash gate: components/boot-gate.tsx holds a
 * loading screen INSIDE React until launch resolves. It is allowed to exist
 * where the native version was not, because it cannot outlive the JS that
 * draws it — but only as long as it keeps to the two rules below, which are
 * exactly the ones the native attempts broke.
 */
const gate = code(read('components/boot-gate.tsx'));
if (gate == null) {
  console.log('ok   no React boot gate present (nothing to check)');
} else {
  if (/expo-splash-screen/.test(gate)) {
    fail('the boot gate reaches for the native splash', [
      'This component is safe because a broken bundle makes it render NOTHING,',
      'rather than leaving a native screen only JS can dismiss. Calling',
      'preventAutoHideAsync() from here gives back the exact failure mode that',
      'broke the app twice. Expo hides the splash on the first frame and',
      'store/locale paints that frame — the handover needs no native call.',
    ]);
  } else {
    console.log('ok   the boot gate does not touch the native splash');
  }

  const capped = /useEffect\(\(\)\s*=>\s*\{\s*const\s+\w+\s*=\s*setTimeout\(/.test(gate);
  if (!capped) {
    fail('the boot gate has no unconditional timeout', [
      'Every readiness flag is a promise, and a promise that never settles is',
      'an app that never starts. Arm a setTimeout on mount — empty deps, no',
      'conditions — that reveals the app regardless of any flag.',
    ]);
  } else {
    console.log('ok   ...and is released by an unconditional timer');
  }

  /*
   * Flags that settle over the network. supabase-js applies no client timeout,
   * so any of these can fail to resolve at all — waiting on one is what hung
   * the app the first time. `restored` and `hydrated` are the AsyncStorage
   * counterparts and are the only readiness flags the gate may read.
   */
  const bad = [];

  /*
   * Destructured names, NOT "the hook is called" — the gate legitimately calls
   * useHousehold() for `restored`. Match inside the braces, because in
   * `const { restored, loading } = useHousehold()` the offending name appears
   * BEFORE the call, not after it. An earlier version of this check looked
   * after the call and therefore passed on exactly the code it exists to
   * reject.
   */
  const BANNED_HOUSEHOLD = ['loading', 'households', 'household'];
  for (const m of gate.matchAll(/const\s*\{([^}]*)\}\s*=\s*useHousehold\(\)/g)) {
    const names = m[1].split(',').map((n) => n.split(':')[0].trim());
    for (const n of names) {
      if (BANNED_HOUSEHOLD.includes(n)) bad.push(`useHousehold().${n}`);
    }
  }
  for (const hook of ['useEntitlement', 'usePantryIntel']) {
    if (new RegExp(`${hook}\\(`).test(gate)) bad.push(`${hook}()`);
  }

  if (bad.length) {
    fail('the boot gate waits on a network-backed flag', [
      ...bad.map((n) => `${n} settles over the network, and the gate reads it.`),
      'Wait on AsyncStorage-backed flags only — useHousehold().restored and',
      'useGroceries().hydrated. Note `loading` is false BOTH before the fetch',
      'starts and after it ends, so it cannot answer "has this resolved yet".',
    ]);
  } else {
    console.log('ok   ...and waits only on flags that settle on-device');
  }
}

/* ------------------- always: the session lookup must settle ------------- */

/*
 * Independent of the splash. getSession() hits the network to refresh an
 * expired token, so it can reject — and `initializing` gates the sign-in
 * screen either way. An unsettled promise there is a stuck app whether or not
 * anything is holding the splash, which is why this check stayed when the
 * rest became conditional.
 */
const auth = code(read('store/auth.tsx'));
if (!auth || !/getSession\(\)[\s\S]{0,600}?\.catch\(/.test(auth)) {
  fail('auth.tsx: getSession() needs a rejection path', [
    'It refreshes an expired token over the network, so it can reject. Treat a',
    'failure as signed-out and always clear `initializing`.',
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
