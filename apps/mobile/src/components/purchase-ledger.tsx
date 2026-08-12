import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/components/sheet";
import { GlassView } from "@/components/glass";
import { ItemEmoji } from "@/components/item-emoji";
import { SupermarketBadge } from "@/components/supermarket-badge";
import { historyFor, type Purchase } from "@/lib/purchase-log";
import { useLocale } from "@/store/locale";
import { radii, spacing, type, useTheme } from "@/theme";

import type { ItemCategory } from "@korb/shared";

/**
 * Every time you bought one thing — the drill-down behind an aggregate card.
 *
 * The aggregates answer "what does this usually cost"; this answers "what
 * actually happened", which is the only place the transaction model becomes
 * visible to the user. Two purchases of the same item at different shops appear
 * as two rows here, which is the whole point of logging them separately.
 *
 * Unpriced purchases are shown, not hidden. They are real events — most
 * shopping in this app is unpriced — and a history that silently omitted them
 * would look like the app had forgotten half your trips. They simply carry no
 * amount, which is honest about what was recorded.
 */
export function PurchaseLedger({
  name,
  category,
  purchases,
  onClose,
}: {
  /** Item to show the history for; null closes the sheet. */
  name: string | null;
  category: ItemCategory;
  purchases: Purchase[];
  onClose: () => void;
}) {
  const { colors, scheme } = useTheme();
  const { t, money } = useLocale();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  /*
   * Why the scroll cap is a MEASURED number, not a percentage on the card.
   *
   * The card used to carry `maxHeight: '80%'` and rely on that squeezing the
   * ScrollView beneath it through Sheet's own wrapping — a Pressable, inside an
   * Animated.View, inside another Pressable, inside the backdrop. None of those
   * intermediate nodes have a height of their own; each is sized from its
   * content, which is exactly the condition under which a percentage height has
   * to be resolved through several layers of "ask my content how tall I am"
   * before Yoga can answer "what's 80% of that".
   *
   * With a long history the content is taller than 80% of the screen, which
   * forces a real, unambiguous number early in that resolution and everything
   * beneath — including the ScrollView — inherits a concrete constraint. With
   * one or two rows the card never approaches the cap, so nothing forces that
   * resolution, and the ScrollView could end up laid out against a stale or
   * degenerate constraint from the layout pass instead of its own content
   * height — the header showing and everything below it clipped, which is
   * exactly what a short history did.
   *
   * Every other capped ScrollView in this app avoids the question entirely by
   * putting a real number directly on the ScrollView itself — see
   * staples-sheet's `maxHeight: 380` and recipe-review-sheet's `maxHeight:
   * 320`. This does the same thing, computed from the window rather than
   * hard-coded, because "80% of the screen" was the actual intent.
   *
   * The header's height is subtracted so the cap describes the SCROLL AREA,
   * not the whole card — capping the card at 80% would leave less room for
   * rows than the design intended once the header is added on top. It is
   * measured via onLayout rather than guessed, because the header's real
   * height depends on the item's name wrapping, the locale's word lengths, and
   * font scaling, none of which a constant could account for. The estimate
   * below is only what paints on the very first frame, before onLayout has
   * fired once; it does not need to be exact, because the sheet is still
   * fading and scaling in for another 220ms after mount, and any correction
   * lands inside that window rather than after it.
   */
  const [headerHeight, setHeaderHeight] = useState(72);
  const onHeaderLayout = (e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  };
  // The safety net around the whole card, same reasoning as scrollCap below:
  // a real number the outer GlassView can size against on its own, rather
  // than a '80%' string it can only resolve by asking its content — which is
  // the ScrollView several layers down — how tall it wants to be first.
  const cardCap = Math.round(windowHeight * 0.8);
  const scrollCap = Math.max(120, cardCap - headerHeight);

  if (!name) return null;
  const rows = historyFor(purchases, name);

  const dateOf = (at: number) =>
    new Date(at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  // bottomClearance carries the safe-area inset: without it the sheet's bottom
  // edge sits directly on the Android gesture bar, which made a one-row history
  // look wedged into the corner.
  return (
    <Sheet
      visible
      onClose={onClose}
      scrim
      gutter={spacing.md}
      bottomClearance={spacing.md + insets.bottom}
    >
      <GlassView
        over="content"
        radius={radii.lg}
        style={[styles.sheet, { maxHeight: cardCap }]}
      >
        <View style={styles.head} onLayout={onHeaderLayout}>
          <ItemEmoji name={name} category={category} size={22} />
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("ledger.subtitle", { count: rows.length })}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          /* Shown, not hidden. A year of shopping is a long list and this is
             the only thing on screen that says it continues below the fold —
             which is exactly what "something is hidden down there" looked
             like when there was no indicator and no room to scroll either. */
          showsVerticalScrollIndicator
          indicatorStyle={scheme === "dark" ? "white" : "black"}
          contentContainerStyle={styles.list}
          // A measured number, not a percentage inherited through Sheet's
          // Animated.View — see the comment above scrollCap for why the
          // percentage version broke for exactly one or two rows. The sheet
          // is only as tall as its rows up to this cap: flexShrink lets the
          // ScrollView size down TO its content, never up past it, so a
          // short history does not leave empty space with the rows stranded
          // at the top.
          style={[styles.scroll, { maxHeight: scrollCap }]}
          bounces={false}
        >
          {rows.map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.row,
                { borderBottomColor: colors.line },
                // No rule under the last row: a divider with nothing beneath
                // it reads as the list having been cut off rather than
                // having ended.
                i === rows.length - 1 && styles.lastRow,
              ]}
            >
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]}>
                  {dateOf(p.at)}
                </Text>
                <View style={styles.meta}>
                  {p.store != null ? (
                    <SupermarketBadge store={p.store} size={16} />
                  ) : (
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t("ledger.noStore")}
                    </Text>
                  )}
                  {p.quantity != null && (
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {p.quantity}
                      {p.unit ? ` ${p.unit}` : ""}
                    </Text>
                  )}
                </View>
              </View>
              {/* An unpriced purchase shows a dash, not a zero: it happened,
                      it just carries no amount, and €0.00 would be a lie that
                      also drags every average it lands in. */}
              <Text
                style={[
                  type.price,
                  { color: p.priceCents == null ? colors.muted : colors.ink },
                ]}
              >
                {p.priceCents == null ? "—" : money(p.priceCents)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </GlassView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The numeric maxHeight is applied inline (cardCap, from useWindowDimensions)
  // — a StyleSheet entry can't hold a value computed at render time. flexShrink
  // stays here as the static half of that pairing, and is what lets the cap
  // actually squeeze the card instead of the card overflowing it.
  sheet: { flexShrink: 1 },
  // Ditto: scrollCap is applied inline, alongside these two statics.
  scroll: { flexGrow: 0, flexShrink: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  grow: { flex: 1, minWidth: 0 },
  // Generous at the bottom: this is the sheet's closing edge and the last row
  // needs room to breathe under it, not a hairline against the rim.
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
});
