import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Stop } from "react-native-svg";

import { GROUP_COLORS, groupLabel, type BalanceSlice } from "@/lib/nutrition";
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
 * The caps overlap on purpose, and that is a reversal
 * ---------------------------------------------------------------------------
 *
 * This drew butt caps, with a comment explaining that round ones "overlap their
 * neighbour at every boundary, which on a five-slice ring is five wrong colours
 * a few px wide". That was true of round caps added on their own, and it is the
 * reason the two changes below have to arrive together rather than one at a
 * time.
 *
 * A round cap extends STROKE/2 past each end of its dash. Left alone, every
 * slice paints a whole stroke-width longer than the number it represents — on
 * a five-slice ring, 80px of invention on a 276px circumference. So each dash
 * is SHORTENED by exactly what the caps add back, less a small deliberate
 * OVERLAP, and the offset is nudged by half the difference so the painted arc
 * stays centred on the angles the data actually describes. The ring is
 * therefore still honest to the fraction; only the joins are soft.
 *
 * The overlap reads as intentional because it is consistent: SVG paints in
 * document order, so each slice's leading cap lands on top of the one before
 * it. Every join except one — the wrap at twelve o'clock, where the last slice
 * would otherwise sit on top of the first and that single seam would face the
 * other way. The first slice is drawn a second time at the end to fix it, which
 * costs one <Circle> and is the whole of the trick.
 *
 * ---------------------------------------------------------------------------
 * Why the gradients are built from opacity rather than from two hex values
 * ---------------------------------------------------------------------------
 *
 * Each slice fades from a wash of its colour into the full colour, along the
 * direction it travels — the gradient's endpoints are the arc's own start and
 * end points on the circle, so it follows the sweep instead of running flat
 * across the box.
 *
 * A second, lighter hex per group would mean five more colours to keep in step
 * with the five that already mean something on the list screen, and they would
 * be wrong in one theme or the other: a tint chosen against white goes muddy on
 * a dark card. Opacity stops let the card's own background do the lightening,
 * so the same two stops read as light-to-saturated on white and as
 * deep-to-saturated on black, with one palette.
 */

/** Diameter in dp. Sized to sit beside the legend, not to dominate the card. */
const SIZE = 104;
/** Ring thickness. Thick enough to carry colour, thin enough to leave a middle. */
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * How far each slice bleeds over the one before it, in px of arc.
 *
 * Six is about a third of the stroke: enough that the joins read as soft
 * rather than as a rendering artefact, small enough that a reader tracing a
 * boundary still lands within a percent of the truth.
 */
const OVERLAP = 6;

/** The wash each slice starts from. See the note on opacity stops above. */
const FADE = 0.45;

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
 * The dash and offset that paint one slice, round caps included.
 *
 * Exported and pure because it is the one part of this component that can be
 * wrong without looking wrong. A donut is read as proportions, so an arc that
 * is a stroke-width too long is a chart quietly lying by a few percent — and
 * nothing on screen says so. check-donut asserts the painted extent lands on
 * the fraction; see it for the arithmetic written the other way round.
 *
 * `dash + STROKE` is what actually appears, because a round cap adds STROKE/2
 * at each end. Subtracting STROKE gives an honest arc; adding OVERLAP back
 * gives the deliberate bleed, split evenly across the two ends by the offset.
 */
export function arcDash(
  startFraction: number,
  fraction: number,
): { dash: number; gap: number; offset: number } {
  const length = fraction * CIRCUMFERENCE;
  // Floored at 1px: a group with a handful of items still deserves to be
  // visible, and the caps render it as a dot — which is honest about being
  // small, where a sub-pixel sliver would just look like a gap in the ring.
  const dash = Math.max(1, length - STROKE + OVERLAP);
  return {
    dash,
    gap: Math.max(0, CIRCUMFERENCE - dash),
    offset: -(startFraction * CIRCUMFERENCE + (STROKE - OVERLAP) / 2),
  };
}

/**
 * The patch that fixes the wrap, and why it cannot just be the slice again.
 *
 * Every adjacent pair wants the earlier slice on top — including the pair that
 * wraps twelve o'clock, where the LAST slice has to sit above the first. That
 * is a cycle (A above B above C above A) and no painting order satisfies it, so
 * one seam always needs a patch. This is that patch.
 *
 * Redrawing the whole last slice on top is the obvious version and is wrong for
 * the same reason the reversal exists: it would put that slice's own faded
 * leading cap over its neighbour's saturated end, moving the mud from one seam
 * to another rather than removing it. So only the TAIL is redrawn — a stub
 * whose painted extent ends exactly where the slice's does, sampling the
 * gradient where it is fully saturated.
 *
 * Clamped to the slice's own dash, because a group of one item has a dash of a
 * single pixel: an unclamped stub would be wider than the slice it belongs to
 * and would spill its colour backwards over the neighbour.
 */
export function seamCap(slice: {
  dash: number;
  offset: number;
}): { dash: number; gap: number; offset: number } {
  /*
   * Positioned from the slice's OWN dash and offset rather than recomputed
   * from its end fraction, which is not the same thing once the dash has been
   * floored. A group of one item wants a dash of -7px and gets 1px, so it
   * paints a little past where its fraction ends — deliberately, as a visible
   * dot. A stub placed at the theoretical end would then sit several pixels
   * short of the dot it is meant to cap, and the seam would show a step.
   *
   * check-donut caught exactly that; the first version of this function took
   * an end fraction.
   */
  const sliceEnd = -slice.offset + slice.dash + STROKE / 2;
  const dash = Math.min(OVERLAP, slice.dash);
  return {
    dash,
    gap: Math.max(0, CIRCUMFERENCE - dash),
    offset: -(sliceEnd - dash - STROKE / 2),
  };
}

/** Test seams: check-donut re-derives the painted extent from these. */
export const __DONUT = { SIZE, STROKE, R, CIRCUMFERENCE, OVERLAP, FADE };

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
                  <Stop offset="0" stopColor={GROUP_COLORS[a.group]} stopOpacity={FADE} />
                  <Stop offset="1" stopColor={GROUP_COLORS[a.group]} stopOpacity={1} />
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
              REVERSED, so the saturated end of each slice lands on top of the
              faded start of the next one.

              Painted forwards — the obvious order — every join is the other way
              round: the next slice's leading cap is a translucent wash, and it
              goes over the previous slice's fully saturated end. Two things go
              wrong at once and they look like one. The dark end stops reading
              as opaque, because something see-through is sitting on it; and the
              overlap muddies, because a 45%-opacity brown over a solid grey is
              neither colour. The ring looked dirty at every boundary.

              Reversed, the only thing ever painted over another slice is a cap
              at full opacity, and the translucent starts have nothing under
              them but the track. The wash still reads as a wash; the joins read
              as one colour ending on top of another.

              The wrap then needs the LAST slice redrawn on top rather than the
              first: painting backwards puts the first slice highest, so twelve
              o'clock would be the one seam facing the wrong way. Only when
              there is more than one slice — a single one overlapping itself
              would put a cap in the middle of a solid ring.
            */}
            {[...arcs].reverse().map((a) => {
              const { dash, gap, offset } = arcDash(a.start, a.end - a.start);
              return (
                <Circle
                  key={a.group}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={`url(#slice-${a.group})`}
                  strokeWidth={STROKE}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={offset}
                />
              );
            })}
            {/*
              The wrap seam, last of all. See seamCap: with the slices painted
              backwards the first one sits highest, so twelve o'clock is the one
              boundary where the earlier slice would otherwise be underneath.
            */}
            {arcs.length > 1
              ? (() => {
                  const last = arcs[arcs.length - 1];
                  const cap = seamCap(arcDash(last.start, last.end - last.start));
                  return (
                    <Circle
                      cx={SIZE / 2}
                      cy={SIZE / 2}
                      r={R}
                      stroke={`url(#slice-${last.group})`}
                      strokeWidth={STROKE}
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${cap.dash} ${cap.gap}`}
                      strokeDashoffset={cap.offset}
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
