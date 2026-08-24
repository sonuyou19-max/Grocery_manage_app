import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Safe } from "@/components/safe";

import { BalanceBar } from "@/components/balance-bar";
import { EmptyState } from "@/components/empty-state";
import { Frosted } from "@/components/frosted";
import { ItemEmoji } from "@/components/item-emoji";
import { MeshBackground } from "@/components/mesh-background";
import {
  basketBalance,
  basketItems,
  foodGroupOf,
  GROUP_COLORS,
  groupLabel,
  type DisplayGroup,
} from "@/lib/nutrition";
import { useGroceries } from "@/store/groceries";
import { useLocale } from "@/store/locale";
import { spacing, type, useTheme } from "@/theme";

/**
 * What is actually in the basket, behind the Insights card's summary bar.
 *
 * ---------------------------------------------------------------------------
 * A route, not a sheet
 * ---------------------------------------------------------------------------
 *
 * Everything else that expands on this tab is a bottom sheet, and this one is
 * deliberately not. A sheet is for a longer look at something you are still
 * reading — it keeps the page behind it and you come straight back. This is a
 * different question ("what is in there?") answered by a screen's worth of
 * grouped, scrollable content with its own sticky chrome, and a sheet holding
 * that would be a screen wearing a sheet's clothes. So it pushes, with a back
 * arrow, and behaves like every other pushed route in the app.
 *
 * ---------------------------------------------------------------------------
 * Why the sections come from the slices
 * ---------------------------------------------------------------------------
 *
 * The sections are built by walking `slices` — the very array the bar at the
 * top is drawn from — rather than by grouping the items independently. Two
 * consequences, both wanted:
 *
 *   * the section order matches the bar's order, largest group first, so the
 *     list reads in the same order as the picture above it;
 *   * anything basketBalance does not count cannot appear in the list either.
 *     It counts FOOD only, so washing-up liquid is in your basket but not in
 *     this breakdown — and a list that showed it under a heading with a
 *     percentage would be claiming it was part of a percentage it is not.
 *
 * That second point is the one worth not undoing later: the header says N food
 * items for exactly that reason.
 */
/**
 * Cells per row.
 *
 * Two, because the cell has to hold an emoji, a name that people actually read,
 * and sometimes an amount. At three the name column is under 100dp and almost
 * every item truncates, which trades the page's length for its legibility —
 * the wrong way round, since the names are the content.
 */
const COLUMNS = 2;

export default function BasketScreen() {
  const { colors, scheme } = useTheme();
  const { t } = useLocale();
  const { lists } = useGroceries();
  const insets = useSafeAreaInsets();

  // Not `lists.flatMap(l => l.items)`: that counted rows already ticked off,
  // which are purchases the Pantry owns. See basketItems.
  const items = useMemo(() => basketItems(lists), [lists]);

  // The same call the card makes, on the same input, so the bar here and the
  // bar there cannot disagree.
  const { slices, total } = useMemo(
    () =>
      basketBalance(items.map((it) => ({ name: it.name, category: it.category }))),
    [items],
  );

  const sections = useMemo(() => {
    // One pass to bucket, rather than a filter per group: a big shared list is
    // a real size and this runs on every render of the screen.
    const byGroup = new Map<DisplayGroup, typeof items>();
    for (const it of items) {
      const g = foodGroupOf(it.name, it.category);
      if (!g) continue;
      const bucket = byGroup.get(g);
      if (bucket) bucket.push(it);
      else byGroup.set(g, [it]);
    }
    /*
     * A section's `data` is ROWS of items, not items.
     *
     * SectionList has no numColumns — that is FlatList only — so the grid is
     * made by chunking here and rendering a row of cells per entry. Doing it
     * this way rather than switching to a FlatList keeps the sticky headings,
     * which are the thing that makes a long grouped page navigable and are
     * exactly what a flattened FlatList would have cost.
     *
     * `order` is a running index across the WHOLE page, so the entrance
     * cascades down the screen instead of restarting at each heading — five
     * groups each starting their own wave reads as five animations rather than
     * one. It counts ROWS now, since a row is what enters.
     */
    let order = 0;
    return slices.map((s) => {
      const bucket = byGroup.get(s.group) ?? [];
      const rows: { key: string; order: number; cells: typeof items }[] = [];
      for (let i = 0; i < bucket.length; i += COLUMNS) {
        const cells = bucket.slice(i, i + COLUMNS);
        rows.push({ key: cells[0].id, order: order++, cells });
      }
      return { group: s.group, fraction: s.fraction, data: rows };
    });
  }, [items, slices]);

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Safe style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]}>
              {t("insights.basketTitle")}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("insights.basketHint", { count: total })}
            </Text>
          </View>
        </View>

        {total === 0 ? (
          <EmptyState
            icon="nutrition-outline"
            title={t("basket.emptyTitle")}
            body={t("basket.emptyBody")}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(row) => row.key}
            stickySectionHeadersEnabled
            // Asked for explicitly: no rail down the side of this page. It is
            // the one screen here that hides it — the rest of the app shows it
            // deliberately, so do not "fix" this to match them.
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.list,
              // Clear of the system gesture bar. This route covers the tab bar,
              // so the inset is all that is under the last row.
              { paddingBottom: insets.bottom + spacing.xxl },
            ]}
            ListHeaderComponent={
              <View style={styles.summary}>
                <BalanceBar slices={slices} />
              </View>
            }
            renderSectionHeader={({ section }) => (
              /* `over="mesh"` is the translucent fill, not the opaque one: rows
                 should be visible sliding under the heading, which is the point
                 of a sticky header. On iOS Frosted is a real blur; on Android
                 it is a 90% wash, because a live blur there costs a full-screen
                 snapshot per frame and this app spent a release removing them
                 (see scripts/check-blur.mjs). Translucent is free and reads as
                 the same idea. */
              <Frosted over="mesh" style={styles.sectionHead}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: GROUP_COLORS[section.group] },
                  ]}
                />
                <Text style={[type.label, { color: colors.ink }]}>
                  {groupLabel(section.group, t)}
                </Text>
                <Text style={[type.label, { color: colors.muted }]}>
                  {"·"} {Math.round(section.fraction * 100)}%
                </Text>
              </Frosted>
            )}
            renderItem={({ item: row, index, section }) => (
              <Animated.View
                // On the ROW, not the cell: two cells entering side by side a
                // frame apart reads as a stutter rather than a cascade.
                //
                // Capped at twelve steps. Uncapped, the fortieth row of a big
                // shop waits over a second to appear, which stops reading as a
                // flourish and starts reading as the screen being slow.
                entering={FadeInDown.delay(
                  Math.min(row.order, 12) * 28,
                ).duration(240)}
                style={[
                  styles.gridRow,
                  index < section.data.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.line,
                  },
                ]}
              >
                {row.cells.map((cell) => {
                  const amount = amountLabel(cell);
                  return (
                    <View key={cell.id} style={styles.cell}>
                      {/* ItemEmoji subscribes to the lexicon itself, so a glyph
                          that arrives after a sync appears without this screen
                          knowing. */}
                      <ItemEmoji name={cell.name} category={cell.category} />
                      <View style={styles.cellText}>
                        {/* Two lines, not one. In a half-width cell a single
                            truncating line loses the end of most real grocery
                            names ("Coriander powder", "Olio extravergine"),
                            and the name is the whole content of the row. */}
                        <Text
                          style={[type.body, { color: colors.ink }]}
                          numberOfLines={2}
                        >
                          {cell.name}
                        </Text>
                        {amount ? (
                          <Text style={[type.sub, { color: colors.muted }]}>
                            {amount}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
                {/* Keeps a lone last cell at half width instead of letting it
                    stretch across the page and stop looking like a grid. */}
                {row.cells.length < COLUMNS && <View style={styles.cell} />}
              </Animated.View>
            )}
          />
        )}
      </Safe>
    </View>
  );
}

/**
 * "500 g", "2 pcs", or nothing at all.
 *
 * Both fields are optional and independent: an item can carry a unit with no
 * number (never useful on its own, so it is dropped) or a number with no unit,
 * which is a bare count and reads correctly as one.
 */
function amountLabel(item: { quantity: number | null; unit: string | null }) {
  if (item.quantity == null) return null;
  return item.unit ? `${item.quantity} ${item.unit}` : String(item.quantity);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: "transparent" },
  grow: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg },
  // Room under the bar before the first heading, so the summary reads as its
  // own thing rather than as the top of the first group.
  summary: { paddingBottom: spacing.xl },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    // Bleeds into the list's own horizontal padding so the frosted strip
    // reaches both edges of the screen; without this the rows slide past in
    // the uncovered margins either side of it.
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  gridRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // Equal columns: basis 0 so the two share the row evenly whatever their
  // content, which is the one place a zero basis is what you want.
  cell: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // grow/shrink rather than `flex: 1`: the cell above already fixed the width,
  // so this only has to take what is left beside the emoji without forcing the
  // name to zero.
  cellText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});
