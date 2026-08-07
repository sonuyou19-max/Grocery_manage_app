/**
 * Android real-time blur is banned, and this is what stops it coming back.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists because of
 * ---------------------------------------------------------------------------
 *
 * The app flickered. Every animation, every transition, every screen — springs
 * that started and stalled, a cold start that took five seconds. It read as a
 * race condition, and it was not one. It was a budget problem.
 *
 * expo-blur on Android (`experimentalBlurMethod="dimezisBlurView"`) is not a
 * GPU effect. From ExpoBlurView.kt, on attach:
 *
 *     blurView.setupWith(<nearest rnscreens Screen>, RenderEffectBlur())
 *
 * That installs a `ViewTreeObserver.OnPreDrawListener` on the entire screen.
 * On every pre-draw pass, every such view redraws the whole screen hierarchy
 * into an offscreen bitmap, blurs it, and paints it — on the UI thread.
 *
 * We had one per <Card>. The Insights tab renders twenty-one cards, plus the
 * mesh background and the floating tab bar: twenty-three full-screen
 * snapshot-and-blur passes per frame. And the mesh's blobs animated on an
 * infinite `withRepeat`, so pre-draw fired continuously — the UI thread was
 * saturated even with nothing happening. Nothing else in the app could get a
 * frame in edgeways.
 *
 * Fix: components/frosted.tsx renders a translucent View on Android and keeps
 * the real (free, native) blur only on iOS; mesh-background.tsx draws its
 * colour fields as static SVG radial gradients so there is nothing left to
 * blur and nothing left to animate.
 *
 * ---------------------------------------------------------------------------
 * The one legitimate exception
 * ---------------------------------------------------------------------------
 *
 * components/teaser.tsx blurs invented sample figures so a signed-out user
 * cannot read them as their own data. There the blur is the feature, not the
 * finish, and a translucent wash would not do the job. It is one view, on a
 * screen with nothing animating, so it is affordable — and it is the only
 * place that is.
 *
 * Run with `pnpm --filter mobile check:blur`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** The single file allowed to hold a real blur, and why (see header). */
const BLUR_EXEMPT = 'components/teaser.tsx';
/** The wrapper that owns the platform decision. */
const OWNER = 'components/frosted.tsx';

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};

/** Source with comments stripped, so this file's own prose — and the long
 *  explanations in frosted.tsx and mesh-background.tsx — cannot trip it. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

const files = walk(SRC).map((full) => ({
  rel: relative(SRC, full).split('\\').join('/'),
  src: code(readFileSync(full, 'utf8')),
}));

/* ---------------- 1. nobody turns the Android blur back on ---------------- */

const dimezis = files.filter((f) => f.rel !== BLUR_EXEMPT && /dimezisBlurView/.test(f.src));
if (dimezis.length) {
  fail('experimentalBlurMethod="dimezisBlurView" is back', [
    ...dimezis.map((f) => `  ${f.rel}`),
    'Each one of these re-blurs the WHOLE SCREEN into a bitmap on every',
    'pre-draw pass, on the UI thread. That is the app-wide flicker. Use',
    `<Frosted> from ${OWNER} instead — it keeps the real blur on iOS.`,
  ]);
} else {
  console.log(`ok   no Android real-time blur outside ${BLUR_EXEMPT}`);
}

/* ---------------- 2. BlurView is reachable from two files only ------------ */

const importers = files.filter(
  (f) => f.rel !== OWNER && f.rel !== BLUR_EXEMPT && /from 'expo-blur'/.test(f.src),
);
if (importers.length) {
  fail('expo-blur is imported outside the two files allowed to', [
    ...importers.map((f) => `  ${f.rel}`),
    `Frosted (${OWNER}) owns the platform decision so there is exactly one`,
    'place to make it. Importing BlurView directly routes around that, and on',
    'Android an unset experimentalBlurMethod silently renders no blur at all —',
    'so the bug it reintroduces is either jank or a missing effect, never a',
    'loud failure.',
  ]);
} else {
  console.log('ok   expo-blur is imported only by Frosted and the teaser');
}

/* ---------------- 3. the always-on background stays free ------------------ */

const mesh = files.find((f) => f.rel === 'components/mesh-background.tsx');
if (!mesh) {
  fail('components/mesh-background.tsx is missing', ['Nothing to check.']);
} else if (/withRepeat/.test(mesh.src)) {
  fail('the mesh background animates forever again', [
    'MeshBackground is on every screen. An infinite animation there means the',
    'UI thread never sees an idle frame for as long as the app is open, and',
    'every transition in the app has to fight it for time. The drift it used',
    'to run took 16–23 seconds to cross the screen — nobody could see it, and',
    'it cost the whole app its smoothness.',
  ]);
} else {
  console.log('ok   the mesh background does no per-frame work');
}

/* ---------------- 4. the first frame is never empty ---------------------- */

/*
 * Expo hides the native splash on the app's first frame. If the provider that
 * gates the tree renders nothing on that frame, the user gets logo → blank →
 * app, which reads as a stall. Paint the splash colour instead.
 */
const locale = files.find((f) => f.rel === 'store/locale.tsx');
if (!locale) {
  fail('store/locale.tsx is missing', ['Nothing to check.']);
} else if (/if\s*\(!ready\)\s*return null/.test(locale.src)) {
  fail('LocaleProvider renders nothing on the first frame', [
    'The splash does not cover this — it is hidden on the first frame, and',
    'with `return null` that frame is an empty tree. Render a full-screen View',
    'in the splash background colour instead.',
  ]);
} else {
  console.log('ok   the first frame paints the splash colour, not nothing');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
