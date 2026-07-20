import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { useGroceries, useList, type Item } from '@/store/groceries';
import { usePantryIntel } from '@/store/pantry-intel';
import { spacing, type, useTheme } from '@/theme';

/**
 * Shopping Mode: a focused, in-store view of one list. Big tap targets, items
 * grouped in aisle order, a progress bar, and the screen kept awake so it
 * doesn't sleep mid-shop. Checking an item here logs the purchase, exactly like
 * ticking it off the list — so the pantry keeps learning either way.
 */
export default function ShoppingModeScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const list = useList(id);
  const { toggleItem } = useGroceries();
  const { logPurchase } = usePantryIntel();

  const grouped = useMemo(() => {
    if (!list) return [];
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: list.items.filter((it) => it.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [list]);

  if (!list) {
    return (
      <View style={styles.root}>
        <MeshBackground />
        <SafeAreaView style={styles.fill}>
          <Text style={[type.body, { color: colors.ink, padding: spacing.xl }]}>
            This list no longer exists.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.exitBtn}>
            <Text style={[type.body, { color: colors.accent }]}>Close</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const total = list.items.length;
  const checked = list.items.filter((it) => it.checked).length;
  const progress = total ? checked / total : 0;
  const allDone = total > 0 && checked === total;

  const onToggle = (item: Item) => {
    // Checking = putting it in the cart → a purchase (feeds the pantry). The
    // burn-rate engine's same-day guard makes an accidental re-tick harmless.
    if (!item.checked) {
      logPurchase(item.name, item.category);
      haptics.success();
    } else {
      haptics.tick();
    }
    toggleItem(list.id, item.id);
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
              {list.name}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {list.store ?? 'Any store'} · {checked}/{total} in cart
            </Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        {/* Progress */}
        <View style={[styles.track, { backgroundColor: colors.line }]}>
          <View style={[styles.fillBar, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {grouped.map((group) => (
            <View key={group.category} style={styles.section}>
              <Text style={[type.label, { color: colors.accent }]}>
                {CATEGORY_LABELS[group.category]}
              </Text>
              {group.items.map((it) => (
                <Pressable
                  key={it.id}
                  onPress={() => onToggle(it)}
                  style={[
                    styles.row,
                    { borderColor: it.checked ? colors.accent : colors.line, backgroundColor: colors.surface },
                  ]}
                >
                  <View
                    style={[
                      styles.box,
                      { borderColor: it.checked ? colors.accent : colors.muted },
                      it.checked && { backgroundColor: colors.accent },
                    ]}
                  >
                    {it.checked && <Ionicons name="checkmark" size={22} color={colors.accentInk} />}
                  </View>
                  <View style={styles.grow}>
                    <Text
                      style={[
                        styles.name,
                        { color: it.checked ? colors.muted : colors.ink },
                        it.checked && styles.struck,
                      ]}
                      numberOfLines={1}
                    >
                      {it.name}
                    </Text>
                    {(it.quantity != null || it.store != null) && (
                      <View style={styles.meta}>
                        {it.store != null && <SupermarketBadge store={it.store} size={16} />}
                        {it.quantity != null && (
                          <Text style={[type.sub, { color: colors.muted }]}>
                            {it.quantity}
                            {it.unit ? ` ${it.unit}` : ''}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}

          {allDone && (
            <View style={styles.done}>
              <Text style={styles.doneEmoji}>🎉</Text>
              <Text style={[type.h2, { color: colors.ink, textAlign: 'center' }]}>All in the cart</Text>
              <Text style={[type.sub, { color: colors.muted, textAlign: 'center' }]}>
                Everything's ticked off. Nice shop.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={() => router.back()} style={[styles.exitBtn, { backgroundColor: colors.accent }]}>
            <Text style={[type.body, { color: colors.accentInk }]}>{allDone ? 'Done' : 'Finish shopping'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1, backgroundColor: 'transparent' },
  grow: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  close: { padding: spacing.xs },
  track: { height: 6, borderRadius: 3, marginHorizontal: spacing.lg, overflow: 'hidden' },
  fillBar: { height: '100%', borderRadius: 3 },
  list: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: spacing.md,
    minHeight: 64,
  },
  box: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 18, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  done: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xl },
  doneEmoji: { fontSize: 44 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  exitBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
