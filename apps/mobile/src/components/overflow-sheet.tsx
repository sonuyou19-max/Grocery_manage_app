import type { ReactNode } from "react";
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
import { radii, spacing, type, useScrollIndicator, useTheme } from "@/theme";

/**
 * The rest of a card's list, when what fits on the card is not all of it.
 *
 * ---------------------------------------------------------------------------
 * Why a sheet, and why one sheet
 * ---------------------------------------------------------------------------
 *
 * A sheet rather than a route: this is a longer look at a card you are already
 * reading, not a place you navigate to, and pushing a screen for it would put a
 * back button in the way of a glance. It also means the card keeps its range —
 * the sheet shows whatever window the card was showing, because a list that
 * silently switched to "all time" on expand would not be the same list the
 * reader asked to see more of.
 *
 * This started as `staples-sheet`, hardcoded to staple rows. Four cards on the
 * Insights tab want the same affordance and their rows look nothing alike — a
 * ranked name, a shop badge with a total, a two-line price comparison. So the
 * split is: this owns the CHROME (the scrim, the grabber, the title, the
 * scroll, the sizing, the Done row) and the caller owns the ROWS, passed as
 * children. Generalising over a row shape instead would have meant a union type
 * that grew a case per card, which is the same four components with extra
 * steps.
 *
 * ---------------------------------------------------------------------------
 * The sizing, which is the part worth not re-deriving
 * ---------------------------------------------------------------------------
 *
 * The predecessor's only height rule was `maxHeight: 380` on the ScrollView.
 * RN defaults `flexShrink` to 0, so that view would not give up height for
 * anything, and the card came to roughly 520dp — fine on a normal phone, too
 * tall for a short one or a normal one at a large font scale. GlassView clips,
 * so the overflow was cut silently: the bottom of the list and the Done button
 * with it. A clipped strip still belongs to the ScrollView as far as layout is
 * concerned but is not on screen, so a drag starting there does nothing, which
 * reads to the user as the list being stuck.
 *
 * So: a real pixel cap on the card from the window, `flexShrink: 1` so the cap
 * can actually squeeze, and `flexGrow: 0` so a list SHORTER than the cap still
 * sizes down to its rows rather than stranding them above blank space. The 380
 * goes back to meaning what it reads as — how much list to show when there is
 * room for it. See purchase-ledger.tsx for why the cap is a measured number
 * and not a percentage.
 */
export function OverflowSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  /** The card's own title — this is the same list, not a new place. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const t = useT();

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
            // gesture bar is its floor.
            paddingBottom: spacing.lg + insets.bottom,
          },
        ]}
      >
        <View style={styles.grabber} />
        <Text style={[type.h2, { color: colors.ink }]}>{title}</Text>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          {...scrollIndicator}
        >
          {children}
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

/**
 * A numbered row, for the lists that are a ranking.
 *
 * Offered here rather than left to each caller because the rank column has to
 * line up across sheets, and a width picked separately four times would not.
 */
export function RankedRow({
  rank,
  children,
}: {
  rank: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.rankedRow}>
      <Text style={[type.sub, styles.rank, { color: colors.muted }]}>
        {rank}
      </Text>
      {children}
    </View>
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
  rankedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rank: { width: 22, fontVariant: ["tabular-nums"] },
  done: { alignSelf: "center", paddingTop: spacing.sm },
});
