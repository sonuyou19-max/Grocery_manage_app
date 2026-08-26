import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Stop } from "react-native-svg";

import { GROUP_COLORS, groupLabel, type BalanceSlice } from "@/lib/nutrition";
import { CHART_FADE, mixHex } from "@/lib/color-mix";
import { useLocale } from "@/store/locale";
import { spacing, type, useTheme } from "@/theme";

/**
 * The pantry's food-group mix: a donut with the count in the middle, and a
 * legend that reads down rather than across.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the stacked bar
 * ---------------------------------------------------------------------------
 *
 * "In your basket" and "Your pantry mix" rendered the same BalanceBar, which
 * made two cards answering different questions look like the same card twice.
 * They are not the same question: the basket is *this shop*, a small set the
 * reader is about to buy, and a bar reading left-to-right suits a handful of
 * items. The pantry is the *standing* mix of everything tracked, which is a
 * composition of a whole — the thing a ring is actually for — and it has a
 * total worth stating, which the bar had nowhere to put.
 *
 * So the bar stays where it belongs and this takes the pantry. Same palette,
 * deliberately: the dots on the list screen mean these colours, and a second
 * scheme for the same five groups would break that association to no purpose.
 *
 * ---------------------------------------------------------------------------
 * How the ring is drawn
 * ---------------------------------------------------------------------------
 *
 * One <Circle> per slice, all on the same path, separated by dash pattern
 * rather than by arc maths: each is dashed as `[its own length, the rest of the
 * circumference]` and pushed around by a negative dash offset equal to
 * everything before it. No trigonometry for the SLICES, no path strings, and —
 * the reason it is worth preferring — no seams, because every slice is the same
 * circle.
 *
 * The group rotates -90° so the ring starts at twelve o'clock. SVG angles begin
 * at three, and a composition that starts at the right edge reads as though the
 * first slice were the second.
 *
 * ---------------------------------------------------------------------------
 * Rounded at the end only, and why that cannot be a linecap
 * ---------------------------------------------------------------------------
 *
 * A slice should finish in a round tip and START square, tucked under the slice
 * before it. That is the shape of every ring chart people like the look of, and
 * SVG will not draw it: `strokeLinecap` applies to BOTH ends of a dash, so a
 * round cap that softens the end also puts a translucent bulge on the start.
 *
 * Round at both ends was what this drew, and it is what looked wrong. Two
 * semicircles meet at every boundary, so the join is a lens of overlapping
 * colour rather than one arc ending against another — and each slice's leading
 * bulge is the faded end of its gradient, laid over its neighbour's saturated
 * one.
 *
 * So the two ends are drawn by two different things:
 *
 *   BODY  a butt-capped dash. Flat at both ends, and it is the honest length.
 *   TIP   a filled circle of the stroke's own diameter, sitting on the
 *         centre-line at the arc's end. A cap is exactly that circle, so this
 *         is not an approximation of one — it is the same shape, drawn where
 *         only one end needs it.
 *
 * ---------------------------------------------------------------------------
 * Where the flat end goes, which is the whole of the alignment
 * ---------------------------------------------------------------------------
 *
 * A round tip narrows away from the full ring width over its last STROKE/2. If
 * the next slice began at the boundary with a flat edge, the crescent the tip
 * vacates would show the track through it — a dark notch at every join, which
 * is the gap this arrangement exists to avoid.
 *
 * So every body is pulled back by STROKE/2 and starts underneath the previous
 * slice's tip, exactly where that tip's rounding begins. The full-width
 * rectangle fills the crescent; the tip is painted over it; the boundary a
 * reader sees is the curve of the tip and nothing else.
 *
 * The arithmetic stays honest through it. A slice covers `[p0 - STROKE/2, p1]`,
 * of which the leading STROKE/2 is under its neighbour, so what is VISIBLE is
 * exactly `[p0, p1]` — its own fraction, no correction term, nothing to tune.
 * The half-stroke of underlap is the overlap: there is no separate OVERLAP
 * constant any more, because the geometry produces one.
 *
 * SVG paints in document order and the slices go back to front, so each tip
 * lands on the body after it. Every join but one: the wrap at twelve o'clock,
 * where the last slice's tip has to sit above the first slice's body and the
 * painting order has already put the first slice highest. That one tip is drawn
 * a second time at the end, which costs one <Circle> and is the whole of the
 * trick.
 *
 * ---------------------------------------------------------------------------
 * Nothing is translucent, and that is what stopped the tips reading as blobs
 * ---------------------------------------------------------------------------
 *
 * Each slice fades from a wash of its colour into the full colour, along the
 * direction it travels — the gradient's endpoints are the arc's own start and
 * end points on the circle, so it follows the sweep instead of running flat
 * across the box.
 *
 * That wash used to be built from opacity stops: one hex per group, 45% alpha
 * at the start, 100% at the end, and the surface underneath doing the
 * lightening. One palette, correct in both themes, and it made the tips look
 * like stickers.
 *
 * Translucency does not overwrite, it accumulates. The tip is a circle sitting
 * on the last half-stroke of its own body, so wherever the two overlapped, the
 * same colour was composited over itself: 0.96 over 0.96 is 0.998, and that
 * region came out visibly darker than the arc it belongs to. Not a colour
 * clash — a colour on top of ITSELF, which is why it read as a disc stuck to
 * the ring rather than as the end of an arc. Every join had one.
 *
 * So the wash is now a real colour: the group's hue mixed toward the track it
 * sits on, at the same 45%, computed rather than picked — see lib/color-mix,
 * which the two stacked bars share, since the same fix applies to them. It looks like what the
 * alpha version looked like, because it is the same arithmetic — done once, in
 * advance, instead of by the compositor every time something overlaps.
 *
 * The reason it was alpha in the first place still holds and is why this is a
 * mix and not five new hex values in the palette. Five hand-picked tints would
 * be five more colours to keep in step with the five that already mean
 * something on the list screen, and a tint chosen against white goes muddy on a
 * dark card. Mixing against `colors.line` gets both: one palette, and a start
 * colour that is correct in whichever theme is running.
 *
 * With nothing translucent anywhere, an overlap is simply the top colour
 * winning — which is all it was ever meant to be.
 */

/** Diameter in dp. Sized to sit beside the legend, not to dominate the card. */
const SIZE = 104;
/** Ring thickness. Thick enough to carry colour, thin enough to leave a middle. */
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Where a fraction sits on the circle, in the SVG's own coordinates.
 *
 * Deliberately computed BEFORE the -90° rotation and left for the group
 * transform to turn along with the arc it belongs to. Rotating the gradient
 * separately would mean two places that have to agree about where twelve
 * o'clock is.
 */
function pointAt(fraction: number): { x: number; y: number } {
  const angle = fraction * 2 * Math.PI;
  return {
    x: SIZE / 2 + R * Math.cos(angle),
    y: SIZE / 2 + R * Math.sin(angle),
  };
}

/**
 * The butt-capped body of one slice.
 *
 * Exported and pure because it is the one part of this component that can be
 * wrong without looking wrong. A donut is read as proportions, so an arc a
 * stroke-width too long is a chart quietly lying by a few percent, and nothing
 * on screen says so. check-donut re-derives the painted extent from what this
 * returns; see it for the arithmetic written the other way round.
 *
 * The dash is the slice's TRUE length — butt caps add nothing, so there is no
 * correction to make and none to get wrong. The offset is the only interesting
 * part: it starts the body half a stroke EARLY, under the previous slice's
 * round tip, so the crescent that tip narrows away from is filled by full-width
 * colour rather than by the track. See the note above.
 */
export function arcBody(
  startFraction: number,
  fraction: number,
): { dash: number; gap: number; offset: number } {
  // Floored at 1px so a group with a handful of items still has a body under
  // its tip, rather than a sub-pixel sliver the renderer may drop entirely.
  const dash = Math.max(1, fraction * CIRCUMFERENCE);
  return {
    dash,
    gap: Math.max(0, CIRCUMFERENCE - dash),
    offset: -(startFraction * CIRCUMFERENCE - STROKE / 2),
  };
}

/**
 * Where the round tip sits, as a fraction of the circle.
 *
 * A cap is a circle of the stroke's diameter centred ON the centre-line, so to
 * reach exactly the slice's end the centre goes half a stroke short of it. The
 * tip then covers `[p1 - STROKE, p1]` and the slice finishes where its number
 * says it does.
 *
 * Clamped forward to the slice's own start, for the case that has caught every
 * previous version of this file: a group of one item is shorter than the cap
 * that draws it. Unclamped, its tip would be centred BEFORE its start and the
 * dot would sit inside the previous slice, wearing the wrong neighbour's
 * position. Clamped, a tiny group reads as a dot at its own start — overstating
 * its size, which it must, since a dot is the smallest thing a ring can show,
 * and doing so in the right place.
 */
export function tipFraction(startFraction: number, fraction: number): number {
  const end = (startFraction + fraction) * CIRCUMFERENCE - STROKE / 2;
  return Math.max(startFraction * CIRCUMFERENCE, end) / CIRCUMFERENCE;
}

/** Test seams: check-donut re-derives the painted extent from these. */
export const __DONUT = { SIZE, STROKE, R, CIRCUMFERENCE, FADE: CHART_FADE };

export function BalanceDonut({
  slices,
  total,
}: {
  slices: BalanceSlice[];
  total: number;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();

  /*
   * Every slice measured up front, so the JSX below only draws.
   *
   * `start` is the running fraction, which is what both the dash offset and the
   * gradient's endpoints are derived from — one source for where a slice sits,
   * rather than the arc and its gradient each doing their own arithmetic and
   * drifting apart by a rounding error.
   */
  const arcs = useMemo(() => {
    let start = 0;
    return slices.map((s) => {
      const arc = { group: s.group, start, end: start + s.fraction };
      start += s.fraction;
      return arc;
    });
  }, [slices]);

  return (
    <View style={styles.root}>
      <View style={styles.chart}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            {arcs.map((a) => {
              /*
               * A single slice filling the ring has the same start and end
               * point, which is a zero-length gradient — SVG paints those as
               * flat, and the one case where the ring is a solid colour is the
               * one where the gradient would be most visible if it worked. So
               * a full circle is given the box's own diagonal instead.
               */
              const full = a.end - a.start > 0.999;
              const from = full ? { x: 0, y: 0 } : pointAt(a.start);
              const to = full ? { x: SIZE, y: SIZE } : pointAt(a.end);
              return (
                <LinearGradient
                  key={a.group}
                  id={`slice-${a.group}`}
                  gradientUnits="userSpaceOnUse"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                >
                  {/* Two opaque colours, not one colour at two opacities. The
                      first is the group's hue already mixed into the track, so
                      it looks like a wash without behaving like one. */}
                  <Stop offset="0" stopColor={mixHex(GROUP_COLORS[a.group], colors.line, CHART_FADE)} />
                  <Stop offset="1" stopColor={GROUP_COLORS[a.group]} />
                </LinearGradient>
              );
            })}
          </Defs>
          <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
            {/* A track under the slices. With one dominant group and a 1%
                straggler the ring would otherwise appear to have a gap in it
                wherever rounding left one, and a broken ring reads as a
                rendering fault rather than as a small number. */}
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={colors.line}
              strokeWidth={STROKE}
              fill="none"
            />
            {/*
              REVERSED, so each slice's tip lands on the body of the one after
              it — which is the arrangement the whole shape depends on. Painted
              forwards, every body would sit on top of the tip it is supposed to
              be tucked under: the round end would be sliced flat by its
              neighbour and the ring would be back to butt joins with extra
              steps.

              It is also what keeps the gradients readable. The only thing ever
              painted over another slice is a tip, which is sampled where the
              gradient is fully saturated; the faded starts have nothing under
              them but the track. Forwards, a 45%-opacity wash would land on a
              solid colour at every boundary — the dark end would stop reading
              as opaque and the join would turn to mud, which is what this
              looked like before.
            */}
            {[...arcs].reverse().map((a) => {
              const body = arcBody(a.start, a.end - a.start);
              const tip = pointAt(tipFraction(a.start, a.end - a.start));
              return (
                <G key={a.group}>
                  <Circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    stroke={`url(#slice-${a.group})`}
                    strokeWidth={STROKE}
                    fill="none"
                    /* Butt, and the tip below is why. A round cap here would
                       put the same bulge on the START, which is the shape being
                       removed. */
                    strokeLinecap="butt"
                    strokeDasharray={`${body.dash} ${body.gap}`}
                    strokeDashoffset={body.offset}
                  />
                  {/* The cap, as the circle a cap actually is. Filled with the
                      slice's own gradient, which at this end of the sweep is at
                      its saturated stop — so the tip is the darkest part of the
                      slice, and it is the part that sits on top. */}
                  <Circle cx={tip.x} cy={tip.y} r={STROKE / 2} fill={`url(#slice-${a.group})`} />
                </G>
              );
            })}
            {/*
              The wrap, last of all. Every pair wants the earlier slice's tip
              above the later slice's body, including the pair that straddles
              twelve o'clock — where the LAST slice has to sit above the first.
              That is a cycle, and no painting order satisfies it, so one seam
              always needs a patch.

              It is just the tip again. Nothing else is redrawn: putting the
              whole slice back on top would lay its own faded body over its
              neighbour's saturated tip, which is the mud this order exists to
              avoid — it would move the problem to a different seam rather than
              solve it.

              Only when there is more than one slice. A single slice already
              paints its tip after its own body, so the wrap is covered.
            */}
            {arcs.length > 1
              ? (() => {
                  const last = arcs[arcs.length - 1];
                  const tip = pointAt(tipFraction(last.start, last.end - last.start));
                  return (
                    <Circle
                      cx={tip.x}
                      cy={tip.y}
                      r={STROKE / 2}
                      fill={`url(#slice-${last.group})`}
                    />
                  );
                })()
              : null}
          </G>
        </Svg>
        {/* Absolutely centred rather than laid out inside the SVG: RN's SVG
            text has its own font resolution and would not match the rest of
            the card at the same token. */}
        <View style={styles.centre} pointerEvents="none">
          <Text style={[type.h2, { color: colors.ink }]}>{total}</Text>
          {/* Not type.label, which is uppercase and letter-spaced: "ARTIKEL
              GESAMT" sets about 110dp wide and the hole in this ring is 72.
              Its own small style, capped to the hole and allowed to wrap, so
              the longest translation takes two lines instead of running out
              over the stroke. */}
          <Text style={[styles.centreLabel, { color: colors.muted }]}>
            {t("insights.mixTotal")}
          </Text>
        </View>
      </View>

      {/* One row per group, so the labels stay readable at any text size — the
          bar's legend wrapped mid-phrase in German once the fifth group
          appeared. The percentage is right-aligned into its own column, which
          is what lets the eye compare five numbers down a line instead of
          hunting for them after five labels of different lengths. */}
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.group} style={styles.legendRow}>
            <View
              style={[styles.dot, { backgroundColor: GROUP_COLORS[s.group] }]}
            />
            <Text
              style={[type.sub, styles.legendLabel, { color: colors.ink }]}
              numberOfLines={1}
            >
              {groupLabel(s.group, t)}
            </Text>
            <Text style={[type.sub, styles.percent, { color: colors.muted }]}>
              {Math.round(s.fraction * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * space-evenly, and the reason is that the two obvious answers are each
   * wrong in the other's direction.
   *
   * A legend at `flex: 1` reaches the right margin, so the percentages sit out
   * there and English — "Fats", "Carbs" — leaves a hand's width between a label
   * and its number. Sizing the legend to its content fixes that and moves the
   * problem: the pair now hugs the left of the card and the dead space
   * collects at the right edge, which is worse, because an edge void reads as
   * a layout that failed rather than as spacing.
   *
   * Both are the same mistake — letting the length of five English words decide
   * where things land. space-evenly takes the decision away from the text: the
   * ring and the legend keep their natural widths, and whatever is left over is
   * divided equally before, between and after them. The card is balanced by
   * construction in every locale, and the percentages stay next to the labels
   * they belong to. `gap` stays as a floor for the narrow case, where there is
   * no slack to distribute and the two would otherwise touch.
   */
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    gap: spacing.md,
  },
  chart: { width: SIZE, height: SIZE },
  centre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // Tight under the number so the two read as one label, and never wider than
  // the hole the ring leaves (SIZE - STROKE * 2, less a little breathing room).
  centreLabel: {
    marginTop: -1,
    maxWidth: SIZE - STROKE * 2 - 6,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 13,
  },
  /*
   * Sized to its own content, NOT `flex: 1`.
   *
   * Stretching it to the card's right margin is what put a hand's width of
   * empty space between "Produce" and "40%" — the eye then has to travel the
   * gap to pair a label with its number, and the labels read as crowded
   * against the ring by comparison, because all the air in the row had
   * collected on the wrong side of them.
   *
   * Content-sized, the legend is as wide as its widest row, and `flex: 1` on
   * the label inside each row still right-aligns every percentage to that same
   * edge. So the numbers stay a column — which is the point of them being
   * right-aligned at all — but the column sits just past the longest label
   * instead of out at the margin. flexShrink lets it give way on a narrow
   * screen or a long translation rather than pushing the ring off the card.
   */
  legend: { flexShrink: 1, minWidth: 0, gap: spacing.xs },
  legendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  /*
   * flexGrow + flexShrink, and NOT the `flex: 1` shorthand. This shipped as
   * `flex: 1` and every label rendered at zero width — a legend of dots and
   * percentages with the names missing entirely.
   *
   * `flex: 1` expands to `flexGrow: 1, flexShrink: 1, flexBasis: 0`, and a
   * basis of 0 says "my content contributes nothing to how wide I want to be".
   * That is harmless while the parent is stretched by something else, which is
   * why this idiom is safe everywhere else in the app. It is fatal here,
   * because the legend above is deliberately sized BY its content: the rows
   * reported a width of dot + gaps + percentage, the labels were allotted what
   * was left of that, which is nothing, and Text at zero width draws nothing.
   *
   * Leaving the basis at `auto` means each label asks for its own text width,
   * the legend sizes to the widest row, and flexGrow then pulls every label out
   * to that same width — so the percentages still align as a column, which was
   * the entire point. Verified against Yoga rather than a browser: browsers
   * size a shrink-to-fit flex container by looking through a zero basis at the
   * content anyway, so a CSS mock of this renders correctly and is worthless as
   * evidence. That mock is exactly what let this ship.
   */
  legendLabel: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: spacing.lg,
  },
  percent: { fontVariant: ["tabular-nums"] },
});
