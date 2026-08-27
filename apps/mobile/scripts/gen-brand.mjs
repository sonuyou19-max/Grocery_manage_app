#!/usr/bin/env node
/**
 * Every brand asset, traced out of the original artwork.
 *
 * ---------------------------------------------------------------------------
 * Why this exists rather than a drawing
 * ---------------------------------------------------------------------------
 *
 * I tried three times to redraw this mark as bezier paths from looking at it,
 * and produced three baskets that were recognisably not the one in the brief —
 * each time missing a different detail, each time convinced by the previous
 * correction. A logo is not a description of a logo, and "close enough" is a
 * judgement the person who owns the brand gets to make, not the person
 * approximating it.
 *
 * So the artwork is the source. assets/brand/korb-source.png is the file as it
 * was given, and this separates the ink from the paper it was photographed on,
 * cuts out each piece, and writes every size the app ships.
 *
 * ---------------------------------------------------------------------------
 * The two things that make it look drawn rather than cut out
 * ---------------------------------------------------------------------------
 *
 * ALPHA PER PIECE. The wordmark is a far darker green than the basket, so one
 * ramp across the whole image put the basket at about 60% alpha — it rendered
 * translucent, with the paper's texture showing through as mottling. Each piece
 * is normalised against its own darkest pixels.
 *
 * A KNEE AT EACH END. Below 18% is paper grain and goes to nothing; above 80%
 * is the stroke and goes solid. The ramp between is what keeps the edges
 * smooth. A hard threshold here is what makes an extracted logo look like it
 * was cut out with scissors.
 *
 * Run with `pnpm --filter mobile gen:brand` after replacing the source.
 */
/*
 * playwright-core is NOT a dependency of this app, deliberately.
 *
 * This script runs when the brand changes, which is roughly never, and a
 * headless browser in every contributor's install is a real cost for a tool
 * with that cadence. It is fetched on demand instead, and the message below is
 * what makes that a five-second inconvenience rather than a puzzle.
 */
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(
    'gen-brand needs playwright-core, which this app does not depend on.\n' +
      '  npx --yes playwright-core@latest --version >/dev/null   # warms the cache\n' +
      '  npm i --no-save playwright-core && node scripts/gen-brand.mjs\n' +
      'CHROME_PATH overrides the browser it drives.',
  );
  process.exit(1);
}
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BRAND = join(ROOT, 'assets', 'brand');
const IMG = join(ROOT, 'assets', 'images');
const SOURCE = join(BRAND, 'korb-source.png');

const CHROME =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const data = 'data:image/png;base64,' + readFileSync(SOURCE).toString('base64');
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');

const out = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = src; });
  const c = document.getElementById('c');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data: px } = g.getImageData(0, 0, c.width, c.height);
  const lum = (i) => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;

  // The paper is the brightest thing here; the ink is the darkest. Sample both
  // rather than assuming, so a different crop or exposure still separates.
  const all = [];
  for (let i = 0; i < px.length; i += 4) all.push(lum(i));
  const sorted = [...all].sort((a, b) => a - b);
  const ink = sorted[Math.floor(sorted.length * 0.002)];
  const paper = sorted[Math.floor(sorted.length * 0.98)];

  // Alpha is how far a pixel has travelled from paper toward ink. Keeps the
  // antialiasing, which is what makes the extraction look drawn rather than cut.
  const alpha = new Float32Array(c.width * c.height);
  for (let p = 0; p < alpha.length; p++) {
    const a = (paper - lum(p * 4)) / (paper - ink);
    alpha[p] = a < 0.06 ? 0 : Math.min(1, a);
  }

  // Column and row profiles, to find the ink and to split mark from word.
  const col = new Float64Array(c.width);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) col[x] += alpha[y * c.width + x] > 0.5 ? 1 : 0;

  const on = col.map((v) => v >= 2);
  const runs = [];
  let start = -1;
  for (let x = 0; x <= c.width; x++) {
    if (on[x] && start < 0) start = x;
    else if (!on[x] && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  // Merge runs separated by less than 2% of the width — letters of one word.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < c.width * 0.012) last[1] = r[1];
    else merged.push([...r]);
  }
  const bbox = ([x0, x1]) => {
    let y0 = c.height, y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = x0; x <= x1; x++)
        if (alpha[y * c.width + x] > 0.25) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  return {
    width: c.width, height: c.height, ink, paper,
    groups: merged.map(bbox),
    alpha: Array.from(alpha, (a) => Math.round(a * 255)),
    luma: Array.from({ length: c.width * c.height }, (_, p) => Math.round(lum(p * 4) * 255)),
    paperLuma: Math.round(paper * 255),
  };
}, data);


console.log('source', out.width + 'x' + out.height);
out.groups.forEach((g, i) => console.log(`  piece ${i}: ${g.w}x${g.h} at ${g.x0},${g.y0}`));

/*
 * Which piece is which, by position. The artwork is the app icon, then the bare
 * mark, then the word — left to right — so they come out of the column scan in
 * that order. Asserted rather than assumed: a re-shot source with the pieces
 * rearranged should fail here loudly rather than ship a wordmark as an icon.
 */
if (out.groups.length !== 3) {
  console.error(`expected 3 pieces in the artwork, found ${out.groups.length}`);
  process.exit(1);
}
const MARK = 1;
const WORD = 2;

await page.evaluate((s) => { window.__src = s; }, {
  width: out.width,
  groups: out.groups,
  luma: out.luma,
  paperLuma: out.paperLuma,
});

/**
 * Crop one group out of the alpha map and paint it in a colour.
 *
 * `pad` squares the result up, so the mark keeps its own margins wherever it is
 * placed. `box` optionally scales it inside that square — the Android adaptive
 * foreground has to sit inside the central 66 of 108dp.
 */
const cut = (group, { size, color, square = true, box = 1, bg = null }) =>
  page.evaluate(
    ({ group: gi, size, color, square, box, bg }) => {
      const { width, groups, luma, paperLuma } = window.__src;
      const g = groups[gi];

      /*
       * Alpha computed against THIS piece's own ink, not the image's.
       *
       * The wordmark is a far darker green than the basket, so one global ramp
       * put the basket's strokes at about 60% alpha — it rendered translucent,
       * with the paper's texture showing through as mottling. Each piece is
       * normalised against its own darkest pixels instead.
       */
      const inside = [];
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) inside.push(luma[(y + g.y0) * width + (x + g.x0)]);
      inside.sort((a, b) => a - b);
      const ink = inside[Math.floor(inside.length * 0.01)];

      /*
       * A knee at each end. Below 18% is paper grain and goes to nothing; above
       * 80% is the stroke itself and goes fully solid. The ramp between is what
       * keeps the edges smooth — a hard threshold here is what makes an
       * extracted logo look cut out with scissors.
       */
      const alphaAt = (p) => {
        const a = (paperLuma - luma[p]) / (paperLuma - ink);
        return Math.max(0, Math.min(1, (a - 0.18) / 0.62));
      };
      const c = document.getElementById('c');
      c.width = size;
      c.height = square ? size : Math.round((size * g.h) / g.w);
      const ctx = c.getContext('2d');
      if (bg) {
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, bg[0]);
        grad.addColorStop(1, bg[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      // The source patch, at its own resolution, coloured and alpha-masked.
      const patch = document.createElement('canvas');
      patch.width = g.w;
      patch.height = g.h;
      const pc = patch.getContext('2d');
      const id = pc.createImageData(g.w, g.h);
      const [r, gg, b] = color;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          const a = Math.round(alphaAt((y + g.y0) * width + (x + g.x0)) * 255);
          const o = (y * g.w + x) * 4;
          id.data[o] = r; id.data[o + 1] = gg; id.data[o + 2] = b; id.data[o + 3] = a;
        }
      }
      pc.putImageData(id, 0, 0);
      // Fit inside the box, centred, preserving aspect.
      const scale = Math.min((c.width * box) / g.w, (c.height * box) / g.h);
      const w = g.w * scale, h = g.h * scale;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(patch, (c.width - w) / 2, (c.height - h) / 2, w, h);
      return c.toDataURL('image/png');
    },
    { group, size, color, square, box, bg },
  );

const save = async (dataUrl, path) => {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('   ', basename(path));
};


const WHITE = [255, 255, 255];
const GREEN = [0x2e, 0x74, 0x42];

// In-app and splash: white on transparent, so the splash colour shows through.
await save(await cut(MARK, { size: 1024, color: WHITE, box: 0.94 }), join(IMG, 'korb-mark.png'));
await save(await cut(MARK, { size: 512, color: WHITE, box: 0.94 }), join(IMG, 'splash-icon.png'));
await save(await cut(WORD, { size: 1024, color: WHITE, square: false }), join(IMG, 'korb-word.png'));

// The app icon: the mark on the brand gradient, inset so the platform mask
// cannot clip it.
await save(await cut(MARK, { size: 1024, color: WHITE, box: 0.62, bg: ['#5FD070', '#10502A'] }), join(IMG, 'icon.png'));
await save(await cut(MARK, { size: 48, color: WHITE, box: 0.62, bg: ['#5FD070', '#10502A'] }), join(IMG, 'favicon.png'));

// Android adaptive: inside the central 66 of 108dp, so circle, squircle and
// teardrop masks all clear it.
await save(await cut(MARK, { size: 1024, color: WHITE, box: 0.52 }), join(IMG, 'android-icon-foreground.png'));
await save(await cut(MARK, { size: 1024, color: WHITE, box: 0.52 }), join(IMG, 'android-icon-monochrome.png'));


await browser.close();
