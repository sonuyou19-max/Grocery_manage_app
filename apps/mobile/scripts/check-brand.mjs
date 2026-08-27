#!/usr/bin/env node
/**
 * One logo, in five places, and none of them allowed to drift.
 *
 * ---------------------------------------------------------------------------
 * Why a check rather than care
 * ---------------------------------------------------------------------------
 *
 * The mark exists as path data in components/korb-mark, as three SVGs under
 * assets/brand, and as five PNGs rasterised from those SVGs. Nothing in the
 * build regenerates the PNGs, so a change to the drawn mark alone produces an
 * app whose icon on the home screen is one logo and whose boot screen is
 * another — which is exactly the kind of wrong that ships, because everything
 * looks right on whichever screen the person making the change was looking at.
 *
 * So the TypeScript is the source and this asserts the rest agrees with it. A
 * `d` string is not something anybody edits twice on purpose.
 *
 * Run with `pnpm --filter mobile check:brand`.
 */
import { readFileSync, statSync } from 'node:fs';
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

/* ------------------------------------------------ the drawn mark is source */

const markTsx = read(join(ROOT, 'src', 'components', 'korb-mark.tsx'));
const paths = [...markTsx.matchAll(/^\s{2}(\w+): '([^']+)',$/gm)].map(([, k, d]) => [k, d]);

check('the mark has path data', paths.length >= 3, true);
// The silhouette is what survives shrinking. If a rib or a second gesture
// arrives later, it has to be a deliberate edit here rather than an accident.
check('...four strokes, no more', paths.length, 4);
check(
  '...named for what they are',
  paths.map(([k]) => k),
  ['handle', 'rim', 'body', 'check'],
);

/* ------------------------------------- every shipped SVG draws that mark */

/*
 * The icon and the adaptive foreground scale the mark to fit their own masks,
 * so their transforms differ — but the PATHS may not. A logo whose icon has a
 * different basket from its splash is two logos.
 */
for (const file of ['korb-mark.svg', 'korb-icon.svg', 'korb-adaptive-foreground.svg']) {
  const svg = read(join(BRAND, file));
  const missing = paths.filter(([, d]) => !svg.includes(d)).map(([k]) => k);
  check(`${file} draws the same mark`, missing, []);
  // The old leaning K, in case a file is ever restored from history rather than
  // regenerated. Its first stroke is unmistakable.
  check(`...and none of the old one`, svg.includes('M28.5 73'), false);
}

/*
 * Stroke weight travels with the paths. The same outline at a different weight
 * is a different logo, and it is the one property that does not announce itself
 * in a diff of `d` strings.
 */
{
  const weight = markTsx.match(/KORB_STROKE = ([\d.]+)/)?.[1];
  check('the stroke weight is stated once', Boolean(weight), true);
  for (const file of ['korb-mark.svg', 'korb-icon.svg', 'korb-adaptive-foreground.svg']) {
    check(
      `${file} strokes it at the same weight`,
      read(join(BRAND, file)).includes(`stroke-width="${weight}"`),
      true,
    );
  }
}

/* ----------------------------------------- the PNGs were regenerated too */

/*
 * Nothing in the build rasterises these, so the only evidence they were
 * regenerated is that they are newer than the SVG they come from. Crude, and
 * it catches the failure that actually happens: the mark changed, the SVGs
 * were rewritten, and the icons were forgotten.
 */
{
  const svgAt = Math.max(
    ...['korb-mark.svg', 'korb-icon.svg', 'korb-adaptive-foreground.svg'].map(
      (f) => statSync(join(BRAND, f)).mtimeMs,
    ),
  );
  const stale = [
    'icon.png',
    'favicon.png',
    'splash-icon.png',
    'android-icon-foreground.png',
    'android-icon-monochrome.png',
  ].filter((f) => statSync(join(IMAGES, f)).mtimeMs < svgAt - 5_000);
  check('every icon is at least as new as the mark', stale, []);
}

/* ------------------------------------------------- and app.json ships them */

{
  const app = JSON.parse(read(join(ROOT, 'app.json'))).expo;
  check('the app icon is the generated one', app.icon, './assets/images/icon.png');
  check('the splash is the mark', app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1].image, './assets/images/splash-icon.png');
  check('Android draws the adaptive foreground', app.android.adaptiveIcon.foregroundImage, './assets/images/android-icon-foreground.png');
}

/* --------------------------------------------- the boot screen draws it too */

/*
 * The handover is the point: the native splash paints the mark and this picks
 * it up on the first frame. Rendering the PNG there would work and would be
 * stuck at one size in one colour — which is what it was, and why the mark is
 * a component now.
 */
{
  const boot = read(join(ROOT, 'src', 'components', 'boot-gate.tsx'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check('the boot screen draws the vector', /<KorbWordmark/.test(boot), true);
  check('...rather than the splash PNG', /splash-icon\.png/.test(boot), false);
  // Same size as app.json's imageWidth, so the mark does not jump at the seam.
  const app = JSON.parse(read(join(ROOT, 'app.json'))).expo;
  const splashWidth = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1].imageWidth;
  check('...at the size the native splash left it', new RegExp(`size=\\{${splashWidth}\\}`).test(boot), true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
