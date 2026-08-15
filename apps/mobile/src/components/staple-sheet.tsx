import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { Sheet } from "@/components/sheet";
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
  /** Retire the item from prediction. The caller closes the sheet. */
  onRest: () => void;
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
  item,
  onClose,
  onChange,
  onRest,
  purchases,
  onOpenHistory,
  lists,
}: StapleSheetProps) {
  const { colors, scheme } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const t = useT();

  if (!item) return null;

  const history = historyFor(purchases, item.display);

  const learned = Math.round(effectiveInterval(item));
  const pinned = hasUserCadence(item);

  return (
    <Sheet visible onClose={onClose} scrim gutter={spacing.md}>
      <GlassView over="content" radius={radii.lg} style={styles.sheet}>
        <ScrollView
          {...scrollIndicator}
          contentContainerStyle={styles.content}
        >
          <View>
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
            <Pressable
              onPress={onOpenHistory}
              accessibilityRole="button"
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
            </Pressable>
          )}

          {/* Let it rest — the way out that isn't a delete. Placed last and
                  in muted tones because it's the rarest choice on this sheet;
                  it should be findable, not inviting. */}
          <Pressable
            onPress={onRest}
            accessibilityRole="button"
            accessibilityHint={t("rest.hint")}
            style={[styles.row, styles.restRow, { borderColor: colors.line }]}
          >
            <Ionicons name="moon-outline" size={22} color={colors.muted} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>
                {t("rest.action")}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("rest.hint")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          <Pressable onPress={onClose} style={styles.done} hitSlop={8}>
            <Text style={[type.body, { color: colors.accent }]}>
              {t("common.done")}
            </Text>
          </Pressable>
        </ScrollView>
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

const styles = StyleSheet.create({
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
  // short screen — the content scrolls instead.
  sheet: { maxHeight: "85%" },
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
  restRow: { borderTopWidth: 0 },
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
