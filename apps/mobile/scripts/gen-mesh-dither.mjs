/**
 * Generates assets/images/mesh-dither.png — the noise tile that stops the dark
 * mesh background from banding into concentric rings.
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

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'images',
  'mesh-dither.png',
);
writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
