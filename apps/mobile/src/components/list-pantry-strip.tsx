import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { recallItemList } from '@/lib/item-home-list';
import { dueAt, isDue, normalizeKey, type ItemStat } from '@/lib/pantry-intel';
import { useGroceries, type List } from '@/store/groceries';
import { useT } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "Running low" chips shown inside a list — the pantry surfaced where you'd act
 * on it, instead of only living behind its own tab.
 *
 * This is a **lens, not a partition**. The burn-rate maths still runs over one
 * unified pantry; this only filters which of those items are worth showing here,
 * using each item's remembered home list (lib/item-home-list). Splitting the
 * pantry per list would halve each item's purchase history and roughly double
 * its learned interval, so the restock nudge would land after you'd run out —
 * see docs/PER_LIST_ACCESS_DESIGN.md.
 *
 * Shows nothing unless something homed here is actually due, so a list you
 * haven't shopped from yet stays clean.
 */

const MAX_CHIPS = 6;

export function ListPantryStrip({ list }: { list: List }) {
  const { colors } = useTheme();
  const t = useT();
  const { stats, markAlmostOut } = usePantryIntel();
  const { addOrReviveItem } = useGroceries();

  const due = useMemo(() => {
    const now = Date.now();
    // Anything already waiting on this list is redundant here. Ticked-off rows
    // don't count — those are past shops, and suggesting them again is the point.
    const queued = new Set(
      list.items.filter((it) => !it.checked).map((it) => normalizeKey(it.name)),
    );
    return Object.values(stats)
      .filter(
        (s) =>
          isDue(s, now) && !queued.has(s.key) && recallItemList(s.display) === list.id,
      )
      .sort((a, b) => dueAt(a) - dueAt(b))
      .slice(0, MAX_CHIPS);
  }, [stats, list.items, list.id]);

  if (due.length === 0) return null;

  const add = (item: ItemStat) => {
    addOrReviveItem(list.id, {
      name: item.display,
      category: item.category,
      quantity: null,
      unit: null,
    });
    markAlmostOut(item.key);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Ionicons name="repeat-outline" size={15} color={colors.warn} />
        <Text style={[type.label, { color: colors.warn }]}>{t('listDetail.usuallyDue')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {due.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => add(item)}
            style={[styles.chip, { borderColor: colors.line, backgroundColor: colors.surface }]}
          >
            <Ionicons name="add" size={15} color={colors.accent} />
            <Text style={[type.sub, { color: colors.ink }]} numberOfLines={1}>
              {item.display}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, paddingTop: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingRight: spacing.xl },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    maxWidth: 180,
  },
});
