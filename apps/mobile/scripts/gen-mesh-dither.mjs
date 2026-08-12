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
 * dithering becomes a smooth low-frequency ripple. Measured on the app's own
 * ramp, the widest flat band — the thing the eye reads as a ring — is 14px
 * with no dither at all, and still 14px after the upscaled dither is applied.
 * At 1:1 device pixels it drops to 7px. The upscaled version nibbles the edges
 * of each band and leaves the band itself untouched, which is exactly what
 * "the rings look exactly the same" means.
 *
 * A data: URI never enters the resource system. Fresco decodes it at its
 * natural pixel size, so the tile lands 1:1 on device pixels on every density,
 * with no per-device asset variants to keep in step.
 *
 * The cost is ~4.8KB of base64 in the JS bundle, which is the correct trade for
 * a 3.5KB image that only works when it is not resampled.
 *
 * ---------------------------------------------------------------------------
 * Why a noise texture is the fix and a smoother gradient is not
 * ---------------------------------------------------------------------------
 *
 * The mesh is a radial ramp from the base colour to a blob colour. In dark mode
 * those two are #0B0F09 and #1C3A28: after the peak opacity and the scrim, the
 * widest channel travels about 29 of the 255 values an 8-bit surface can hold,
 * across a blob radius of roughly 260dp. That is one quantisation step every
 * ~9dp — a hard-edged arc every 9dp, three blobs, concentric.
 *
 * Nothing about the gradient's SHAPE can fix that. Make the falloff perfectly
 * smooth (it now is) and the steps are still there, because the destination
 * cannot hold values between them. Deepen the ramp and you get more, narrower
 * bands; flatten it and you get fewer, wider ones. The banding is a property of
 * the surface, not of the curve.
 *
 * What removes it is dither: perturb each pixel by about one step before it is
 * rounded, and the boundary between two bands stops being a clean arc and
 * becomes an interleaving of both values. The eye integrates the mix and reads
 * a continuous ramp; the Mach edge it was actually latching onto is gone.
 *
 * ---------------------------------------------------------------------------
 * Why white, and why alpha 1
 * ---------------------------------------------------------------------------
 *
 * Compositing white at alpha a over a colour c lifts it by a*(255-c)/255. That
 * is worth ~0.9 of a step on dark mode's background (c ≈ 30) and ~0.08 of a
 * step on light mode's (c ≈ 235). So one tile dithers the scheme that bands and
 * is arithmetically invisible on the scheme that does not — which is the right
 * outcome, because light mode was never the complaint.
 *
 * Alpha is 0 or 1 and nothing else, on purpose. Dither wants an amplitude of
 * about one quantisation step; more than that stops being invisible correction
 * and starts being film grain, which is a look, and not one anybody asked for.
 *
 * Deterministic — reruns produce a byte-identical file, so this can be
 * regenerated without churning the repo.
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

/* One filter byte (0 = None) per scanline, then RGBA. */
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let p = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[p] = 0;
  p += 1;
  for (let x = 0; x < SIZE; x += 1) {
    raw[p] = 255;
    raw[p + 1] = 255;
    raw[p + 2] = 255;
    raw[p + 3] = rand() < 0.5 ? 0 : 1;
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
const module = `/**
 * GENERATED by scripts/gen-mesh-dither.mjs — do not edit by hand.
 *
 * A ${SIZE}x${SIZE} tile of one-step white noise, inlined as a data: URI so it
 * reaches the screen at 1:1 device pixels. Shipped as a bundled .png it lands
 * in res/drawable-mdpi and Android density-scales it ~2.75x with bilinear
 * filtering, which turns per-pixel noise into a smooth ripple and removes the
 * entire effect — measured, the widest band stayed exactly as wide as with no
 * dither at all. See the generator for the full account.
 *
 * Alpha is 0 or 1 and nothing else: dither wants about one quantisation step,
 * and more than that is film grain rather than invisible correction.
 */
export const MESH_DITHER_SIZE = ${SIZE};

export const MESH_DITHER_URI =
  'data:image/png;base64,${b64}';
`;

const out = join(here, '..', 'src', 'lib', 'mesh-dither.ts');
writeFileSync(out, module);
console.log(
  `wrote ${out} (${SIZE}x${SIZE}, ${png.length} B png -> ${b64.length} B base64)`,
);
