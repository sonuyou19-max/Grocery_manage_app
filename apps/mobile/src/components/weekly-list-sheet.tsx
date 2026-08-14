import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/components/sheet";
import { ItemEmoji } from "@/components/item-emoji";
import { SupermarketBadge } from "@/components/supermarket-badge";
import { categoryLabel } from "@/lib/categorize";
import { haptics } from "@/lib/haptics";
import type { WeeklySuggestion } from "@/lib/weekly-list";
import { useT } from "@/store/locale";
import { radii, spacing, type, useScrollIndicator, useTheme } from "@/theme";

interface WeeklyListSheetProps {
  visible: boolean;
  suggestions: WeeklySuggestion[];
  onClose: () => void;
  /** Called with the items the user kept ticked; the parent picks the list. */
  onBuild: (selected: WeeklySuggestion[]) => void;
}

/**
 * Preview/confirm sheet for "Build my weekly list". Everything predicted low is
 * pre-ticked; untick anything you don't need, then Add — the parent then asks
 * which list to add them to (the shared ListPickerSheet).
 */
export function WeeklyListSheet({
  visible,
  suggestions,
  onClose,
  onBuild,
}: WeeklyListSheetProps) {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pre-tick everything each time the sheet opens.
  useEffect(() => {
    if (visible) setSelected(new Set(suggestions.map((s) => s.key)));
  }, [visible, suggestions]);

  const toggle = (key: string) => {
    haptics.tick();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const count = selected.size;

  return (
    <Sheet visible={visible} onClose={onClose} scrim gutter={0}>
      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <View style={[styles.grab, { backgroundColor: colors.line }]} />

        <View style={styles.header}>
          <Ionicons name="sparkles" size={20} color={colors.accent} />
          <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
            {t("weekly.title")}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>
        <Text
          style={[
            type.sub,
            { color: colors.muted, paddingHorizontal: spacing.lg },
          ]}
        >
          {t("weekly.subtitle")}
        </Text>

        <ScrollView
          {...scrollIndicator}
          style={[styles.scrollArea, { maxHeight: winH * 0.55 }]}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((s) => {
            const on = selected.has(s.key);
            const detail = [
              categoryLabel(s.category, t),
              s.quantity != null
                ? `${s.quantity}${s.unit ? ` ${s.unit}` : ""}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Pressable
                key={s.key}
                onPress={() => toggle(s.key)}
                style={[
                  styles.row,
                  { borderColor: on ? colors.accent : colors.line },
                ]}
              >
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={on ? colors.accent : colors.muted}
                />
                <ItemEmoji name={s.display} category={s.category} />
                <View style={styles.grow}>
                  <Text
                    style={[type.body, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {s.display}
                  </Text>
                  <Text
                    style={[type.sub, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {detail}
                  </Text>
                </View>
                {s.store != null && (
                  <SupermarketBadge store={s.store} size={18} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <Pressable
            onPress={() =>
              onBuild(suggestions.filter((s) => selected.has(s.key)))
            }
            disabled={count === 0}
            style={[
              styles.build,
              { backgroundColor: colors.accent, opacity: count ? 1 : 0.45 },
            ]}
          >
            <Text style={[type.body, { color: colors.accentInk }]}>
              {t("common.addCount", { count })}
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    /*
     * No maxHeight percentage here, deliberately. '85%' has to resolve against
     * a parent height, and this sheet's parent chain is sized by its content,
     * so the percentage came out far smaller than the screen and squeezed the
     * sheet even with a single row in it. Which child absorbed the squeeze just
     * depended on who could shrink: at first the footer overflowed and painted
     * over the list, and once the list was given flexShrink it collapsed to a
     * sliver instead. Same cause, two different-looking bugs.
     *
     * The list is capped in real pixels instead (see winH below), so the sheet
     * is only ever as tall as its content and nothing has to be squeezed.
     */
    overflow: "hidden",
  },
  grab: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  /*
   * flexShrink: 1 is what makes the pinned footer work, and its absence is the
   * whole bug. A ScrollView defaults to flexShrink: 0, so once the sheet hits
   * maxHeight the list keeps its full content height and the footer is placed
   * beyond the sheet's bottom edge rather than the list giving up room for it.
   * item-sheet and quick-add-sheet, the other two sheets with a pinned footer,
   * both carry this; this one was written without it.
   */
  // Bounded by a pixel maxHeight applied at the call site, the way
  // recipe-review-sheet does it. flexShrink stays as a safety net for very
  // small screens, but with the cap in place it should never have to act.
  scrollArea: { flexShrink: 1 },
  body: { padding: spacing.lg, gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  build: {
    height: 50,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
