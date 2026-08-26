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
 * That is exactly what a cap does if it is not paid for. A cap adds STROKE/2
 * past the end of its dash, so a slice drawn with one and not corrected for it
 * paints half a stroke longer than its number.
 *
 * The ring is rounded at the END of each slice only, which SVG cannot express
 * as a linecap — both ends of a dash share one. So a slice is a butt-capped
 * BODY plus a filled circle for its TIP, and the body is pulled back half a
 * stroke to start underneath the previous slice's tip. What that arrangement
 * has to guarantee is three things at once, all of them invisible when wrong:
 *
 *   1. the VISIBLE extent of each slice is exactly its fraction — the leading
 *      half-stroke is under a neighbour and must not be counted;
 *   2. the tip reaches the slice's end and no further;
 *   3. consecutive slices underlap by exactly half a stroke, which is what
 *      fills the crescent the round tip narrows away from. Less and the track
 *      shows through at every join.
 *
 * So this re-derives all three from what the geometry returns — the same
 * arithmetic the renderer does, written the other way round.
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
  // `\n}$` and not `\n}`: a parameter written as an inline object type closes
  // with `}): {` at the start of a line too, and the looser pattern truncated
  // the function at its own signature — the import then came back undefined and
  // everything below passed by testing nothing.
  /^export function arcBody\([\s\S]*?\n\}$/m,
  /^export function tipFraction\([\s\S]*?\n\}$/m,
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
const { arcBody, tipFraction } = mod;

// Re-read the constants from the source rather than restating them here, so a
// change to the stroke or the overlap is tested rather than silently diverged
// from.
/*
 * Source assertions read this, not `src`. The component's own comments explain
 * why it no longer uses stopOpacity — and a check for the absence of
 * `stopOpacity` therefore failed on the sentence saying it was removed. Three
 * guards in this repo have now matched prose instead of code; this is the
 * fourth, and the first to do it while forbidding something.
 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const num = (re) => Number(src.match(re)[1]);
const SIZE = num(/^const SIZE = (\d+)/m);
const STROKE = num(/^const STROKE = (\d+)/m);
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * What the renderer paints, and what a reader actually sees, which are not the
 * same span — the difference IS the design.
 *
 * `from` is where the body's flat edge lands, half a stroke back under the
 * previous slice's tip. `visibleFrom` is where the colour starts being this
 * slice's, which is where that tip stops covering it. `to` is the far edge of
 * this slice's own tip.
 */
function painted(startFraction, fraction) {
  const { dash, offset } = arcBody(startFraction, fraction);
  const from = -offset;
  const tip = tipFraction(startFraction, fraction) * C;
  return {
    from,
    visibleFrom: from + STROKE / 2,
    bodyTo: from + dash,
    tip,
    to: tip + STROKE / 2,
  };
}

/* ------------------------------- the ring stays true to the numbers ------- */

{
  // A realistic five-group mix, walked the way the component walks it.
  const mix = [0.4, 0.24, 0.16, 0.12, 0.08];
  let start = 0;
  for (const f of mix) {
    const P = painted(start, f);
    const pct = Math.round(f * 100);
    check(`${pct}% begins where its neighbour's tip stops covering it`, P.visibleFrom, start * C);
    check(`${pct}% ends exactly at its fraction`, P.to, (start + f) * C);
    check(`${pct}% shows its own length and nothing more`, P.to - P.visibleFrom, f * C);
    // The half-stroke of underlap: what fills the crescent the tip vacates.
    check(`${pct}% starts half a stroke early, underneath`, start * C - P.from, STROKE / 2);
    // The body has to reach the tip's centre, or there is a hole between them.
    check(`${pct}% body meets its tip`, P.bodyTo >= P.tip - 0.0001, true);
    start += f;
  }
  check('the slices still sum to the whole ring', start, 1);
}

/*
 * The join, which is the thing the user could see. A round tip narrows away
 * from the full ring width over its last half-stroke; if the next body did not
 * start under it, the track would show through that crescent at every boundary.
 */
{
  const a = painted(0, 0.3);
  const b = painted(0.3, 0.3);
  check('the next slice starts under the previous tip', b.from < a.to, true);
  check('...by exactly half a stroke', a.to - b.from, STROKE / 2);
  check('...which is the full depth of the rounding', a.to - a.tip, STROKE / 2);
}

/* --------------------------------------- a small group is a dot, not a gap */

{
  const { dash } = arcBody(0.9, 0.01);
  check('a 1% slice keeps a positive body', dash >= 1, true);
  const P = painted(0.9, 0.01);
  check('...and paints at least a full cap', P.to - P.from >= STROKE, true);
  /*
   * The clamp. A group shorter than its own cap would otherwise be centred
   * BEFORE it begins, putting its dot inside the previous slice — wearing the
   * wrong neighbour's position, which is worse than overstating its size.
   */
  check('...at its own start, never behind it', P.tip >= 0.9 * C - 0.0001, true);
}

/* ------------------------------------------- the gap never goes negative */

{
  // One group holding everything. A negative gap makes the dash array
  // meaningless and the platforms disagree about what to draw.
  const { dash, gap } = arcBody(0, 1);
  check('a full ring has a non-negative gap', gap >= 0, true);
  check('...and does not dash longer than the circle', dash <= C, true);
}

/* ---------------------------------------- the two halves travel together */

/*
 * The body MUST be butt-capped. A round linecap here would put the same bulge
 * on the start that the tip puts on the end — which is the shape being removed,
 * and it would silently lengthen every slice by half a stroke on top of it.
 */
check('the body draws butt caps', /strokeLinecap="butt"/.test(code), true);
check('...and no round linecap survives anywhere', /strokeLinecap="round"/.test(code), false);
check('the tip is a filled circle of the stroke\'s own diameter', /r=\{STROKE \/ 2\} fill=\{`url\(#slice-/.test(code), true);
check('the renderer asks the geometry rather than doing its own maths', /arcBody\(a\.start/.test(code) && /tipFraction\(a\.start/.test(code), true);
check('the body is pulled back half a stroke', /startFraction \* CIRCUMFERENCE - STROKE \/ 2/.test(code), true);
check('nothing corrects the dash any more — butt caps add nothing', /length - STROKE/.test(code), false);

/* ------------------------- the saturated end is the one on top ------------ */

/*
 * Order, not geometry, and it carries two things at once.
 *
 * Painted forwards, every body would sit on top of the tip it is meant to be
 * tucked under — the round end sliced flat by its neighbour, and the ring back
 * to butt joins. And each slice's leading wash would land on the previous
 * slice's saturated end, which is what made the boundaries muddy before.
 */
check('the slices paint back to front', /\[\.\.\.arcs\]\.reverse\(\)\.map/.test(code), true);
check(
  '...so the LAST slice patches the wrap, not the first',
  /const last = arcs\[arcs\.length - 1\];/.test(code),
  true,
);
check(
  '...and the patch is the tip alone, not the whole slice redrawn',
  /tipFraction\(last\.start/.test(code) && !/arcBody\(last\.start/.test(code),
  true,
);
check(
  '...skipped for a single slice, which already caps itself',
  /arcs\.length > 1/.test(code),
  true,
);

/* ------------------------------------------------- gradients, not flat fill */

check('each slice is stroked with its own gradient', /stroke=\{`url\(#slice-\$\{a\.group\}\)`\}/.test(code), true);
check('the gradient runs along the arc, not across the box', /x1=\{from\.x\}[\s\S]{0,120}y2=\{to\.y\}/.test(code), true);
check(
  'a full circle gets a fallback direction rather than a zero-length gradient',
  /a\.end - a\.start > 0\.999/.test(code),
  true,
);
/* ------------------------------------------- nothing on the ring is see-through */

/*
 * The whole reason the tips read as discs stuck onto the ring.
 *
 * A tip is a circle sitting on the last half-stroke of its own body. With
 * translucent paint that overlap composites a colour over ITSELF — 0.96 over
 * 0.96 is 0.998 — so the region came out darker than the arc it belongs to, at
 * every join. Opaque, the same overlap is invisible: the top colour is the
 * colour, which is all it was ever meant to be.
 *
 * Asserted on the source because it is a property of what is DRAWN, and the one
 * way it comes back is somebody reaching for stopOpacity again to soften an
 * edge.
 */
check('no stop is translucent', /stopOpacity/.test(code), false);
check('the start is a mixed colour', /stopColor=\{mixHex\(GROUP_COLORS\[a\.group\], colors\.line, CHART_FADE\)\}/.test(code), true);
check('...and the end is the palette colour itself', /<Stop offset="1" stopColor=\{GROUP_COLORS\[a\.group\]\} \/>/.test(code), true);
check('the tip is filled, never faded', /fillOpacity|opacity=\{/.test(code), false);

/*
 * The mix itself lives in lib/color-mix now, shared with the two stacked bars,
 * and check-stacked-bar owns its arithmetic. What stays here is that the donut
 * asks for it against the right things: its own palette, and the track it
 * actually sits on — mixing toward the card instead would be a start colour
 * that is subtly wrong in exactly one theme.
 */
check('the wash is mixed toward the track, not the card', /colors\.line, CHART_FADE/.test(code), true);
check('...using the shared mixer', /import \{ CHART_FADE, mixHex \} from "@\/lib\/color-mix"/.test(code), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
