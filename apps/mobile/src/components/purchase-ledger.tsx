import { useRef, useState } from "react";
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
import {
  amountLabel,
  historyFor,
  unitPriceParts,
  type Purchase,
} from "@/lib/purchase-log";
import { useLocale } from "@/store/locale";
import { radii, spacing, type, useScrollIndicator, useTheme } from "@/theme";

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
  const scrollIndicator = useScrollIndicator();
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

  /*
   * What to draw, which stops being "the open item" the moment it closes.
   *
   * This is the staple-sheet bug, in the one component that still had it. The
   * Pantry closes this by clearing the name it looks the history up by, and the
   * old code answered with `if (!name) return null` — tearing the whole Sheet
   * down on the closing frame. Sheet's own exit animation cannot help when the
   * thing being unmounted IS Sheet, so the ledger did not animate away: it
   * stopped existing. The entrance was missing for the mirror-image reason,
   * `visible` being hardcoded true, so Sheet mounted already-open and had
   * nothing to animate from.
   *
   * So keep the last name to have been open, render it until the close animation
   * is over, and let `visible` carry the actual state.
   */
  const last = useRef<{ name: string; category: ItemCategory } | null>(null);
  if (name) last.current = { name, category };

  const snapshot = last.current;
  if (!snapshot) return null;
  const rows = historyFor(purchases, snapshot.name);

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
      visible={name != null}
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
          {/* Snapshot, not the live props: those go null on the closing
              frame and the title would blink out a beat before the sheet. */}
          <ItemEmoji name={snapshot.name} category={snapshot.category} size={22} />
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
              {snapshot.name}
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
          {...scrollIndicator}
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
          {rows.map((p, i) => {
            const brand = p.brand?.trim() || null;
            const desc = p.description?.trim() || null;
            // Whether the row has anything to call itself besides its date.
            const named = brand != null || desc != null;
            const headline = brand ?? desc ?? dateOf(p.at);
            const sub = brand != null ? desc : null;
            const amount = amountLabel(p);
            const each = unitPriceParts(p);
            return (
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
              {/*
                Led by the BRAND, because that is what a column of these is
                scanned for — "which one did I buy last time, and was it the
                cheaper one". The name of the item is already at the top of the
                sheet; repeating it on every row would spend the loudest line on
                the one fact the reader arrived knowing.

                Three shapes, from the same two fields:

                  brand + description  brand leads, description under it
                  description only     it leads (loose produce names itself)
                  neither              the DATE leads, and the row is exactly
                                       what it was before any of this

                That last one is most of a typical history — a purchase logged
                by ticking an item off carries no brand and never will — so it
                gets the plain shape rather than a placeholder apologising for
                being ordinary.
              */}
              <View style={styles.grow}>
                <Text style={[type.body, styles.headline, { color: colors.ink }]} numberOfLines={1}>
                  {headline}
                </Text>
                {sub != null && (
                  <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                    {sub}
                  </Text>
                )}
                <View style={styles.meta}>
                  {p.store != null ? (
                    <SupermarketBadge store={p.store} size={16} />
                  ) : (
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t("ledger.noStore")}
                    </Text>
                  )}
                  {/* Only when the headline is not already the date. */}
                  {named && (
                    <Text style={[type.sub, { color: colors.muted }]}>{dateOf(p.at)}</Text>
                  )}
                </View>
              </View>

              {/*
                The figures, right-aligned as a column so they can be read down
                rather than across: total, how much of it, and what that comes to
                per kilo or per litre.
              */}
              <View style={styles.figures}>
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

                {/*
                  Through amountLabel, which is what fixed this row. It printed
                  `quantity` and `unit` alone — the size of ONE pack — so four
                  litres of milk arrived in the history as "1 l". The pack count
                  was in the database the whole time with no way to reach the
                  screen.
                */}
                {amount != null && (
                  <Text style={[type.sub, { color: colors.muted }]}>{amount}</Text>
                )}

                {/*
                  The comparison, and the reason for splitting brand off the
                  name in the first place. A total cannot answer "was that one
                  cheaper" across two different pack sizes; this can, and it is
                  the only figure here worth the accent.

                  "each" for a count, because "€0.53 / pcs" is not how anybody
                  says it — and that word is already translated.
                */}
                {each != null && (
                  <Text style={[type.sub, styles.each, { color: colors.accent }]}>
                    {money(each.cents)}
                    {each.unit === "pcs" ? ` ${t("itemSheet.each")}` : ` / ${each.unit}`}
                  </Text>
                )}
              </View>
            </View>
            );
          })}
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
    // Top, not centre: the two columns are different heights now — three lines
    // of words against one to three figures — and centring them makes the date
    // drift up and down the row depending on how much the receipt knew.
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  headline: { fontWeight: "700" },
  // Read DOWN, so the totals line up whatever is under them.
  figures: { alignItems: "flex-end" },
  each: { fontWeight: "600" },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
});
