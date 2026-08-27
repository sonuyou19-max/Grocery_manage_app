import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemEmoji } from '@/components/item-emoji';
import { recallItemList } from '@/lib/item-home-list';
import { isDue, normalizeKey, type ItemStat } from '@/lib/pantry-intel';
import { purchaseCounts, usualBuys } from '@/lib/usual-buys';
import { useGroceries, type List } from '@/store/groceries';
import { useT } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The regulars for this list — what the household buys often, one tap away.
 *
 * ---------------------------------------------------------------------------
 * It counts, it does not predict
 * ---------------------------------------------------------------------------
 *
 * This showed what was DUE, which is a different question from the one its
 * heading asks. "You usually buy" is about how often something is bought, and a
 * burn-rate prediction can put an item there that was bought once and is merely
 * overdue by its category's default guess. The rule is lib/usual-buys now:
 * bought at least twice, among the most-bought, ties included.
 *
 * ---------------------------------------------------------------------------
 * Anything on the list is off the strip — ticked or not
 * ---------------------------------------------------------------------------
 *
 * The exclusion used to skip only UNTICKED rows, on the reasoning that ticked
 * ones are past shops and suggesting them again is the point. True of a shop
 * from last week, and false of the one on screen: a receipt import ticks every
 * row it matches and adds the rest already bought, so the strip cheerfully
 * offered back the bread sitting in "added to pantry" a few centimetres below
 * it.
 *
 * Both are covered by excluding everything currently on the list, because the
 * list this reads is the SWEPT one — a finished shop's rows leave on their own
 * (see lib/list-sweep), and the item becomes suggestible again the moment they
 * do. Which is the original intent, without recommending something visible in
 * the same scroll.
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


export function ListPantryStrip({ list }: { list: List }) {
  const { colors } = useTheme();
  const t = useT();
  const { stats, purchases, markAlmostOut } = usePantryIntel();
  const { addOrReviveItem } = useGroceries();

  const usual = useMemo(() => {
    /*
     * Everything on the list, ticked or not. See the note above: a ticked row is
     * only a "past shop" once the sweep has taken it, and until then it is
     * visible on this very screen.
     */
    const onList = new Set(list.items.map((it) => normalizeKey(it.name)));
    /*
     * The household's answer first, this device's memory only as a fallback.
     *
     * These chips were invisible on a second phone, and it read as a platform
     * bug — present on iOS, missing on Android. It was neither: the home list
     * lived only in AsyncStorage, so the strip worked on whichever handset had
     * done the adding. Since migration 0037 the mapping is a column on
     * pantry_items, shared by every member and synced live.
     *
     * recallItemList stays underneath it for the three cases the column cannot
     * answer: signed out, a household that has not synced yet, and an item
     * bought for the first time moments ago whose row exists but was created
     * before this device wrote the home list to it.
     */
    const homeOf = (s: ItemStat) => s.homeList ?? recallItemList(s.display);
    return usualBuys(
      Object.values(stats).filter((s) => !onList.has(s.key) && homeOf(s) === list.id),
      purchaseCounts(purchases),
    );
  }, [stats, purchases, list.items, list.id]);

  if (usual.length === 0) return null;

  const add = (item: ItemStat) => {
    addOrReviveItem(list.id, {
      name: item.display,
      category: item.category,
      quantity: null,
      unit: null,
    });
    /*
     * Only when it really is due, and that condition is new with the strip's
     * meaning.
     *
     * markAlmostOut teaches the burn rate: it pulls the learned interval down
     * toward the gap observed so far. That is the right lesson from "I am
     * running out early" and the wrong one from "this is my usual bread" —
     * adding a weekly loaf two days after buying one would tell the model the
     * household gets through bread in two days, and it would keep saying so.
     */
    if (isDue(item, Date.now())) markAlmostOut(item.key);
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
        {usual.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => add(item)}
            style={[styles.chip, { borderColor: colors.line, backgroundColor: colors.surface }]}
          >
            <Ionicons name="add" size={15} color={colors.accent} />
            <ItemEmoji name={item.display} category={item.category} size={14} />
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
