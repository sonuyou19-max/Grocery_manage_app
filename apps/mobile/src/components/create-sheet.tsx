import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassView } from "@/components/glass";
import { Sheet, useSheetDismiss } from "@/components/sheet";
import { TextPromptModal } from "@/components/text-prompt-modal";
import { haptics } from "@/lib/haptics";
import { useRecipeGate } from "@/lib/recipe-gate";
import { useGroceries } from "@/store/groceries";
import { useT } from "@/store/locale";
import { radii, spacing, type, useTheme } from "@/theme";

/**
 * "Create something new" — what the centre button opens.
 *
 * ---------------------------------------------------------------------------
 * Two options, and only one of them costs money
 * ---------------------------------------------------------------------------
 *
 * A blank list is free and always will be; importing a recipe is Plus. Both
 * live behind one button, which means the sheet has to make the difference
 * obvious BEFORE the tap rather than after it — a free user who taps "Import
 * recipe" and lands on a paywall they did not expect has been sold to, not
 * offered something. So the Plus row carries the badge, in the gradient the
 * subscription owns everywhere else in the app, and the free row deliberately
 * carries nothing at all.
 *
 * The paywall is still where a free tap goes. That is the specified behaviour
 * and it is the right one: the alternative — hiding the row entirely — means
 * nobody ever discovers the feature exists.
 *
 * ---------------------------------------------------------------------------
 * It grows out of the button
 * ---------------------------------------------------------------------------
 *
 * The transform origin is the bottom centre of the card, which is where the
 * create button sits — the button is horizontally centred in the bar, and the
 * card's bottom margin is what separates them. Scaling from there means the
 * sheet unfolds out of the thing that was pressed and folds back into it,
 * rather than arriving from off-screen with no stated relationship to it.
 *
 * Anchoring to the button's MEASURED position was the other option and it is
 * not worth it: the two are already aligned on the only axis where a mismatch
 * would be visible, and measuring would couple this component to the tab bar's
 * layout for a correction nobody can see.
 */

export function CreateSheet({
  visible,
  onClose,
  bottomClearance,
}: {
  visible: boolean;
  onClose: () => void;
  /**
   * How much room to leave under the card, in px.
   *
   * Passed in rather than imported, because the only honest source for it is the
   * tab bar's own geometry — and the tab bar renders this component, so reading
   * its constants from here would be an import cycle. It also has to clear the
   * create button, which rises above the pill: the sheet sitting over the button
   * hid the very rotation it was triggering.
   */
  bottomClearance: number;
}) {
  const { colors } = useTheme();
  const t = useT();
  const { addList } = useGroceries();
  const { openOrRedirect } = useRecipeGate();
  const [naming, setNaming] = useState(false);

  /*
   * TextPromptModal defers its own onSubmit until its sheet has really closed
   * (see that file), so by the time this runs there is no Modal window left to
   * navigate underneath. This used to need a deferral of its own.
   */
  const openNewList = (name: string) => {
    const id = addList(name);
    setNaming(false);
    router.push({ pathname: "/list/[id]", params: { id } });
  };

  return (
    <>
      <Sheet
        visible={visible && !naming}
        onClose={onClose}
        bottomClearance={bottomClearance}
      >
        <CreateMenu onNameList={() => setNaming(true)} />
      </Sheet>

      <TextPromptModal
        visible={naming}
        title={t("lists.newList")}
        placeholder={t("lists.newListPlaceholder")}
        confirmLabel={t("lists.create")}
        onCancel={() => {
          setNaming(false);
          onClose();
        }}
        onSubmit={openNewList}
      />
    </>
  );
}

/**
 * The two rows, inside the <Sheet> so they can call useSheetDismiss().
 *
 * Both leave this screen, and neither may do it while the Modal window is still
 * up — that is the blank-screen bug in lib/modal-nav.ts, which this sheet has
 * hit before. `dismiss(action)` is now the only way out, so the ordering is not
 * something to remember.
 */
function CreateMenu({ onNameList }: { onNameList: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  const { openOrRedirect } = useRecipeGate();
  const dismiss = useSheetDismiss();

  return (
    <GlassView over="content" radius={radii.lg} style={styles.card}>
      <Text style={[type.h2, { color: colors.ink }]}>{t("create.title")}</Text>

      <Pressable
        style={[styles.row, { borderColor: colors.line }]}
        onPress={() => {
          haptics.tick();
          dismiss(onNameList);
        }}
      >
        <View style={[styles.iconBox, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="list-outline" size={22} color={colors.accent} />
        </View>
        <View style={styles.grow}>
          <Text style={[type.body, { color: colors.ink }]}>
            {t("create.blankTitle")}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>
            {t("create.blankBody")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      <Pressable
        style={[styles.row, { borderColor: colors.line }]}
        onPress={() => {
          haptics.tick();
          // The gate decides, not this component. `blocked` is false
          // for a trial user and for everyone while the tier is off, so
          // this row simply works until billing goes live — see
          // lib/recipe-gate.ts.
          dismiss(() => openOrRedirect(() => router.push("/recipe")));
        }}
      >
        <View style={[styles.iconBox, { backgroundColor: colors.plusSoft }]}>
          <Ionicons name="sparkles" size={20} color={colors.plusInk} />
        </View>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Text style={[type.body, { color: colors.ink }]}>
              {t("create.recipeTitle")}
            </Text>
            <LinearGradient
              colors={[colors.plusFrom, colors.plusTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.badge}
            >
              <Text style={[type.label, styles.badgeText]}>
                {t("plus.badge")}
              </Text>
            </LinearGradient>
          </View>
          <Text style={[type.sub, { color: colors.muted }]}>
            {t("create.recipeBody")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  badgeText: { color: "#FFFFFF" },
});
