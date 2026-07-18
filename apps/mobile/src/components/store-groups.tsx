import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { Card } from '@/components/card';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { euros } from '@/lib/money';
import { supermarketLabel } from '@/lib/supermarkets';
import { useGroceries, type Item } from '@/store/groceries';
import { spacing, type, useTheme } from '@/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface StoreEntry {
  store: string;
  rows: { listId: string; listName: string; item: Item }[];
}

/**
 * Shopping-by-store view: one expandable card per supermarket that has items
 * assigned (across all lists). Tap the store to see what to buy there; items
 * are checkable in place and stay in sync with their source list.
 */
export function StoreGroups() {
  const { colors } = useTheme();
  const { lists, toggleItem } = useGroceries();
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo<StoreEntry[]>(() => {
    const byStore = new Map<string, StoreEntry>();
    for (const list of lists) {
      for (const item of list.items) {
        if (item.store == null) continue;
        let entry = byStore.get(item.store);
        if (!entry) {
          entry = { store: item.store, rows: [] };
          byStore.set(item.store, entry);
        }
        entry.rows.push({ listId: list.id, listName: list.name, item });
      }
    }
    // Most items first; unchecked before checked within a store.
    const entries = [...byStore.values()];
    for (const entry of entries) {
      entry.rows.sort((a, b) => Number(a.item.checked) - Number(b.item.checked));
    }
    entries.sort((a, b) => b.rows.length - a.rows.length);
    return entries;
  }, [lists]);

  if (groups.length === 0) return null;

  const toggleExpanded = (store: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => (prev === store ? null : store));
  };

  return (
    <>
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
        By supermarket
      </Text>
      {groups.map(({ store, rows }) => {
        const open = expanded === store;
        const remaining = rows.filter((r) => !r.item.checked);
        const pricedTotal = remaining.reduce((sum, r) => sum + (r.item.priceCents ?? 0), 0);
        const hasPrices = remaining.some((r) => r.item.priceCents != null);

        return (
          <Card key={store}>
            <Pressable onPress={() => toggleExpanded(store)} style={styles.head}>
              <SupermarketBadge store={store} size={28} />
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                  {supermarketLabel(store)}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {remaining.length === 0
                    ? 'all bought'
                    : `${remaining.length} to buy${hasPrices ? ` · ${euros(pricedTotal)}` : ''}`}
                </Text>
              </View>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.muted}
              />
            </Pressable>

            {open && (
              <View style={[styles.items, { borderTopColor: colors.line }]}>
                {rows.map(({ listId, listName, item }) => (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleItem(listId, item.id)}
                    style={styles.itemRow}
                  >
                    <View
                      style={[
                        styles.tick,
                        { borderColor: item.checked ? colors.accent : colors.muted },
                        item.checked && { backgroundColor: colors.accent },
                      ]}
                    >
                      {item.checked && (
                        <Ionicons name="checkmark" size={12} color={colors.accentInk} />
                      )}
                    </View>
                    <View style={styles.grow}>
                      <Text
                        style={[
                          type.body,
                          { color: item.checked ? colors.muted : colors.ink },
                          item.checked && styles.struck,
                        ]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                        {listName}
                        {item.quantity != null
                          ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
                          : ''}
                      </Text>
                    </View>
                    {item.priceCents != null && (
                      <Text style={[type.price, { color: colors.ink }]}>
                        {euros(item.priceCents)}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  items: { borderTopWidth: 1, marginTop: spacing.xs, paddingTop: spacing.xs },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  struck: { textDecorationLine: 'line-through' },
});
