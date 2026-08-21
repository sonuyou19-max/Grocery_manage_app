import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BalanceDonut } from "@/components/balance-donut";
import { EmptyState } from "@/components/empty-state";
import { Frosted } from "@/components/frosted";
import { ItemEmoji } from "@/components/item-emoji";
import { MeshBackground } from "@/components/mesh-background";
import { usePlusGate } from "@/lib/plus-gate";
import {
  basketBalance,
  foodGroupOf,
  GROUP_COLORS,
  groupLabel,
  type DisplayGroup,
} from "@/lib/nutrition";
import { hasStopped, lastBoughtLabel, type ItemStat } from "@/lib/pantry-intel";
import { useLocale } from "@/store/locale";
import { usePantryIntel } from "@/store/pantry-intel";
import { spacing, type, useTheme } from "@/theme";

/**
 * What is actually in the pantry, behind the Insights card's ring.
 *
 * The sibling of app/basket.tsx, and deliberately the same page: same grid,
 * same sticky frosted headings, same cascade. Two screens that answer "what is
 * in there, grouped by kind?" should not be two different experiences, and the
 * reasoning behind every choice here is written up there — a route rather than
 * a sheet, sections walked from the slices so the list reads in the bar's
 * order, two columns because names are the content.
 *
 * ---------------------------------------------------------------------------
 * What differs, and why
 * ---------------------------------------------------------------------------
 *
 * The SOURCE. The basket is rows on lists; this is the pantry model, which is
 * one entry per thing the household buys rather than one per shopping row. So
 * items the user has stopped buying are excluded — Korb keeps their history
 * but leaves them out of everything forward-looking, and counting them would
 * describe a pantry you do not have. Same filter the Insights card applies.
 *
 * The RING rather than the bar. The basket card shows a bar and its page shows
 * a bar; this card shows a donut, so its page shows a donut. Continuity with
 * the thing you just tapped is the point of the header chart, and swapping the
 * shape halfway through the gesture would break exactly that.
 *
 * The SUBTITLE under each name. The basket shows an amount, because a shopping
 * row carries a quantity. A pantry entry does not — it carries a history — so
 * this shows when the item was last bought, which is the same field the Vibe
 * Check deck reads and the most useful thing the model knows about an item you
 * are looking at rather than buying.
 */
const COLUMNS = 2;

export default function PantryMixScreen() {
  const { colors } = useTheme();
  const { t } = useLocale();
  const { stats } = usePantryIntel();
  const { locked } = usePlusGate();
  const insets = useSafeAreaInsets();

  /*
   * The card that opens this is hidden for a free account, so the only way in
   * is a deep link or a stale back-stack. Redirect rather than render a locked
   * shell: the Insights tab makes the offer once, at its foot, and a second
   * paywall reached by surprise is worse than not arriving.
   */
  const items = useMemo(
    () => Object.values(stats).filter((s) => !hasStopped(s)),
    [stats],
  );

  // The same call the card makes, on the same input, so the ring here and the
  // ring there cannot disagree.
  const { slices, total } = useMemo(
    () =>
      basketBalance(items.map((s) => ({ name: s.display, category: s.category }))),
    [items],
  );

  const now = Date.now();

  const sections = useMemo(() => {
    const byGroup = new Map<DisplayGroup, ItemStat[]>();
    for (const s of items) {
      const g = foodGroupOf(s.display, s.category);
      if (!g) continue;
      const bucket = byGroup.get(g);
      if (bucket) bucket.push(s);
      else byGroup.set(g, [s]);
    }
    /*
     * Rows of cells, not cells — SectionList has no numColumns, and chunking
     * here is what keeps the sticky headings a FlatList would have cost.
     * `order` runs across the whole page so the entrance cascades once rather
     * than restarting at every heading.
     */
    let order = 0;
    return slices.map((s) => {
      const bucket = byGroup.get(s.group) ?? [];
      // Most recently bought first, so the top of each group is the part of the
      // pantry that is actually live. The basket has no equivalent ordering to
      // borrow — its rows arrive in list order, which is the order they were
      // typed in.
      bucket.sort((a, b) => b.lastPurchasedAt - a.lastPurchasedAt);
      const rows: { key: string; order: number; cells: ItemStat[] }[] = [];
      for (let i = 0; i < bucket.length; i += COLUMNS) {
        const cells = bucket.slice(i, i + COLUMNS);
        rows.push({ key: cells[0].key, order: order++, cells });
      }
      return { group: s.group, fraction: s.fraction, data: rows };
    });
  }, [items, slices]);

  if (locked) return <Redirect href="/(tabs)/insights" />;

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={["top"]}>
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
              {t("insights.pantryMixTitle")}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("insights.basketHint", { count: total })}
            </Text>
          </View>
        </View>

        {total === 0 ? (
          <EmptyState
            icon="file-tray-full-outline"
            title={t("pantryMix.emptyTitle")}
            body={t("pantryMix.emptyBody")}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(row) => row.key}
            stickySectionHeadersEnabled
            // No rail down the side, matching app/basket.tsx. These two pages
            // are the pair that hides it; the rest of the app shows it
            // deliberately, so do not "fix" either to match them.
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + spacing.xxl },
            ]}
            ListHeaderComponent={
              <View style={styles.summary}>
                <BalanceDonut slices={slices} total={total} />
              </View>
            }
            renderSectionHeader={({ section }) => (
              /* `over="mesh"` is the translucent fill: rows should be visible
                 sliding under the heading, which is the point of a sticky one.
                 On Android Frosted is a wash rather than a live blur — see
                 scripts/check-blur.mjs for why the app has none. */
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
                // On the ROW, not the cell: two cells entering a frame apart
                // reads as a stutter rather than a cascade. Capped at twelve
                // steps, or the fortieth row of a big pantry waits over a
                // second and the flourish reads as the screen being slow.
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
                {row.cells.map((cell) => (
                  <View key={cell.key} style={styles.cell}>
                    {/* ItemEmoji subscribes to the lexicon itself, so a glyph
                        that arrives after a sync appears without this screen
                        knowing. */}
                    <ItemEmoji name={cell.display} category={cell.category} />
                    <View style={styles.cellText}>
                      {/* Two lines: in a half-width cell a single truncating
                          line loses the end of most real grocery names, and
                          the name is the whole content of the row. */}
                      <Text
                        style={[type.body, { color: colors.ink }]}
                        numberOfLines={2}
                      >
                        {cell.display}
                      </Text>
                      <Text style={[type.sub, { color: colors.muted }]}>
                        {lastBoughtLabel(cell.lastPurchasedAt, now, t)}
                      </Text>
                    </View>
                  </View>
                ))}
                {/* Keeps a lone last cell at half width instead of letting it
                    stretch across the page and stop looking like a grid. */}
                {row.cells.length < COLUMNS && <View style={styles.cell} />}
              </Animated.View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
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
  // Room under the chart before the first heading, so the summary reads as its
  // own thing rather than as the top of the first group.
  summary: { paddingBottom: spacing.xl },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    // Bleeds into the list's own horizontal padding so the frosted strip
    // reaches both edges; without it rows slide past in the uncovered margins.
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
  cellText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});
