import { StyleSheet, Text, View } from "react-native";

import {
  GROUP_COLORS,
  groupLabel,
  type BalanceSlice,
} from "@/lib/nutrition";
import { StackedBar } from "@/components/stacked-bar";
import { useLocale } from "@/store/locale";
import { spacing, type, useTheme } from "@/theme";

/**
 * A stacked, weighted bar of food-group slices with a percentage legend.
 *
 * Lived inside the Insights screen until the basket detail page needed to
 * repeat it at the top — the page opens from the card, so showing anything but
 * the same bar would make the reader check whether they were still looking at
 * the same figures. One definition, so they cannot drift.
 *
 * The pantry's version of this idea is a donut (components/balance-donut.tsx).
 * The two are deliberately different shapes for different questions: a basket
 * is a handful of items you are about to buy and reads left to right, a pantry
 * is a standing composition of a whole. The BAR itself is components/
 * stacked-bar — shared with the climate mix, which was drawing the same twenty
 * lines a second time.
 */
export function BalanceBar({ slices }: { slices: BalanceSlice[] }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  return (
    <View style={styles.root}>
      <StackedBar
        segments={slices.map((s) => ({
          key: s.group,
          share: s.fraction,
          color: GROUP_COLORS[s.group],
        }))}
      />
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.group} style={styles.legendItem}>
            <View
              style={[styles.dot, { backgroundColor: GROUP_COLORS[s.group] }]}
            />
            <Text style={[type.sub, { color: colors.ink }]}>
              {groupLabel(s.group, t)} {Math.round(s.fraction * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
