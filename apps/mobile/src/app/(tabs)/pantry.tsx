import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { CATEGORY_LABELS, categorizeSync } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import {
  dueAt,
  lastBoughtLabel,
  lifeRemaining,
  statusLabel,
  type ItemStat,
} from '@/lib/pantry-intel';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

// Enable the smooth expand/collapse animation on Android too.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** An item is "running low" once less than this fraction of its lifespan is left. */
const LOW_THRESHOLD = 0.35;

/**
 * Pantry: the honest view of what Korb is tracking. Every item you check off a
 * list is learned here with a real burn-rate — the bar shows how much of its
 * usual lifespan is left. A search bar keeps it usable as the list grows, and
 * items split into "Running low" (open by default) and "In stock" (collapsed).
 * "Track item" seeds a staple manually (treated as bought now).
 */
export default function PantryScreen() {
  const { colors } = useTheme();
  const { stats, logPurchase } = usePantryIntel();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [lowOpen, setLowOpen] = useState(true);
  const [stockOpen, setStockOpen] = useState(false);

  const now = Date.now();
  const items = useMemo(
    () => Object.values(stats).sort((a, b) => dueAt(a) - dueAt(b)),
    [stats],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const { low, stocked } = useMemo(() => {
    const matches = (s: ItemStat) => !q || s.display.toLowerCase().includes(q);
    const low: ItemStat[] = [];
    const stocked: ItemStat[] = [];
    for (const s of items) {
      if (!matches(s)) continue;
      (lifeRemaining(s, now) < LOW_THRESHOLD ? low : stocked).push(s);
    }
    return { low, stocked };
  }, [items, q, now]);

  // While searching, force both sections open so a match is never hidden.
  const lowExpanded = searching ? true : lowOpen;
  const stockExpanded = searching ? true : stockOpen;

  const toggle = (which: 'low' | 'stock') => {
    if (searching) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    haptics.tick();
    if (which === 'low') setLowOpen((v) => !v);
    else setStockOpen((v) => !v);
  };

  const barColor = (left: number) =>
    left < 0.15 ? colors.crit : left < LOW_THRESHOLD ? colors.warn : colors.accent;

  const renderRows = (rows: ItemStat[]) => (
    <Card>
      {rows.map((item, i) => {
        const left = lifeRemaining(item, now);
        return (
          <View
            key={item.key}
            style={[
              styles.row,
              i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {item.display}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                {CATEGORY_LABELS[item.category]} · {lastBoughtLabel(item.lastPurchasedAt, now)}
              </Text>
            </View>
            <View style={styles.stock}>
              <View style={[styles.bar, { backgroundColor: colors.line }]}>
                <View
                  style={[styles.fill, { width: `${Math.max(left, 0.02) * 100}%`, backgroundColor: barColor(left) }]}
                />
              </View>
              <Text style={[type.sub, { color: left < LOW_THRESHOLD ? barColor(left) : colors.muted }]}>
                {statusLabel(item, now)}
              </Text>
            </View>
          </View>
        );
      })}
    </Card>
  );

  const SectionHeader = ({
    title,
    tone,
    count,
    expanded,
    onPress,
  }: {
    title: string;
    tone: string;
    count: number;
    expanded: boolean;
    onPress: () => void;
  }) => (
    <Pressable onPress={onPress} style={styles.sectionHead} hitSlop={6}>
      <Text style={[type.label, { color: tone }]}>{title}</Text>
      <View style={[styles.countPill, { backgroundColor: colors.line }]}>
        <Text style={[type.sub, { color: colors.muted, fontWeight: '700' }]}>{count}</Text>
      </View>
      <View style={styles.grow} />
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
    </Pressable>
  );

  const lowCount = items.filter((s) => lifeRemaining(s, now) < LOW_THRESHOLD).length;

  return (
    <>
      <Screen
        title="Pantry"
        subtitle={
          items.length === 0
            ? 'What Korb is tracking'
            : `${items.length} tracked · ${lowCount} running low`
        }
        hasFab
      >
        {items.length === 0 ? (
          <EmptyState
            icon="file-tray-full-outline"
            title="Nothing tracked yet"
            body="As you tick items off your lists, Korb learns how fast you get through them and tracks them here. Or tap “Track item” to add a staple you always keep at home."
          />
        ) : (
          <>
            {/* Search — keeps the pantry usable as it grows. */}
            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your pantry"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.ink }]}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {searching && low.length === 0 && stocked.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                body={`Nothing in your pantry matches “${query.trim()}”.`}
              />
            ) : (
              <>
                {/* Running low — expanded by default. Hidden while searching if empty. */}
                {(!searching || low.length > 0) && (
                  <View style={styles.section}>
                    <SectionHeader
                      title="Running low"
                      tone={colors.warn}
                      count={low.length}
                      expanded={lowExpanded}
                      onPress={() => toggle('low')}
                    />
                    {lowExpanded &&
                      (low.length > 0 ? (
                        renderRows(low)
                      ) : (
                        <Text style={[type.sub, { color: colors.muted, paddingVertical: spacing.sm }]}>
                          Nothing running low — nicely stocked.
                        </Text>
                      ))}
                  </View>
                )}

                {/* In stock — collapsed by default. */}
                {(!searching || stocked.length > 0) && (
                  <View style={styles.section}>
                    <SectionHeader
                      title="In stock"
                      tone={colors.muted}
                      count={stocked.length}
                      expanded={stockExpanded}
                      onPress={() => toggle('stock')}
                    />
                    {stockExpanded &&
                      (stocked.length > 0 ? (
                        renderRows(stocked)
                      ) : (
                        <Text style={[type.sub, { color: colors.muted, paddingVertical: spacing.sm }]}>
                          Nothing here yet.
                        </Text>
                      ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </Screen>

      <Fab label="Track item" onPress={() => setAdding(true)} />
      <TextPromptModal
        visible={adding}
        title="Track a pantry item"
        placeholder="e.g. Olive oil"
        confirmLabel="Track"
        onCancel={() => setAdding(false)}
        onSubmit={(name) => {
          const clean = name.trim();
          if (clean) logPurchase(clean, categorizeSync(clean));
          setAdding(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 16, padding: 0 },
  section: { gap: spacing.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  countPill: {
    minWidth: 22,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  stock: { width: 104, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
