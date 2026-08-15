import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BalanceBar } from "@/components/balance-bar";
import { EmptyState } from "@/components/empty-state";
import { Frosted } from "@/components/frosted";
import { ItemEmoji } from "@/components/item-emoji";
import { MeshBackground } from "@/components/mesh-background";
import {
  basketBalance,
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
export default function BasketScreen() {
  const { colors, scheme } = useTheme();
  const { t } = useLocale();
  const { lists } = useGroceries();
  const insets = useSafeAreaInsets();

  const items = useMemo(() => lists.flatMap((l) => l.items), [lists]);

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
    // `order` is a running index across the WHOLE list, because the entrance
    // stagger has to cascade down the screen rather than restart at each
    // heading — five groups each starting their own wave reads as five
    // separate animations rather than one.
    let order = 0;
    return slices.map((s) => ({
      group: s.group,
      fraction: s.fraction,
      data: (byGroup.get(s.group) ?? []).map((it) => ({ item: it, order: order++ })),
    }));
  }, [items, slices]);

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
            keyExtractor={(row) => row.item.id}
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
            renderItem={({ item: row, index, section }) => {
              const amount = amountLabel(row.item);
              return (
                <Animated.View
                  // Capped at twelve steps. Uncapped, the fortieth row of a big
                  // shop waits over a second to appear, which stops reading as a
                  // flourish and starts reading as the screen being slow.
                  entering={FadeInDown.delay(
                    Math.min(row.order, 12) * 28,
                  ).duration(240)}
                  style={[
                    styles.row,
                    index < section.data.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.line,
                    },
                  ]}
                >
                  {/* Emoji and name are one cell, tight together, so the
                      amount on the right is the only thing the row's own gap
                      separates. Every other item row in the app carries this —
                      ItemEmoji subscribes to the lexicon itself, so a glyph that
                      arrives after a sync appears without this screen knowing. */}
                  <View style={styles.nameCell}>
                    <ItemEmoji name={row.item.name} category={row.item.category} />
                    <Text
                      style={[type.body, styles.grow, { color: colors.ink }]}
                      numberOfLines={1}
                    >
                      {row.item.name}
                    </Text>
                  </View>
                  {amount ? (
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {amount}
                    </Text>
                  ) : null}
                </Animated.View>
              );
            }}
          />
        )}
      </SafeAreaView>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // grow/shrink rather than `flex: 1`: identical here, because the row has a
  // definite width from the list, but it stays correct if this ever sits in a
  // content-sized parent — where a zero basis renders the name at no width at
  // all. That exact mistake shipped once, in balance-donut's legend.
  nameCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
});
