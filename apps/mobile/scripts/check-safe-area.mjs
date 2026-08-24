/**
 * Insets that survive a modal.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * `SafeAreaView` from react-native-safe-area-context is a NATIVE view. It reads
 * its own `safeAreaInsets` from UIKit and applies the padding itself, without
 * consulting any React context. On an ordinary screen that works. On a screen
 * presented as `modal` or `fullScreenModal` — which react-native-screens hands
 * to UIKit as a separate presentation — it came back with a top inset of ZERO.
 *
 * Seven screens drew their headers underneath the status bar because of it. The
 * receipt camera printed its instructions across the clock and the Dynamic
 * Island; the reporter's words were "this is happening with a few other pages
 * as well, specifically in iPhone", which is exactly the shape of the fault:
 * modals only, iOS only, and invisible on every Android device and simulator
 * the code was written against.
 *
 * ---------------------------------------------------------------------------
 * Two halves, and both are needed
 * ---------------------------------------------------------------------------
 *
 * 1. `components/safe.tsx` reads `useSafeAreaInsets()` — the JS half of the
 *    same library — and applies the padding itself. Nothing may import the
 *    native `SafeAreaView` again.
 *
 * 2. That hook reads a context, and the context has to exist and be right from
 *    the first frame. The app had NO SafeAreaProvider at all; it worked because
 *    @react-navigation/native-stack quietly wraps navigators in one. The root
 *    now has an explicit provider seeded with `initialWindowMetrics` — the
 *    WINDOW's insets, which no presentation style can change.
 *
 * Drop either half and the bug comes back, on a device the author is unlikely
 * to be holding.
 *
 * Run with `pnpm --filter mobile check:safe-area`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const OWNER = ['components', 'safe.tsx'].join(sep);

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, lines = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const l of lines) console.log(`  ${l}`);
};

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry)) files.push({ rel: relative(SRC, full), text: readFileSync(full, 'utf8') });
  }
})(SRC);

/* ------------------------------------------------ 1. nobody imports it again */

const offenders = files.filter(
  (f) =>
    f.rel !== OWNER &&
    /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*['"]react-native-safe-area-context['"]/.test(f.text),
);

if (offenders.length) {
  fail(`${offenders.length} file(s) import the native SafeAreaView`, [
    ...offenders.map((o) => `  ${o.rel}`),
    '',
    'It reports a zero top inset inside a modal on iOS, so the screen draws',
    'under the status bar. Use <Safe> from @/components/safe instead — same',
    'props, same additive behaviour, insets read from JS.',
  ]);
} else {
  ok(`no file imports the native SafeAreaView (${files.length} scanned)`);
}

/* ------------------------------------------ 2. <Safe> does the additive part */

const safe = files.find((f) => f.rel === OWNER);
if (!safe) {
  fail('components/safe.tsx is missing', ['Every screen in the app imports it.']);
} else {
  /*
   * Comments stripped first. The version of this that shipped for five minutes
   * tested the raw file for `useSafeAreaInsets()` — which is written four times
   * in that file's own doc comment explaining why it is used, so the assertion
   * passed against a component that had stopped calling it. An assertion that
   * matches the prose describing the code is not an assertion about the code.
   */
  const code = safe.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  if (/const insets = useSafeAreaInsets\(\);/.test(code)) {
    ok('...and <Safe> reads its insets from the JS context');
  } else {
    fail('<Safe> no longer reads useSafeAreaInsets()', [
      'Reading them from anywhere else puts the modal bug straight back.',
    ]);
  }

  if (/ownPadding\(flat, edge\) \+ insets\[edge\]/.test(code)) {
    ok('...and ADDS the inset to the padding the style already asks for');
  } else {
    fail('<Safe> no longer adds the inset to the existing padding', [
      "SafeAreaView's default is `additive`, and screens are written against it.",
      'Replacing the style\'s own padding instead would press every header',
      'flat against the notch — a subtler version of the bug this replaced.',
    ]);
  }
}

/* --------------------------------------------- 3. the provider, at the root */

const layout = files.find((f) => f.rel === ['app', '_layout.tsx'].join(sep));
if (!layout) {
  fail('app/_layout.tsx is missing');
} else if (!/<SafeAreaProvider\b/.test(layout.text)) {
  fail('the root SafeAreaProvider is gone', [
    'useSafeAreaInsets() throws without one. The app appeared to work with no',
    'provider only because @react-navigation/native-stack wraps navigators in',
    'its own — which is scoped to the navigator, and is the arrangement a',
    'natively presented modal sits outside of.',
  ]);
} else if (!/initialMetrics=\{initialWindowMetrics\}/.test(layout.text)) {
  fail('the root provider no longer seeds initialWindowMetrics', [
    'Without it the context starts empty and fills in a frame later, so a',
    'screen can lay out once with no insets. The window metrics are captured',
    'at launch and no presentation style can change them.',
  ]);
} else {
  ok('the root provider is present and seeded from the window metrics');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
