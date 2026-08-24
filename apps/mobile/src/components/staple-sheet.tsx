import { Ionicons } from "@expo/vector-icons";
import { useRef, type PropsWithChildren } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet, SheetHandle, useSheetDismiss } from "@/components/sheet";
import { GlassView } from "@/components/glass";
import { categoryLabel } from "@/lib/categorize";
import {
  CADENCE_PRESETS,
  effectiveInterval,
  hasUserCadence,
  type ItemStat,
} from "@/lib/pantry-intel";
import { listTint } from "@/lib/list-tint";
import { historyFor, type Purchase } from "@/lib/purchase-log";
import { useT } from "@/store/locale";
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Per-item restock settings: mark it a staple, and pin how often you restock it.
 *
 * Why both, when they sound like one thing:
 *
 * - **Always keep in stock** is a priority claim. It doesn't move the due date —
 *   it decides what wins a place in the capped Vibe Check deck, because running
 *   out of a declared staple is the failure worth preventing first.
 * - **Cadence** is a correction. The engine learns intervals by watching
 *   check-offs, which is wrong when it has no history (it's guessing from the
 *   category) or when it learned from irregular shopping. Setting a number here
 *   overrides it everywhere at once.
 *
 * Keeping them separate matters: you can want a fixed cadence on something
 * that isn't a staple, and mark a staple while still letting Korb learn its
 * rhythm. Collapsing them into one control would take that away.
 */

interface StapleSheetProps {
  item: ItemStat | null;
  onClose: () => void;
  onChange: (patch: {
    keepStocked?: boolean;
    cadenceDays?: number | null;
  }) => void;
  /**
   * "I have stopped buying this" — it leaves every forward-looking reading
   * while keeping its history. The caller closes the sheet.
   */
  onStopBuying: () => void;
  /**
   * Erase the item and its whole history. The caller confirms first and closes
   * the sheet — this component only offers the control, because the warning
   * has to name what else goes with it and only the caller knows that.
   */
  onDelete: () => void;
  /** Every logged purchase, so the sheet can offer this item's history. */
  purchases: Purchase[];
  onOpenHistory: () => void;
  /**
   * The lists this item is currently on, tagged under its name.
   *
   * Answering "where did I put this?" without leaving the Pantry — the moment
   * you want it is the moment you are looking at the item and wondering whether
   * it is already handled. Empty is the normal case for something tracked but
   * not currently needed, and renders nothing.
   */
  lists: { id: string; name: string }[];
}

export function StapleSheet({
  item: openItem,
  onClose,
  onChange,
  onStopBuying,
  onDelete,
  purchases,
  onOpenHistory,
  lists: openLists,
}: StapleSheetProps) {
  const { colors, scheme } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const t = useT();

  /*
   * What to draw, which stops being "the open item" the moment it closes.
   *
   * The Pantry closes this sheet by clearing the key it looks the item up by,
   * so `item` goes null on the same frame `visible` does — and this component
   * used to answer that with `if (!item) return null`, tearing the whole Sheet
   * down before it could play anything. That is why the sheet had no exit at
   * all: it did not animate away, it simply stopped existing. Sheet's own
   * `mounted` cannot help, because the thing being unmounted is Sheet.
   *
   * So the last item to have been open is kept, and rendered until the close
   * animation is over. `lists` rides along with it for the same reason — the
   * tags under the name are derived from the open key too, and would have
   * blinked out a beat before the sheet did.
   */
  const last = useRef<{
    item: ItemStat;
    lists: { id: string; name: string }[];
  } | null>(null);
  if (openItem) last.current = { item: openItem, lists: openLists };

  const snapshot = last.current;
  if (!snapshot) return null;
  const { item, lists } = snapshot;

  const history = historyFor(purchases, item.display);

  const learned = Math.round(effectiveInterval(item));
  const pinned = hasUserCadence(item);

  /*
   * A real pixel ceiling, replacing `maxHeight: '85%'`.
   *
   * The percentage had nothing definite to resolve against: everything above
   * this card in Sheet — a Pressable, an Animated.View, another Pressable — is
   * sized from its own content, so "85% of my parent" asks a parent that is
   * still asking its children. purchase-ledger hit this first and wrote it up;
   * the symptom there and here is the same, a card laid out against a
   * degenerate constraint with its last rows clipped away by GlassView's
   * overflow: hidden. On this sheet that took Done with it, which is the way
   * out of the sheet.
   */
  const cardCap = Math.round(windowHeight * 0.85);

  return (
    // gutter 0 and square bottom corners: this is a bottom sheet that meets the
    // screen edge, the way the list's item sheet does, rather than a card
    // floating inside a margin. Same component, same motion — only the resting
    // shape differs.
    <Sheet
      visible={openItem != null}
      onClose={onClose}
      scrim
      gutter={0}
      motion="slide"
    >
      <GlassView
        over="content"
        radius={radii.lg}
        style={[styles.sheet, { maxHeight: cardCap }]}
      >
        <SheetHandle />
        <ScrollView
          {...scrollIndicator}
          style={styles.scrollArea}
          contentContainerStyle={styles.content}
        >
          <View style={styles.headRow}>
            <View style={styles.grow}>
            {/* Name and list tags share one row, the tags reading as a suffix
                to the name rather than as a separate fact below it — "Pizza,
                which is on Weekly" instead of "Pizza" then "Weekly".

                One tag per list, each in the list's own colour — see
                lib/list-tint for why the colour is hashed from the id rather
                than cycled by position. The row wraps rather than truncating:
                a household with four lists and a long name for each is
                ordinary, and a clipped tag names the wrong list. A long item
                name simply takes the width it needs and pushes the tags onto
                the next line, which is the same layout as before. */}
            <View style={styles.titleRow}>
              <Text
                style={[type.h2, { color: colors.ink }, styles.title]}
                numberOfLines={2}
              >
                {item.display}
              </Text>
              {lists.map((l) => {
                const tint = listTint(l.id, scheme);
                return (
                  <View
                    key={l.id}
                    style={[styles.tag, { backgroundColor: tint.bg }]}
                  >
                    <Text
                      style={[styles.tagText, { color: tint.fg }]}
                      numberOfLines={1}
                    >
                      {l.name}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={[type.sub, { color: colors.muted }]}>
              {categoryLabel(item.category, t)}
            </Text>
            </View>

            {/* The two ways an item leaves the pantry, side by side and in
                that order: stop buying it, or delete it.

                They used to be at opposite ends of the sheet, on the reasoning
                that one is reversible and the other ends the item, so a
                destructive control should not sit at the foot of a list of
                settings where somebody working downwards will hit it. That
                second half still holds and is why neither is down there any
                more — but keeping them apart also hid the reversible one at the
                bottom of a scroll, which made delete the obvious answer to "I
                do not buy this any more" when it is the wrong one.

                Adjacent, they read as a choice. Both muted rather than red: the
                weight belongs in delete's confirmation, and a red button up
                here would shout on a screen opened to change a cadence. */}
            <Pressable
              onPress={onStopBuying}
              accessibilityRole="button"
              accessibilityLabel={t("stopped.action")}
              accessibilityHint={t("stopped.hint")}
              hitSlop={12}
              style={styles.trash}
            >
              <Ionicons name="bag-remove-outline" size={22} color={colors.muted} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t("forget.action", { item: item.display })}
              hitSlop={12}
              style={styles.trash}
            >
              <Ionicons name="trash-outline" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {/* Staple toggle */}
          <View style={[styles.row, { borderColor: colors.line }]}>
            <Ionicons name="bookmark-outline" size={22} color={colors.accent} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>
                {t("staple.keepTitle")}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("staple.keepHint")}
              </Text>
            </View>
            <Switch
              value={item.keepStocked ?? false}
              onValueChange={(v) => onChange({ keepStocked: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>

          {/* Cadence */}
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.muted }]}>
              {t("staple.cadenceTitle")}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {pinned
                ? t("staple.cadencePinned", { count: item.cadenceDays ?? 0 })
                : t("staple.cadenceLearned", { count: learned })}
            </Text>
            <View style={styles.chips}>
              {/* "Learn it" is first and is the default state, so handing
                      control back is never buried behind the presets. */}
              <CadenceChip
                label={t("staple.cadenceAuto")}
                active={!pinned}
                onPress={() => onChange({ cadenceDays: null })}
              />
              {CADENCE_PRESETS.map((days) => (
                <CadenceChip
                  key={days}
                  label={t("staple.everyDays", { count: days })}
                  active={pinned && item.cadenceDays === days}
                  onPress={() => onChange({ cadenceDays: days })}
                />
              ))}
            </View>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("staple.cadenceNote")}
            </Text>
          </View>

          {/* Every time you bought this. The pantry knows the rhythm; the
                  ledger is the evidence behind it, and the place a wrong price
                  or a purchase at the wrong shop becomes visible. */}
          {history.length > 0 && (
            <HistoryRow
              onOpenHistory={onOpenHistory}
              style={[styles.row, { borderColor: colors.line }]}
            >
              <Ionicons
                name="receipt-outline"
                size={22}
                color={colors.accent}
              />
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]}>
                  {t("ledger.openTitle")}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t("ledger.subtitle", { count: history.length })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </HistoryRow>
          )}

        </ScrollView>

        {/* Outside the ScrollView, like the list's item sheet: the way out of a
            sheet must not be something you have to scroll to find. It also
            carries the safe-area inset, because the card now meets the bottom
            of the screen and the gesture bar is its floor. */}
        <Pressable
          onPress={onClose}
          style={[styles.done, { paddingBottom: spacing.sm + insets.bottom }]}
          hitSlop={8}
        >
          <Text style={[type.body, { color: colors.accent }]}>
            {t("common.done")}
          </Text>
        </Pressable>
      </GlassView>
    </Sheet>
  );
}

function CadenceChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.accent : colors.line,
          backgroundColor: active ? colors.accentSoft : colors.surface,
        },
      ]}
    >
      <Text
        style={[type.sub, { color: active ? colors.accent : colors.ink }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The row that opens the purchase ledger.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own component at all
 * ---------------------------------------------------------------------------
 *
 * Only something rendered INSIDE `<Sheet>` can call `useSheetDismiss()`, and
 * only `useSheetDismiss()` knows when the Modal's native window has actually
 * gone. StapleSheet cannot: it is the component that renders the Sheet, so it
 * sits above the context it would need. Exactly the split range-picker made,
 * for exactly the same reason.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * The ledger is a second Modal, opened from inside this one. The Pantry used to
 * defer it with its own `useDeferUntilClosed(stapleKey != null)` — keyed on
 * VISIBLE, which goes false a whole exit animation before the window is gone.
 * So the ledger was presented while this sheet was still on screen.
 *
 * Android tolerates that: two Modals are two windows and the second lands on
 * top. iOS does not. UIKit refuses to present a view controller while one is
 * already presenting, so the ledger never appeared — and the Pantry was left
 * with a transparent Modal over it swallowing every touch, which is what "it
 * doesn't open anything and the tab gets stuck" is.
 *
 * `dismiss(action)` closes this sheet and runs the action once `mounted` goes
 * false, which is the Modal's real visibility rather than the prop that drives
 * it.
 */
function HistoryRow({
  onOpenHistory,
  style,
  children,
}: PropsWithChildren<{ onOpenHistory: () => void; style: StyleProp<ViewStyle> }>) {
  const dismiss = useSheetDismiss();
  return (
    <Pressable onPress={() => dismiss(onOpenHistory)} accessibilityRole="button" style={style}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Name block and the delete control, top-aligned so the icon stays level
  // with the first line of a name that wraps to two.
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  trash: { paddingTop: 2 },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    // Centre, not baseline: RN resolves baseline against a multi-line Text's
    // last line, which would hang the tag off the bottom of a two-line name.
    alignItems: "center",
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  // Shrinkable so the name yields before the row overflows; it still gets a
  // full line to itself when it is long, because the row wraps.
  title: { flexShrink: 1 },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    // Keeps one very long list name from pushing the sheet wide; the name
    // itself truncates inside the chip rather than the row overflowing.
    maxWidth: "100%",
  },
  tagText: { fontSize: 12, fontWeight: "700" },
  // Capped so a long item name plus the presets can't push the Done row off a
  // short screen — the content scrolls instead. The cap itself is applied
  // inline (cardCap, from the window); flexShrink is the static half that lets
  // it actually squeeze rather than the card overflowing it.
  sheet: {
    flexShrink: 1,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  // flexGrow 0 so a short item sizes the sheet to its own content instead of
  // stretching to the cap; flexShrink 1 so a long one gives way to it.
  scrollArea: { flexGrow: 0, flexShrink: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Shares the bordered `row` layout but drops the top rule, so it reads as the
  // sheet's closing action rather than another setting in the stack.
  grow: { flex: 1, minWidth: 0 },
  // Wraps, because translated cadence labels ("alle 14 Tage") run much longer
  // than the English.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: "100%",
  },
  done: { alignItems: "center", paddingVertical: spacing.sm },
});
