import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassView } from "@/components/glass";
import { Sheet, useSheetDismiss } from "@/components/sheet";
import { haptics } from "@/lib/haptics";
import { useHousehold } from "@/store/household";
import { useT } from "@/store/locale";
import { radii, spacing, type, useTheme } from "@/theme";

/**
 * The dashboard's household line. Sits where the header subtitle already showed
 * the household name, so switching costs no extra furniture.
 *
 * Reveals itself progressively: with no household it is the old static
 * subtitle, with one it is just the name, and only from two does it become
 * tappable. A solo user therefore sees no change at all.
 */
export function HouseholdSwitcher({ fallback }: { fallback: string }) {
  const { colors } = useTheme();
  const { households, household } = useHousehold();
  const [open, setOpen] = useState(false);

  if (!household)
    return <Text style={[type.sub, { color: colors.muted }]}>{fallback}</Text>;
  if (households.length < 2) {
    return (
      <Text style={[type.sub, { color: colors.muted }]}>{household.name}</Text>
    );
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.chip}>
        <Text style={[type.sub, { color: colors.muted }]}>
          {household.name}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.muted} />
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        align="center"
        scrim
        gutter={spacing.xl}
      >
        <SwitcherMenu />
      </Sheet>
    </>
  );
}

/**
 * The menu, split out so it sits INSIDE the <Sheet> and can call
 * useSheetDismiss().
 *
 * "Add household" navigates, and this component had the bug that
 * lib/modal-nav.ts exists to prevent — `setOpen(false)` followed immediately by
 * `router.push('/auth/household')`. On Android the Modal is its own window, so
 * the pushed route lands underneath it and the user gets a blank screen. It has
 * been fixed four times in four other features; here it was never spotted,
 * because the guard checks a hand-maintained list of navigating modals and
 * nobody added this one.
 *
 * Going through the Sheet means the deferral is not something to remember. The
 * only way to leave is `dismiss(action)`, and it always waits.
 */
function SwitcherMenu() {
  const { colors } = useTheme();
  const t = useT();
  const { households, household, setActiveHousehold, membersOf } =
    useHousehold();
  const dismiss = useSheetDismiss();

  if (!household) return null;

  const pick = (id: string) => {
    if (id !== household.id) {
      haptics.snap();
      setActiveHousehold(id);
    }
    dismiss();
  };

  return (
    <GlassView over="content" radius={radii.lg} style={styles.card}>
      {households.map((h) => {
        const active = h.id === household.id;
        return (
          <Pressable key={h.id} style={styles.row} onPress={() => pick(h.id)}>
            <Ionicons
              name={active ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={active ? colors.accent : colors.muted}
            />
            <View style={styles.grow}>
              <Text
                style={[type.body, { color: colors.ink }]}
                numberOfLines={1}
              >
                {h.name}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("settings.memberCount", { count: membersOf(h.id).length })}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
      <Pressable
        style={styles.row}
        onPress={() => dismiss(() => router.push("/auth/household"))}
      >
        <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
        <Text style={[type.body, styles.grow, { color: colors.accent }]}>
          {t("settings.addHousehold")}
        </Text>
      </Pressable>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  card: { padding: spacing.lg, gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  grow: { flex: 1, minWidth: 0 },
  divider: { height: 1, marginVertical: spacing.xs },
});
