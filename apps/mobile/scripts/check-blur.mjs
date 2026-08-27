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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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

/* ---------------- 3. overlays are opaque, not translucent ---------------- */

/*
 * The Android build without a real blur shipped every frosted surface at the
 * same 90% fill. On a card that is right — the mesh behind it has nothing
 * legible in it. On a sheet or a menu it was not: list rows, icons and buttons
 * read straight through, and the result looked, in the user's words, "very
 * bad". A blur used to hide that no matter what the alpha was.
 *
 * So `over="content"` selects an opaque fill, and anything inside a <Modal> is
 * over content by definition. That file-level rule is coarse — a file could
 * legitimately hold both a modal and a card over the mesh — but it holds across
 * the whole app today, and the one file that broke it was a genuine miss: the
 * loyalty card held up to a scanner at the till, where a translucent surface
 * puts the wallet list through the barcode.
 *
 * It does NOT catch overlays that are not modals (the tab bar, the toast, the
 * add bar). Those are marked by hand; nothing here can infer them.
 */
/*
 * Built fresh per use, NOT hoisted to a module const.
 *
 * A /g regex carries `lastIndex` between calls, so reusing one object for both
 * `.test()` in a filter and `.matchAll()` later makes each test resume where
 * the previous one stopped — and files get silently skipped. The first draft of
 * this check did exactly that and reported 7 files where 11 qualify, which is
 * the failure mode a guard can least afford: quietly checking less than it says.
 */
const surfaceTags = (src) => [...src.matchAll(/<(GlassView|Frosted)\b([^>]*)>/g)];

const modalFiles = files.filter(
  (f) => f.rel !== OWNER && /<Modal\b/.test(f.src) && surfaceTags(f.src).length > 0,
);

const bare = [];
for (const f of modalFiles) {
  for (const m of surfaceTags(f.src)) {
    if (!/over=\{?["']content["']\}?/.test(m[2])) bare.push(`${f.rel}: <${m[1]} …>`);
  }
}

if (bare.length) {
  fail('a surface inside a <Modal> is translucent', [
    ...bare.map((b) => `  ${b}`),
    'Anything in a Modal sits on app content, so on Android the rows and',
    'buttons underneath show through a 90% fill. Pass over="content" for an',
    'opaque one. If this really is a card over the mesh that happens to share',
    'a file with a modal, move it to its own file rather than weakening this.',
  ]);
} else {
  console.log(`ok   all surfaces inside a <Modal> are over="content" (${modalFiles.length} files)`);
}

/* ---------------- 4. the always-on background stays free ------------------ */

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

/* ---------------- 5. ...and is still dithered ---------------------------- */

/*
 * Removing the blur removed the only thing masking 8-bit quantisation, and dark
 * mode reported back as concentric rings. Two things fix it and both are easy
 * to lose to a tidy-up, because neither looks load-bearing:
 *
 *   - the noise tile, which is one <Image> that appears to do nothing;
 *   - the gaussian falloff, which replaced a three-stop ramp whose middle stop
 *     was a slope discontinuity — one ring per blob, drawn deliberately.
 *
 * Both are checked structurally rather than by name, so renaming the constant
 * is fine and deleting the mechanism is not.
 */
if (mesh) {
  const meshFails = [];
  if (!/MESH_DITHER_URI/.test(mesh.src)) {
    meshFails.push('the noise tile is gone (lib/mesh-dither)');
  } else if (!/resizeMode=["']repeat["']/.test(mesh.src)) {
    meshFails.push('the noise tile no longer repeats — scaled up it is blobs, not dither');
  }
  /*
   * The tile must stay a data: URI, and this is the check that matters most,
   * because reverting it looks like a tidy-up. A required .png is scale 1, so
   * RN files it into res/drawable-mdpi and Android density-scales it ~2.75x
   * with bilinear filtering before the view ever sees it. Bilinear-upscaling
   * one-pixel noise is precisely the operation that destroys it: measured on
   * this app's own ramp, the widest flat band is 14px with no dither and STILL
   * 14px with the upscaled dither, against 7px at 1:1. It renders, it costs
   * bundle size, and it does nothing — which is the hardest kind of broken to
   * notice, since it looks identical to not having shipped the fix.
   */
  if (/require\([^)]*mesh-dither/.test(mesh.src)) {
    meshFails.push('the tile is a bundled asset again — drawable-mdpi upscaling voids it');
  }
  if (!existsSync(join(SRC, 'lib', 'mesh-dither.ts'))) {
    meshFails.push('src/lib/mesh-dither.ts is missing (pnpm gen:mesh-dither)');
  } else {
    const tile = readFileSync(join(SRC, 'lib', 'mesh-dither.ts'), 'utf8');
    const b64 = tile.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1];
    if (!b64) {
      meshFails.push('lib/mesh-dither no longer holds an inline data: URI');
    } else {
      meshFails.push(...ditherAmplitudeFaults(b64));
    }
  }
  // A hand-written stop list is the shape of the bug: a gaussian is generated.
  const stops = (mesh.src.match(/<Stop\b/g) ?? []).length;
  if (stops !== 1 || !/Math\.exp\(/.test(mesh.src)) {
    meshFails.push('the blob falloff is no longer a generated smooth curve');
  }
  if (meshFails.length) {
    fail('the mesh background will band again', [
      ...meshFails.map((m) => `  ${m}`),
      'See the header of components/mesh-background.tsx and',
      'scripts/gen-mesh-dither.mjs. Both remedies are needed: one fixes a ring',
      'this code drew itself, the other fixes the ones the display draws.',
    ]);
  } else {
    console.log('ok   ...and is still dithered, with a generated falloff');
  }
}

/**
 * Decode the tile and MEASURE what it does, rather than checking it is there.
 *
 * This exists because of how the dither failed the first time. It was present,
 * it was inlined correctly, it reached the screen at 1:1 device pixels, and it
 * changed nothing anybody could see — because every pixel was white at alpha 1,
 * which over the mesh is +0.83 of a level or nothing at all. Standard deviation
 * 0.42, one-sided, against a band step of exactly 1.0.
 *
 * That is not a small miss. Compositing happens AFTER react-native-svg has
 * rounded the gradient to 8 bits, so the tile cannot move a mean, and a band
 * edge is a difference of means. Masking is the only mechanism available, and
 * masking is entirely a question of amplitude — so amplitude is the thing worth
 * asserting, and the only way to assert it is to read the pixels.
 *
 * The PNG is ours, always RGBA/8-bit with filter 0 on every row, so decoding is
 * an inflate and a stride walk. Anything else means the generator changed shape
 * and this should be looked at rather than quietly skipped.
 */
function ditherAmplitudeFaults(b64) {
  /* The flat centre of a blob in dark mode, where one 8-bit step stretches
   * ~18dp and the ring gets drawn. Masking has to work HERE. */
  const C = 44;
  /* One level of zero-mean noise is the established debanding figure. The
   * shipped-and-invisible version measured 0.415, so this floor sits well
   * above it and below the 1.035 the generator currently emits. */
  const MIN_STD = 0.85;
  const MAX_MEAN = 0.35;

  const png = Buffer.from(b64, 'base64');
  if (png.readUInt32BE(0) !== 0x89504e47) return ['the tile is not a PNG'];

  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = -1;
  const idat = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || colour !== 6) {
    return [`the tile is not 8-bit RGBA (depth ${depth}, colour type ${colour})`];
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  if (raw.length !== stride * height) {
    return [`the tile decodes to ${raw.length} bytes, expected ${stride * height}`];
  }

  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let lighten = 0;
  let darken = 0;
  for (let y = 0; y < height; y += 1) {
    const base = y * stride;
    // Filter 0 (None) only — the generator writes nothing else, and undoing
    // the others here would be modelling a file we do not produce.
    if (raw[base] !== 0) return [`the tile uses PNG filter ${raw[base]}; this reads filter 0 only`];
    for (let x = 0; x < width; x += 1) {
      const o = base + 1 + x * 4;
      const grey = raw[o];
      const alpha = raw[o + 3];
      // Source-over of (grey, alpha) onto level C, expressed as a signed
      // change in levels. Exactly what the generator solves for.
      const d = ((grey - C) * alpha) / 255;
      if (d > 0.05) lighten += 1;
      else if (d < -0.05) darken += 1;
      sum += d;
      sumSq += d * d;
      n += 1;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);

  const faults = [];
  if (std < MIN_STD) {
    faults.push(
      `the tile perturbs by only ${std.toFixed(3)} levels (need >= ${MIN_STD}) — ` +
        'too weak to mask a 1-level band edge, which is how this shipped invisible',
    );
  }
  if (Math.abs(mean) > MAX_MEAN) {
    faults.push(
      `the tile shifts the background by ${mean.toFixed(3)} levels (max ${MAX_MEAN}) — ` +
        'that is a brightness change, not masking',
    );
  }
  if (lighten === 0 || darken === 0) {
    faults.push(
      `the tile only ${darken === 0 ? 'lightens' : 'darkens'} — one-sided noise ` +
        'cannot straddle an edge; it needs both white and black pixels',
    );
  }
  if (faults.length === 0) {
    console.log(
      `ok   the dither measures std ${std.toFixed(3)}, mean ${mean.toFixed(3)} levels over ${C}`,
    );
  }
  return faults;
}

/* ---------------- 6. the first frame is never empty ---------------------- */

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

/* ------------------------------------------- and the surface ON a scrim --- */

/*
 * A blur does two things, and only the first was accounted for.
 *
 * It hides what is behind it — which is what `over` was invented for, and why
 * Android's `content` fill is opaque. It ALSO takes on the colour of what is
 * behind it, and that one is iOS-only: behind a dialog on a dimmed page is 45%
 * black, so the Edit item sheet sampled the scrim, came out grey-green, and
 * read as though the whole form were disabled.
 *
 * `scrim` is therefore opaque on BOTH platforms. Asserted structurally because
 * the failure is a colour on one platform — the kind of thing that ships when
 * the person changing it is looking at the other one.
 */
{
  const grab = (f) => readFileSync(join(SRC, 'components', f), 'utf8');
  const frosted = grab('frosted.tsx');
  const glass = grab('glass.tsx');
  const sheet = grab('sheet.tsx');
  const check = (name, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`ok   ${name}`);
    else fail(name, [`  expected ${JSON.stringify(expected)}`, `  actual   ${JSON.stringify(actual)}`]);
  };

  check('a scrimmed surface is its own kind', /over === 'scrim'/.test(frosted), true);
  /*
   * BEFORE the platform branch. Below it, iOS would fall through to the blur
   * and the fix would apply on Android only — where there was never a problem.
   */
  check(
    '...handled before the platform branch, not after it',
    frosted.indexOf("over === 'scrim'") < frosted.indexOf("Platform.OS !== 'ios'"),
    true,
  );
  /*
   * The scrim BRANCH, extracted — not a window after the match.
   *
   * This was `/over === 'scrim'[\s\S]{0,400}overlaySolid/`, and 400 characters
   * reaches past the branch into the Android one, which uses the same token. It
   * passed with the scrim surface set to a translucent fill: an assertion about
   * one branch, satisfied by the next one down. The same spill has now cost
   * three checks in this repo.
   */
  {
    const from = frosted.indexOf("if (over === 'scrim')");
    const branch = from < 0 ? '' : frosted.slice(from, frosted.indexOf('\n  }', from));
    check('...and is opaque', /backgroundColor: colors\.overlaySolid/.test(branch), true);
    check('...with no blur in it at all', /BlurView|glassFill/.test(branch), false);
  }

  /*
   * Read from the Sheet, not passed by hand. Asking twenty call sites to know
   * whether they are on a scrim is how one of them ends up wrong.
   */
  check('the sheet publishes whether it dims', /scrim: boolean;/.test(sheet), true);
  check('...through a hook that does not throw outside one', /useContext\(Ctx\)\?\.scrim \?\? false/.test(sheet), true);
  check('...and GlassView reads it', /const onScrim = useOnScrim\(\)/.test(glass), true);
  check(
    "...upgrading a content surface that sits on one",
    /over === 'content' && onScrim \? 'scrim' : over/.test(glass),
    true,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
