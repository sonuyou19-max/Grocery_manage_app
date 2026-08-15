import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/components/sheet";
import { GlassView } from "@/components/glass";
import { useT } from "@/store/locale";
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

export interface StapleRow {
  key: string;
  display: string;
  times: number;
}

/**
 * The full staples list, when five is not enough.
 *
 * A sheet rather than a route: this is a longer look at a card you are already
 * reading, not a place you navigate to, and pushing a screen for it would put a
 * back button in the way of a glance. It also means the card keeps its range —
 * the sheet shows whatever window the card was showing, because a list that
 * silently switched to "all time" on expand would not be the same list the
 * reader asked to see more of.
 */
export function StaplesSheet({
  visible,
  staples,
  onClose,
}: {
  visible: boolean;
  staples: StapleRow[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const t = useT();

  /*
   * A real ceiling on the card, in pixels, derived from the window.
   *
   * The ScrollView's own 380 is a preference — how much list to show on a
   * phone with room for it — and on its own it was the card's ONLY height
   * rule. Add the grabber, the title, the Done row and the padding and the
   * card wants roughly 520dp, which fits a normal phone and does not fit a
   * short one or a normal one at a large font scale. GlassView clips
   * (`overflow: hidden`), so what overflowed was silently cut off: the bottom
   * of the scroll area, and the Done button with it. A clipped strip still
   * belongs to the ScrollView as far as layout is concerned but is not on
   * screen, so a drag that starts there does nothing at all — which is what
   * "sometimes it gets stuck" looks like from the outside.
   *
   * Capping the card is what makes the shrink chain terminate. See
   * purchase-ledger for the long version of why this is a measured number
   * rather than a percentage: everything above this card in Sheet is sized
   * from its content, so a '80%' here would have to resolve through several
   * layers of "ask my content how tall I am" first.
   */
  const cardCap = Math.round(windowHeight * 0.8);

  return (
    <Sheet visible={visible} onClose={onClose} scrim gutter={0}>
      <GlassView
        over="content"
        radius={radii.lg}
        style={[
          styles.card,
          {
            maxHeight: cardCap,
            // The card meets the bottom of the screen (gutter 0), so the
            // gesture bar is its floor. Was a flat 32, which happens to clear
            // a three-button navbar and not a gesture one.
            paddingBottom: spacing.lg + insets.bottom,
          },
        ]}
      >
        <View style={styles.grabber} />
        <Text style={[type.h2, { color: colors.ink }]}>
          {t("insights.staplesTitle")}
        </Text>
        {/* Bounded height, not flex: the sheet must not grow past the
                screen on a household with a hundred tracked items, and the
                scroll has to live inside the card rather than under it.

                flexShrink is the half that was missing. RN defaults it to 0,
                so the cap above could only ever be honoured by clipping this
                view — it refused to give up the height itself. flexGrow: 0
                keeps the other direction, so a list shorter than the cap sizes
                down to its rows instead of stranding them above blank space. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          {...scrollIndicator}
        >
          {staples.map((s, i) => (
            <View key={s.key} style={styles.row}>
              <Text style={[type.sub, styles.rank, { color: colors.muted }]}>
                {i + 1}
              </Text>
              <Text
                style={[type.body, styles.grow, { color: colors.ink }]}
                numberOfLines={1}
              >
                {s.display}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("insights.boughtTimes", { count: s.times })}
              </Text>
            </View>
          ))}
        </ScrollView>
        <Pressable onPress={onClose} style={styles.done} hitSlop={8}>
          <Text style={[type.body, { color: colors.accent }]}>
            {t("common.done")}
          </Text>
        </Pressable>
      </GlassView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    // Lets cardCap squeeze the card rather than the card overflowing it. The
    // cap is applied inline, since it is computed from the window at render.
    flexShrink: 1,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.4)",
    marginBottom: spacing.xs,
  },
  scroll: { maxHeight: 380, flexGrow: 0, flexShrink: 1 },
  // A row's worth of room under the last entry, so the end of the list reads
  // as the end of the list rather than as something cut off by the Done row.
  list: { paddingBottom: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  rank: { width: 22, fontVariant: ["tabular-nums"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  done: { alignSelf: "center", paddingTop: spacing.sm },
});
