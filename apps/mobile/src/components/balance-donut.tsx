import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

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
 * everything before it. No trigonometry, no path strings, and — the reason it
 * is worth preferring — no seams, because every slice is the same circle.
 *
 * The group rotates -90° so the ring starts at twelve o'clock. SVG angles begin
 * at three, and a composition that starts at the right edge reads as though the
 * first slice were the second.
 */

/** Diameter in dp. Sized to sit beside the legend, not to dominate the card. */
const SIZE = 104;
/** Ring thickness. Thick enough to carry colour, thin enough to leave a middle. */
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function BalanceDonut({
  slices,
  total,
}: {
  slices: BalanceSlice[];
  total: number;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();

  // Running start for each slice, in px along the circumference.
  let travelled = 0;

  return (
    <View style={styles.root}>
      <View style={styles.chart}>
        <Svg width={SIZE} height={SIZE}>
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
            {slices.map((s) => {
              const length = s.fraction * CIRCUMFERENCE;
              const offset = -travelled;
              travelled += length;
              return (
                <Circle
                  key={s.group}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={GROUP_COLORS[s.group]}
                  strokeWidth={STROKE}
                  fill="none"
                  // Butt caps, not round: rounded ends overlap their neighbour
                  // at every boundary, which on a five-slice ring is five
                  // wrong colours a few px wide.
                  strokeLinecap="butt"
                  strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                  strokeDashoffset={offset}
                />
              );
            })}
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
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
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
  // Claims the slack within the legend's own width, so the percentages line up
  // with each other rather than trailing each label at a ragged edge.
  legendLabel: { flex: 1, minWidth: 0, marginRight: spacing.lg },
  percent: { fontVariant: ["tabular-nums"] },
});
