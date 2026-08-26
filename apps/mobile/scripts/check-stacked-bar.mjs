#!/usr/bin/env node
/**
 * The two weighted bars — "In your basket" and "Your climate mix" — and the
 * colour mixing all three charts share.
 *
 * ---------------------------------------------------------------------------
 * Why a bar gets its own check
 * ---------------------------------------------------------------------------
 *
 * Same reason the donut does. A stacked bar is read as proportions and nothing
 * on screen states them, so a boundary a few percent off is a chart lying with
 * no symptom — it still looks like a bar, the legend still says 27%, and the
 * segment beside it is simply a little bigger than it should be.
 *
 * The specific way that happens here is worth naming, because it is the
 * implementation anyone would reach for first. Rounded segments have to overlap
 * or their caps leave notches, and the natural way to overlap flex children is
 * a negative margin. Flex then redistributes the space that margin frees up in
 * proportion to the shares, so every boundary moves by a different amount:
 * three equal thirds put the first join two thirds of a bar-height late. This
 * asserts the geometry the component actually uses, which is percentages for
 * the shares and pixels for the overlap, kept in separate boxes.
 *
 * Run with `pnpm --filter mobile check:stacked-bar`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const BAR = join(SRC, 'components', 'stacked-bar.tsx');
const MIX = join(SRC, 'lib', 'color-mix.ts');

let failures = 0;
function check(what, actual, expected, tol = 1e-9) {
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}

async function lift(file, patterns) {
  const src = readFileSync(file, 'utf8');
  const parts = patterns.map((re) => src.match(re));
  if (parts.some((p) => !p)) {
    console.error(`could not lift the geometry out of ${file} — has it moved?`);
    process.exit(1);
  }
  const { outputText } = ts.transpileModule(parts.map((p) => p[0]).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const barSrc = readFileSync(BAR, 'utf8');
const mixSrc = readFileSync(MIX, 'utf8');

/*
 * Source assertions read a comment-stripped copy. These files explain at length
 * why they do NOT do certain things, so a check for the absence of one of those
 * things matches the sentence saying it was removed — which fails open, and has
 * already happened once in check-donut.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bar = strip(barSrc);
const mix = strip(mixSrc);

const { barBoxes } = await lift(BAR, [
  /^export const BAR_H = .*$/m,
  // `\n}$` and not `\n}`: a parameter written as an inline object type closes
  // with `}): {` at the start of a line too, and the looser pattern truncates
  // the function at its own signature — the import then comes back undefined
  // and everything below passes by testing nothing.
  /^export function barBoxes\([\s\S]*?\n\}$/m,
]);
const { mixHex, CHART_FADE } = await lift(MIX, [
  /^export const CHART_FADE = .*$/m,
  /^export function mixHex\([\s\S]*?\n\}$/m,
  /^function channels\([\s\S]*?\n\}$/m,
]);

const BAR_H = Number(barSrc.match(/^export const BAR_H = (\d+)/m)[1]);

/* --------------------------------------- the bar stays true to the numbers */

/**
 * What a reader sees, in percent. A segment's box IS its visible span: the
 * underlap is added in pixels by the child and lands beneath the segment
 * before it, so it can never widen what shows.
 */
function visible(boxes, i) {
  return { from: boxes[i].left, to: 100 - boxes[i].right };
}

{
  const mixShares = [0.32, 0.27, 0.18, 0.14, 0.09];
  const boxes = barBoxes(mixShares);
  let start = 0;
  mixShares.forEach((share, i) => {
    const v = visible(boxes, i);
    const pct = Math.round(share * 100);
    check(`${pct}% starts where the one before it ended`, v.from, start * 100);
    check(`${pct}% shows exactly its own share`, v.to - v.from, share * 100);
    start += share;
  });
  check('the segments leave no space between them', boxes.length, mixShares.length);
}

/*
 * The last segment is pinned to the right edge rather than left where the
 * running total lands. Five rounded fractions do not sum to 1, and the few
 * thousandths short would show as a sliver of track inside a rounded corner —
 * which reads as the bar failing to finish rather than as rounding.
 */
{
  const short = [0.333, 0.333, 0.333];
  const boxes = barBoxes(short);
  check('a bar whose shares fall short still reaches the end', boxes[2].right, 0);
  const over = [0.4, 0.4, 0.4];
  check('and one that overshoots does not wrap', barBoxes(over)[2].right, 0);
  check('...nor does any box get a negative inset', barBoxes(over).every((b) => b.right >= 0), true);
}

/* ------------------------------------------------------- the underlap ---- */

/*
 * Only the first segment sits flush. Every other one has to hang back under its
 * neighbour, or its left cap curves away from full height with nothing behind
 * it and the join shows a notch top and bottom.
 */
{
  const boxes = barBoxes([0.5, 0.3, 0.2]);
  check('the first segment does not underlap', boxes[0].underlaps, false);
  check('the second does', boxes[1].underlaps, true);
  check('and the third', boxes[2].underlaps, true);
}

/*
 * A WHOLE bar-height, not half of one, and this is the number that was worth
 * checking. Two caps overlapping by half meet as two arcs crossing rather than
 * one filling the other: at the midpoint each is at sin(60°) of full height, so
 * the join is waisted by about a pixel top and bottom and reads as a rendering
 * fault. A full height puts the incoming cap entirely behind the outgoing
 * segment's square middle.
 */
check('the pill hangs back a full bar-height', /left: box\.underlaps \? -BAR_H : 0/.test(bar), true);
check('...measured from the same number as the height', /borderRadius: BAR_H \/ 2/.test(bar), true);
check('...and it lengthens rather than slides', /right: 0, borderRadius/.test(bar), true);

/* ------------------------------------------------- percentages, not flex -- */

/*
 * The flex-with-negative-margins version is the one that silently distorts.
 * Nothing in this component may size a segment by flex.
 */
check('segments are positioned, not flexed', /flex:/.test(bar), false);
check('the box carries the share as a percentage', /left: `\$\{box\.left\}%`, right: `\$\{box\.right\}%`/.test(bar), true);
check('the bar never measures itself', /onLayout|useWindowDimensions/.test(bar), false);

/* ------------------------------------------------------ paint order ------ */

/*
 * Earlier segments on top, so a join shows a saturated cap over a washed start.
 * Forwards, each pale left end would land on the previous segment's darkest
 * point and the fade would appear to run backwards.
 */
check('the segments paint back to front', /\.reverse\(\)/.test(bar), true);

/* ------------------------------------------------------- nothing fades --- */

/*
 * The reason lib/color-mix exists. Translucency accumulates instead of
 * overwriting, so anywhere two shapes overlap — which here is every single
 * join, by design — the same colour composites over itself and comes out
 * darker. That is what made the donut's tips read as discs.
 */
check('no segment is translucent', /opacity/i.test(bar), false);
check('the wash is a mixed colour', /mixHex\(seg\.color, colors\.line, CHART_FADE\)/.test(bar), true);
check('...running into the palette colour itself', /CHART_FADE\), seg\.color\]/.test(bar), true);
check('the gradient runs along the bar, not down it', /start=\{\{ x: 0, y: 0\.5 \}\}[\s\S]{0,60}end=\{\{ x: 1, y: 0\.5 \}\}/.test(bar), true);

/* ------------------------------------------------------------- the mixer - */

{
  const GREEN = '#5FA85A';
  const LINE = '#414A3B';
  check('a full mix is the colour itself', mixHex(GREEN, LINE, 1), GREEN.toLowerCase());
  check('an empty mix is the surface under it', mixHex(GREEN, LINE, 0), LINE.toLowerCase());
  check('the wash sits between them', mixHex(GREEN, LINE, CHART_FADE), '#4f7449');
  check('it always returns six digits', mixHex('#000000', '#ffffff', 0.5).length, 7);
  // Shorthand expands by doubling, not by zero-padding — #abc is #aabbcc. Got
  // wrong, a shorthand colour would mix against something near black and look
  // like a rendering fault rather than a parsing one.
  check('shorthand hex expands by doubling', mixHex('#abc', '#abc', 1), '#aabbcc');
  check('an amount over 1 clamps', mixHex(GREEN, LINE, 4), GREEN.toLowerCase());
  check('a negative amount clamps', mixHex(GREEN, LINE, -2), LINE.toLowerCase());
  check('no channel escapes a byte', /Math\.max\(0, Math\.min\(1, amount\)\)/.test(mix), true);
}

/* --------------------------------------------- both cards use this one --- */

/*
 * They were the same twenty lines twice. If either grows its own bar again the
 * two will drift, and the drift will be in a chart nobody re-reads.
 */
for (const rel of ['components/balance-bar.tsx', 'components/eco-bar.tsx']) {
  const text = strip(readFileSync(join(SRC, rel), 'utf8'));
  check(`${rel} draws the shared bar`, /<StackedBar/.test(text), true);
  check(`...and keeps no bar of its own`, /flexDirection: ['"]row['"],?\s*height: 16/.test(text), false);
}

/*
 * The climate bar sized itself from `counts` while its legend printed `shares`
 * — the same figures by construction, and exactly the pair that stays in step
 * only until somebody changes how a share is weighted.
 */
{
  const eco = strip(readFileSync(join(SRC, 'components', 'eco-bar.tsx'), 'utf8'));
  check('the climate bar draws the shares it prints', /share: shares\[tier\]/.test(eco), true);
  check('...not the raw counts', /share: counts\[tier\]/.test(eco), false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
