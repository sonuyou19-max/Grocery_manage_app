/**
 * Generates src/lib/mesh-dither.ts — the noise tile that stops the dark mesh
 * background from banding into concentric rings, as an inline data: URI.
 *
 * ---------------------------------------------------------------------------
 * Why a data: URI and not a bundled .png
 * ---------------------------------------------------------------------------
 *
 * It WAS a bundled asset, and that silently destroyed the effect on Android.
 *
 * A required asset with no `@Nx` suffix is scale 1, and RN's asset pipeline
 * files scale-1 images into `res/drawable-mdpi` (see @react-native/
 * assets-registry/path-support, getAndroidResourceFolderName). Android's
 * resource system then treats that as a 160dpi drawable and DENSITY-SCALES it
 * up to the device — ~2.75x on a typical phone — with bilinear filtering,
 * before the view ever sees it.
 *
 * Bilinear-upscaling one-pixel noise is the one operation that destroys it
 * completely: the high-frequency, spatially-independent signal that does the
 * work becomes a smooth low-frequency ripple. A data: URI never enters the
 * resource system — Fresco decodes it at its natural pixel size, so the tile
 * lands 1:1 on device pixels at every density.
 *
 * ---------------------------------------------------------------------------
 * Masking, not dithering — and why that changes the amplitude
 * ---------------------------------------------------------------------------
 *
 * This is the correction to the version that shipped and did nothing visible.
 *
 * Real dither perturbs a value BEFORE it is quantised, so the rounding itself
 * carries the fraction: a true 30.4 becomes 30 sixty percent of the time and 31
 * forty percent, and the mean is 30.4. Adjacent bands then differ in mean by
 * the fraction rather than the whole step, and the edge disappears.
 *
 * We cannot do that. react-native-svg rasterises the gradient to an 8-bit
 * surface before anything of ours runs, so this tile composites AFTER the
 * rounding has already happened. Adding noise there cannot change any mean: a
 * band edge is a one-level difference in the mean, and the same noise on both
 * sides leaves that difference exactly where it was.
 *
 * What post-quantisation noise CAN do is mask — bury the edge in variance so
 * the eye stops resolving it. That is what video debanding filters do, and it
 * works, but it is an amplitude game and the first version lost it badly:
 *
 *   before   alpha 0 or 1, white only  ->  +0.83 levels or nothing
 *                                          std 0.42, mean +0.42, ONE-SIDED
 *   after    five states, white AND black -> std ~1.04, mean ~0
 *
 * Against a step of exactly 1.0 level, 0.42 of one-sided noise is not masking,
 * it is a uniform brightening with a little texture on it. Roughly one level of
 * ZERO-MEAN noise is the established figure, and that is what this now emits.
 *
 * Black is what makes it two-sided, and black is the awkward half: compositing
 * black at alpha a over a colour c darkens by a*c/255, so it has almost no
 * authority where c is small. The alphas below are therefore chosen against the
 * background where the WIDEST bands actually are — the flat centre of a blob,
 * where the gaussian's derivative goes to zero and one 8-bit step stretches
 * ~18dp. Out at the dim edges the black half weakens and the noise goes
 * gently one-sided again, which is acceptable: the bands out there are narrow.
 *
 * ---------------------------------------------------------------------------
 * Why the gradient's SHAPE cannot fix this
 * ---------------------------------------------------------------------------
 *
 * In dark mode the ramp runs #0B0F09 -> #1C3A28; after peak opacity and the
 * scrim the green channel travels about 29 of the 255 values an 8-bit surface
 * can hold, over a blob radius of ~267dp. That is 60 bands. Make the falloff
 * perfectly smooth (it now is) and they are all still there, because the
 * destination cannot hold values in between. Deepen the ramp for more, narrower
 * bands; flatten it for fewer, wider ones. Banding is a property of the surface.
 *
 * Deterministic — reruns produce a byte-identical file.
 *
 * Run with `pnpm --filter mobile gen:mesh-dither`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Big enough that the repeat has no findable period, small enough to be a few kB. */
const SIZE = 128;

/* Seeded so the asset is reproducible; the particular seed means nothing. */
let seed = 0x9e3779b9;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * The five perturbations, as (grey, alpha) pairs with a weight out of 8.
 *
 * Symmetric in weight and near-symmetric in effect, so the tile brightens the
 * background by essentially nothing overall while spreading each pixel about a
 * level either side. The black alphas are the larger numbers because black has
 * less leverage on a dark background — see the header.
 */
const STATES = [
  { grey: 0, alpha: 10, weight: 1 },
  { grey: 0, alpha: 5, weight: 2 },
  { grey: 0, alpha: 0, weight: 2 },
  { grey: 255, alpha: 1, weight: 2 },
  { grey: 255, alpha: 2, weight: 1 },
];
const TOTAL_WEIGHT = STATES.reduce((n, s) => n + s.weight, 0);

/** What compositing one state over an 8-bit level does to it, in levels. */
const delta = (state, c) =>
  ((state.grey - c) * state.alpha) / 255;

/**
 * Mean and standard deviation of the perturbation over a background level,
 * in 8-bit levels. Printed on every run, and asserted by check-blur — because
 * the way this fix failed the first time was by being present, correct in
 * shape, and too small to do anything.
 */
const stats = (c) => {
  const mean =
    STATES.reduce((n, s) => n + s.weight * delta(s, c), 0) / TOTAL_WEIGHT;
  const variance =
    STATES.reduce((n, s) => n + s.weight * (delta(s, c) - mean) ** 2, 0) /
    TOTAL_WEIGHT;
  return { mean, std: Math.sqrt(variance) };
};

/* One filter byte (0 = None) per scanline, then RGBA. */
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let p = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[p] = 0;
  p += 1;
  for (let x = 0; x < SIZE; x += 1) {
    let pick = rand() * TOTAL_WEIGHT;
    let state = STATES[STATES.length - 1];
    for (const s of STATES) {
      pick -= s.weight;
      if (pick < 0) {
        state = s;
        break;
      }
    }
    raw[p] = state.grey;
    raw[p + 1] = state.grey;
    raw[p + 2] = state.grey;
    raw[p + 3] = state.alpha;
    p += 4;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// 10..12 stay zero: deflate, adaptive filtering, no interlace.

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const b64 = png.toString('base64');
const here = dirname(fileURLToPath(import.meta.url));

/*
 * One artifact, not two. An .png beside the .ts would be a second source of
 * truth for the same bytes, and the whole reason this file exists is that the
 * .png route is the one that does not work.
 */
/* The flat centre of a blob in dark mode: green lands near here, and that is
 * where one 8-bit step stretches widest and the ring is drawn. */
const STAT_C = 44;
const { mean: statMean, std: statStd } = stats(STAT_C);
const STAT_MEAN = statMean.toFixed(3);
const STAT_STD = statStd.toFixed(3);

const module = `/**
 * GENERATED by scripts/gen-mesh-dither.mjs — do not edit by hand.
 *
 * A ${SIZE}x${SIZE} noise tile, inlined as a data: URI so it reaches the screen
 * at 1:1 device pixels. Shipped as a bundled .png it lands in res/drawable-mdpi
 * and Android density-scales it ~2.75x with bilinear filtering, which turns
 * per-pixel noise into a smooth ripple and removes the whole effect.
 *
 * It composites AFTER react-native-svg has already rounded the gradient to
 * 8 bits, so it cannot dither in the strict sense — it cannot move any mean,
 * and a band edge IS a difference of means. What it does is mask: bury the
 * one-level step in about one level of zero-mean variance. The first version
 * used white at alpha 1 and nothing else, which is 0.42 of a level, one-sided,
 * against a step of 1.0 — present, plausible, and far too weak to see.
 *
 * Perturbation over a mid-mesh background (level ${STAT_C}):
 *   mean ${STAT_MEAN} levels, std ${STAT_STD} levels
 *
 * See the generator for why black carries the larger alphas.
 */
export const MESH_DITHER_SIZE = ${SIZE};

/** Standard deviation of the tile's perturbation, in 8-bit levels, over a
 *  background of ${STAT_C} — the flat blob centre where bands are widest.
 *  Exported so the guard can assert it rather than trust this comment. */
export const MESH_DITHER_STD = ${STAT_STD};

export const MESH_DITHER_URI =
  'data:image/png;base64,${b64}';
`;

const out = join(here, '..', 'src', 'lib', 'mesh-dither.ts');
writeFileSync(out, module);
console.log(
  `wrote ${out} (${SIZE}x${SIZE}, ${png.length} B png -> ${b64.length} B base64)`,
);
for (const c of [11, 22, 30, 44]) {
  const { mean, std } = stats(c);
  console.log(
    `  over level ${String(c).padStart(2)}: mean ${mean.toFixed(3)}, std ${std.toFixed(3)} levels`,
  );
}
