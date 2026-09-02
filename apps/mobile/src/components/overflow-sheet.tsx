import { Children, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet, SheetHandle } from "@/components/sheet";
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
 * sizes down to its rows rather than stranding them above blank space. See
 * purchase-ledger.tsx for why the cap is a measured number and not a
 * percentage.
 *
 * ---------------------------------------------------------------------------
 * Why the list's own ceiling is measured too, and is not 380
 * ---------------------------------------------------------------------------
 *
 * That sizing work capped the CARD correctly and left the ScrollView's own
 * `maxHeight: 380` alone, which was inherited from `staples-sheet` and is not a
 * design intent — it is a number from a phone nobody wrote down. It is the
 * lower of the two ceilings on every device made since, so it, not the card,
 * is what decides how much list you get.
 *
 * On a 874dp screen that puts the sheet at roughly 512dp: eleven rows, a third
 * of the screen left empty ABOVE a sheet that has been told it may use 699dp,
 * and the rest of the list beyond the fold. Reported as "I can't scroll up this
 * list, it feels stuck", which is the right description — a sheet that is
 * plainly not full, with a list that plainly is.
 *
 * So the ceiling on the list is the room the card actually has: the cap, less
 * the chrome around it. The chrome is MEASURED, for purchase-ledger's reason —
 * the title wraps at large font scales and in longer languages, and a constant
 * subtracted for it is wrong on exactly the devices where the room is
 * tightest. The estimates below are only what paints on the first frame, before
 * onLayout has fired; the sheet is still travelling in for another 220ms, so a
 * correction lands inside the entrance rather than after it.
 */

/**
 * First-frame guesses, replaced by real measurements a frame later.
 *
 * The handle's 28dp plus a line of h2, a line of sub, and the gaps between
 * them; and the Done row, a line of body text under its own padding.
 *
 * Deliberately a little LARGE: over-guessing the chrome makes the first frame's
 * list slightly short, which corrects invisibly, while under-guessing overshoots
 * the card and gets clipped by the GlassView for that frame.
 */
const HEAD_ESTIMATE = 92;
const FOOT_ESTIMATE = 36;

/**
 * The least list worth showing, whatever the arithmetic says.
 *
 * A short screen at the largest font scale can drive `cardCap - chrome` down to
 * a couple of rows or, with a title wrapped to three lines, past zero. Better
 * to overflow the 80% by a little and stay scrollable than to render a sheet
 * with a sliver of list in it.
 */
const MIN_SCROLL = 160;

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

  const [headHeight, setHeadHeight] = useState(HEAD_ESTIMATE);
  const [footHeight, setFootHeight] = useState(FOOT_ESTIMATE);

  const cardCap = Math.round(windowHeight * 0.8);
  /*
   * Everything in the card that is not the list: the two measured blocks, the
   * card's own padding — the bottom of which carries the gesture bar — and the
   * two gaps that sit either side of the ScrollView. Subtracted rather than
   * approximated, because this figure IS the list's ceiling and anything left
   * out of it is list that gets clipped.
   */
  const chrome =
    headHeight + footHeight + spacing.lg * 2 + insets.bottom + spacing.sm * 2;
  const scrollCap = Math.max(MIN_SCROLL, cardCap - chrome);

  return (
    <Sheet visible={visible} onClose={onClose} scrim gutter={0} motion="slide">
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
        {/* Handle and title measured together, as one block — they are what
            sits above the list, and two onLayouts to add up would be two
            numbers that can disagree about the gap between them. */}
        <View
          style={styles.head}
          onLayout={(e: LayoutChangeEvent) =>
            setHeadHeight(e.nativeEvent.layout.height)
          }
        >
          <SheetHandle />
          <Text style={[type.h2, { color: colors.ink }]}>{title}</Text>
          {/*
            How many rows there are, which is the other half of "it feels
            stuck".

            A clipped list and a complete one look identical here: both end at
            the bottom of the card, and the scroll indicator only appears once
            you are already dragging. So a reader who expected more has no way
            to tell whether the sheet is holding rows back or simply has none —
            and the honest answer to that question is a number.

            Counted off the children rather than passed in, because the caller
            has already said it once by rendering them and two counts that can
            disagree is worse than none. toArray, not Children.count: the call
            sites render four conditional branches, and count would score the
            three false ones as children.
          */}
          <Text style={[type.sub, { color: colors.muted }]}>
            {t("common.inTotal", { count: Children.toArray(children).length })}
          </Text>
        </View>
        <ScrollView
          // The measured ceiling, not a constant: see the note above. flexGrow
          // 0 keeps a SHORT list at its own height, so this is a ceiling and
          // never a floor — three staples still get a three-row sheet.
          style={[styles.scroll, { maxHeight: scrollCap }]}
          contentContainerStyle={styles.list}
          {...scrollIndicator}
        >
          {children}
        </ScrollView>
        <Pressable
          onPress={onClose}
          style={styles.done}
          hitSlop={8}
          onLayout={(e: LayoutChangeEvent) =>
            setFootHeight(e.nativeEvent.layout.height)
          }
        >
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
  // The numeric maxHeight is applied inline (scrollCap, from the window and the
  // measured chrome). These two are the static half: shrink so the cap can
  // squeeze the list, grow 0 so a short one keeps its own height.
  head: { gap: spacing.sm },
  scroll: { flexGrow: 0, flexShrink: 1 },
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
