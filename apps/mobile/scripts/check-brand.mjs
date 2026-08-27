#!/usr/bin/env node
/**
 * One logo, in seven files, and none of them allowed to drift.
 *
 * ---------------------------------------------------------------------------
 * Why a check rather than care
 * ---------------------------------------------------------------------------
 *
 * The mark is not drawn in this repo any more. It is TRACED out of the original
 * artwork by scripts/gen-brand, which needs a browser and so does not run in
 * the build — meaning the only thing keeping the icon on the home screen and
 * the mark on the boot screen in agreement is that somebody remembered to run
 * it. That is exactly the kind of wrong that ships, because everything looks
 * right on whichever screen the person making the change was looking at.
 *
 * So: the artwork is the source, and every asset must be no older than it.
 *
 * ---------------------------------------------------------------------------
 * The history this file is a monument to
 * ---------------------------------------------------------------------------
 *
 * The mark was hand-drawn as bezier paths three times and was wrong three
 * times — recognisably a basket, recognisably not THE basket. Redrawing a logo
 * is tracing it badly. If the paths ever come back, the checks below fail: the
 * app must render the traced asset, not an approximation of it.
 *
 * Run with `pnpm --filter mobile check:brand`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BRAND = join(ROOT, 'assets', 'brand');
const IMAGES = join(ROOT, 'assets', 'images');

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};
const read = (p) => readFileSync(p, 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------------------------------ the artwork is source */

const SOURCE = join(BRAND, 'korb-source.png');
check('the original artwork is checked in', existsSync(SOURCE), true);
check('...and the generator with it', existsSync(join(HERE, 'gen-brand.mjs')), true);

/*
 * Nothing in the build runs gen-brand — it needs a headless browser — so the
 * only evidence the assets came from THIS artwork is that they are no older
 * than it. Crude, and it catches the failure that actually happens: the source
 * was replaced and the icons were forgotten.
 */
{
  const sourceAt = statSync(SOURCE).mtimeMs;
  const generated = [
    'icon.png',
    'favicon.png',
    'splash-icon.png',
    'android-icon-foreground.png',
    'android-icon-monochrome.png',
    'korb-mark.png',
    'korb-word.png',
  ];
  const missing = generated.filter((f) => !existsSync(join(IMAGES, f)));
  check('every asset was generated', missing, []);
  const stale = generated
    .filter((f) => existsSync(join(IMAGES, f)))
    .filter((f) => statSync(join(IMAGES, f)).mtimeMs < sourceAt - 5_000);
  check('...from the artwork that is checked in now', stale, []);
}

/*
 * The hand-drawn mark, in case a file is ever restored from history rather than
 * regenerated. Its rim stroke is unmistakable, and so is the leaning K before
 * it. Neither may come back.
 */
for (const f of ['korb-mark.svg', 'korb-icon.svg', 'korb-adaptive-foreground.svg']) {
  check(`the drawn ${f} is gone`, existsSync(join(BRAND, f)), false);
}

/* --------------------------------------------------- the app draws the trace */

{
  const mark = strip(read(join(ROOT, 'src', 'components', 'korb-mark.tsx')));
  check('the mark component loads the traced asset', /assets\/images\/korb-mark\.png/.test(mark), true);
  check('...and the wordmark its own', /assets\/images\/korb-word\.png/.test(mark), true);
  // An approximation coming back is the failure this file exists for.
  check('...and draws no paths of its own', /<Path|KORB_PATHS|stroke-width/.test(mark), false);
  /*
   * White source, tinted from there. Tint replaces colour and keeps alpha, so a
   * white asset tints cleanly to any hue while a coloured one muddies.
   */
  /*
   * BOTH halves. The first version of this asserted the pattern appeared at
   * all, and passed with the mark's tint deleted because the word still had
   * one — a check that a lockup is tintable, satisfied by half a lockup.
   */
  check('both halves are tintable', (mark.match(/tintColor=\{color\}/g) ?? []).length, 2);

  /*
   * The lockup's offset is arithmetic, not a measurement: the row slides by half
   * the word's width, and reading that from onLayout makes the animation's
   * first frame a guess.
   */
  const lockup = strip(read(join(ROOT, 'src', 'components', 'korb-wordmark.tsx')));
  check('the lockup computes the word width', /const wordW = wordH \* WORD_ASPECT/.test(lockup), true);
  check('...rather than measuring it', /onLayout/.test(lockup), false);
  check('...and slides the row, never a width', /translateX: \(1 - open\.value\) \* \(\(wordW \+ GAP\) \/ 2\)/.test(lockup), true);
  check('Reduce Motion still gets the whole lockup', /if \(reduced\) \{\s*land\.value = 1;\s*open\.value = 1;/.test(lockup), true);

  /*
   * WORD_ASPECT is the traced piece's own shape. gen-brand prints each piece's
   * dimensions; if the artwork is re-shot and the word's proportions change,
   * this constant has to change with it or the lockup stretches the name.
   */
  const aspect = read(join(ROOT, 'src', 'components', 'korb-mark.tsx')).match(
    /WORD_ASPECT = (\d+) \/ (\d+)/,
  );
  check('the word aspect is stated as the traced pixels', Boolean(aspect), true);
}

/* --------------------------------------------------------- and app.json ships */

{
  const app = JSON.parse(read(join(ROOT, 'app.json'))).expo;
  check('the app icon is the generated one', app.icon, './assets/images/icon.png');
  const splash = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  check('the splash is the mark', splash.image, './assets/images/splash-icon.png');
  check('Android draws the adaptive foreground', app.android.adaptiveIcon.foregroundImage, './assets/images/android-icon-foreground.png');

  /*
   * The handover: the native splash paints the mark and the boot screen picks
   * it up on the first frame, at the same size, so nothing jumps at the seam.
   */
  const boot = strip(read(join(ROOT, 'src', 'components', 'boot-gate.tsx')));
  check('the boot screen draws the lockup', /<KorbWordmark/.test(boot), true);
  check(
    '...at the size the native splash left it',
    new RegExp(`size=\\{${splash.imageWidth}\\}`).test(boot),
    true,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
