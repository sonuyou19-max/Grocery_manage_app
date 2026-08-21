#!/usr/bin/env node
/**
 * The ring has to be honest about the fractions it draws.
 *
 * ---------------------------------------------------------------------------
 * Why a chart gets its own check
 * ---------------------------------------------------------------------------
 *
 * A donut is read as proportions. Nothing on screen states the arc lengths, so
 * an arc drawn a stroke-width too long is a chart lying by a few percent with
 * no symptom — it still looks like a donut, the legend still says 20%, and the
 * slice next to it is simply a bit bigger than it should be.
 *
 * That is exactly what round caps do if added on their own. A round cap extends
 * STROKE/2 past each end of its dash, so every slice paints a whole stroke
 * longer than its number: on a five-slice ring at this size, 80px of invention
 * on a 276px circumference. The component's previous version used butt caps and
 * a comment saying so, and reversing that decision is only safe while the
 * correction below travels with it.
 *
 * So this re-derives the painted extent from the dash and offset — the same
 * arithmetic the renderer does, written the other way round — and asserts it
 * lands on the fraction.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const FILE = join(SRC, 'components', 'balance-donut.tsx');

let failures = 0;
function check(what, actual, expected, tol = 0.0001) {
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}

/*
 * Only the two pure exports are needed, and the file is a component full of
 * JSX and React imports — so the geometry is lifted out rather than the module
 * executed. If either moves, this stops early and says so instead of passing
 * by testing nothing.
 */
const src = readFileSync(FILE, 'utf8');
const wanted = [
  /^const SIZE = .*$/m,
  /^const STROKE = .*$/m,
  /^const R = .*$/m,
  /^const CIRCUMFERENCE = .*$/m,
  /^const OVERLAP = .*$/m,
  // `\n}$` and not `\n}`: seamCap's parameter is an inline object type, so its
  // closing `}): {` also starts a line — the looser pattern truncated the
  // function at its own signature and the import came back undefined.
  /^export function arcDash\([\s\S]*?\n\}$/m,
  /^export function seamCap\([\s\S]*?\n\}$/m,
];
const parts = wanted.map((re) => src.match(re));
if (parts.some((p) => !p)) {
  console.error('could not lift the donut geometry out of balance-donut.tsx — has it moved?');
  process.exit(1);
}

const { outputText } = ts.transpileModule(parts.map((p) => p[0]).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { arcDash, seamCap } = mod;

// Re-read the constants from the source rather than restating them here, so a
// change to the stroke or the overlap is tested rather than silently diverged
// from.
const num = (re) => Number(src.match(re)[1]);
const SIZE = num(/^const SIZE = (\d+)/m);
const STROKE = num(/^const STROKE = (\d+)/m);
const OVERLAP = num(/^const OVERLAP = (\d+)/m);
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/** What the renderer will actually paint, caps included. */
function painted(startFraction, fraction) {
  const { dash, offset } = arcDash(startFraction, fraction);
  const dashStart = -offset;
  return { from: dashStart - STROKE / 2, to: dashStart + dash + STROKE / 2 };
}

/* ------------------------------- the ring stays true to the numbers ------- */

{
  // A realistic five-group mix, walked the way the component walks it.
  const mix = [0.4, 0.24, 0.16, 0.12, 0.08];
  let start = 0;
  for (const f of mix) {
    const { from, to } = painted(start, f);
    const pct = Math.round(f * 100);
    check(`${pct}% starts half an overlap early`, from, start * C - OVERLAP / 2);
    check(`${pct}% ends half an overlap late`, to, (start + f) * C + OVERLAP / 2);
    check(`${pct}% paints its own length plus the overlap`, to - from, f * C + OVERLAP);
    start += f;
  }
  check('the slices still sum to the whole ring', start, 1);
}

/*
 * The join. Every boundary has to bleed by the same amount, or the overlap
 * reads as a rendering fault at one seam rather than as a style at all of them.
 */
{
  const a = painted(0, 0.3);
  const b = painted(0.3, 0.3);
  check('neighbours overlap by exactly OVERLAP', a.to - b.from, OVERLAP);
}

/* --------------------------------------- a small group is a dot, not a gap */

{
  const { dash } = arcDash(0.9, 0.01);
  check('a 1% slice keeps a positive dash', dash >= 1, true);
  const { from, to } = painted(0.9, 0.01);
  check('...and paints at least a full cap', to - from >= STROKE, true);
}

/* ------------------------------------------- the gap never goes negative */

{
  // One group holding everything. A negative gap makes the dash array
  // meaningless and the platforms disagree about what to draw.
  const { dash, gap } = arcDash(0, 1);
  check('a full ring has a non-negative gap', gap >= 0, true);
  check('...and does not dash longer than the circle', dash <= C, true);
}

/* ---------------------------------------- the two halves travel together */

/*
 * Round caps are only safe while the shortening is there. Either one alone is
 * a bug: caps without it inflate every slice, the shortening without them
 * leaves a visible gap at every join.
 */
check('the ring draws round caps', /strokeLinecap="round"/.test(src), true);
check('and arcDash still subtracts the stroke', /length - STROKE \+ OVERLAP/.test(src), true);
check('the renderer asks arcDash rather than doing its own maths', /arcDash\(a\.start/.test(src), true);

/* ------------------------- the saturated end is the one on top ------------ */

/*
 * The first version painted forwards, and it was wrong in a way that showed:
 * each slice's leading cap is a translucent wash, so every join put 45% of one
 * colour over 100% of another. The dark end stopped reading as opaque and the
 * boundaries muddied.
 *
 * Reversed, the only thing painted over another slice is a cap at full
 * opacity, and the washes have nothing under them but the track. This is a
 * property of ORDER, not of geometry, so it is checked structurally — there is
 * nothing numeric to assert.
 */
check('the slices paint back to front', /\[\.\.\.arcs\]\.reverse\(\)\.map/.test(src), true);
check(
  '...so the LAST slice patches the wrap, not the first',
  /const last = arcs\[arcs\.length - 1\];/.test(src) && /seamCap\(arcDash\(/.test(src),
  true,
);
check(
  '...and the patch is a stub, not the whole slice redrawn',
  /cap\.dash/.test(src) && !/\[\.\.\.arcs, /.test(src),
  true,
);

/*
 * The stub has to end exactly where the slice it belongs to ends, or the seam
 * shows a step. And it must never be wider than that slice: a group of one item
 * has a dash of a single pixel, and an unclamped stub would spill its colour
 * backwards over the neighbour.
 */
{
  const slice = arcDash(0.7, 0.3);
  const cap = seamCap(slice);
  const capEnd = -cap.offset + cap.dash + STROKE / 2;
  check('the wrap stub ends where its slice ends', capEnd, painted(0.7, 0.3).to);
  check('...and is no longer than the overlap', cap.dash <= OVERLAP, true);

  /*
   * The floored case, which is where the first version of seamCap was wrong: a
   * one-item group paints a little past its fraction on purpose, so a stub
   * positioned from the fraction lands short of the dot it is capping.
   */
  const tiny = arcDash(0.99, 0.01);
  const tinyCap = seamCap(tiny);
  check('a one-pixel slice gets a one-pixel stub', tinyCap.dash, tiny.dash);
  const tinyCapEnd = -tinyCap.offset + tinyCap.dash + STROKE / 2;
  check('...still ending where the slice actually paints', tinyCapEnd, painted(0.99, 0.01).to);
  check('...and never past it', tinyCapEnd <= painted(0.99, 0.01).to, true);
}

/* ------------------------------------------------- gradients, not flat fill */

check('each slice is stroked with its own gradient', /stroke=\{`url\(#slice-\$\{a\.group\}\)`\}/.test(src), true);
check('the gradient runs along the arc, not across the box', /x1=\{from\.x\}[\s\S]{0,120}y2=\{to\.y\}/.test(src), true);
check(
  'a full circle gets a fallback direction rather than a zero-length gradient',
  /a\.end - a\.start > 0\.999/.test(src),
  true,
);
/*
 * Opacity stops rather than a second hex per group: one palette, and the card's
 * own background does the lightening, so the same two stops read correctly in
 * both themes. Five more colours would be five more things to keep in step with
 * the dots on the list screen.
 */
check('the fade is built from opacity', /stopOpacity=\{FADE\}/.test(src), true);
check('...of the group\'s own colour', /stopColor=\{GROUP_COLORS\[a\.group\]\}/.test(src), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
