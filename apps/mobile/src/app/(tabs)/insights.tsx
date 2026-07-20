import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { WeeklyRecapCard } from '@/components/weekly-recap-card';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/categorize';
import { euros } from '@/lib/money';
import { basketBalance, GROUP_COLORS, GROUP_LABELS, type BalanceSlice } from '@/lib/nutrition';
import { cheaperStoreHints, spendByStore } from '@/lib/price-intel';
import { supermarketLabel } from '@/lib/supermarkets';
import { useGroceries } from '@/store/groceries';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Insights: a feed of what the app has learned about your shopping. Basket
 * balance (a rough food-group mix), your staples, and — once you log prices —
 * spending. Everything degrades gracefully while there isn't much data yet.
 */
export default function InsightsScreen() {
  const { colors } = useTheme();
  const { lists } = useGroceries();
  const { stats } = usePantryIntel();

  const cart = useMemo(
    () => basketBalance(lists.flatMap((l) => l.items).map((it) => ({ name: it.name, category: it.category }))),
    [lists],
  );
  const pantry = useMemo(
    () => basketBalance(Object.values(stats).map((s) => ({ name: s.display, category: s.category }))),
    [stats],
  );

  const staples = useMemo(
    () =>
      Object.values(stats)
        .filter((s) => s.sampleCount >= 1)
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .slice(0, 5),
    [stats],
  );

  const priced = useMemo(
    () => lists.flatMap((l) => l.items).filter((it) => it.priceCents != null),
    [lists],
  );
  const spendTotal = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
  const spendByCat = useMemo(() => {
    const m = new Map<ItemCategory, number>();
    for (const it of priced) m.set(it.category, (m.get(it.category) ?? 0) + (it.priceCents ?? 0));
    return CATEGORY_ORDER.map((c) => ({ category: c, cents: m.get(c) ?? 0 }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents);
  }, [priced]);
  const storeSpend = useMemo(() => spendByStore(priced), [priced]);
  const cheaper = useMemo(() => cheaperStoreHints(priced), [priced]);

  return (
    <Screen title="Insights" subtitle="Your shopping, understood">
      <WeeklyRecapCard />

      {cart.total > 0 && (
        <Card>
          <CardHead icon="nutrition-outline" title="In your basket" hint={`${cart.total} food item${cart.total === 1 ? '' : 's'}`} />
          <BalanceBar slices={cart.slices} />
          <Text style={[type.sub, { color: colors.muted }]}>A rough guide by item — not a nutrition tracker.</Text>
        </Card>
      )}

      {pantry.total > 0 && (
        <Card>
          <CardHead icon="file-tray-full-outline" title="Your pantry mix" hint={`${pantry.total} tracked`} />
          <BalanceBar slices={pantry.slices} />
        </Card>
      )}

      {staples.length > 0 && (
        <Card>
          <CardHead icon="repeat-outline" title="Your staples" hint="Bought most often" />
          {staples.map((s) => (
            <View key={s.key} style={styles.row}>
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.display}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>{s.sampleCount + 1}× bought</Text>
            </View>
          ))}
        </Card>
      )}

      {priced.length > 0 ? (
        <Card>
          <CardHead icon="cash-outline" title="Spending" hint={`${priced.length} priced`} />
          <View style={styles.spendTotal}>
            <Text style={[type.sub, { color: colors.muted }]}>Total logged</Text>
            <Text style={[type.h2, { color: colors.ink }]}>{euros(spendTotal)}</Text>
          </View>
          {spendByCat.map((x) => (
            <View key={x.category} style={styles.row}>
              <Text style={[type.sub, styles.grow, { color: colors.ink }]}>{CATEGORY_LABELS[x.category]}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{euros(x.cents)}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <CardHead icon="pricetag-outline" title="Spending" hint="Optional" />
          <Text style={[type.sub, { color: colors.muted }]}>
            Add a price to items as you shop and Korb shows weekly spend and where your money goes.
            Always optional — until then this stays out of your way.
          </Text>
        </Card>
      )}

      {/* Spend per store — only when at least one priced item has a store. */}
      {storeSpend.some((s) => s.store != null) && (
        <Card>
          <CardHead icon="storefront-outline" title="Where you shop" hint="By store" />
          {storeSpend.map((s) => (
            <View key={s.store ?? 'none'} style={styles.row}>
              {s.store ? (
                <SupermarketBadge store={s.store} size={20} />
              ) : (
                <Ionicons name="pricetag-outline" size={20} color={colors.muted} />
              )}
              <Text style={[type.sub, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.store ? supermarketLabel(s.store) ?? s.store : 'No store set'}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>{euros(s.cents)}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Cheaper elsewhere — same item priced at 2+ stores. */}
      {cheaper.length > 0 && (
        <Card>
          <CardHead icon="trending-down-outline" title="Cheaper elsewhere" hint="Same item, lower price" />
          {cheaper.slice(0, 6).map((h) => (
            <View key={h.name} style={styles.hintRow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {h.name}
              </Text>
              <View style={styles.hintDetail}>
                <SupermarketBadge store={h.cheapStore} size={16} />
                <Text style={[type.sub, { color: colors.accent }]}>
                  {euros(h.cheapCents)} at {supermarketLabel(h.cheapStore) ?? h.cheapStore}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>vs {euros(h.dearCents)}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function CardHead({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.cardHead}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={[type.body, styles.grow, { color: colors.ink }]}>{title}</Text>
      {hint ? <Text style={[type.sub, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}

/** A stacked, weighted bar of food-group slices with a percentage legend. */
function BalanceBar({ slices }: { slices: BalanceSlice[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.bar, { backgroundColor: colors.line }]}>
        {slices.map((s) => (
          <View key={s.group} style={{ flex: s.count, backgroundColor: GROUP_COLORS[s.group] }} />
        ))}
      </View>
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.group} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: GROUP_COLORS[s.group] }]} />
            <Text style={[type.sub, { color: colors.ink }]}>
              {GROUP_LABELS[s.group]} {Math.round(s.fraction * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  bar: { flexDirection: 'row', height: 16, borderRadius: radii.sm, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  spendTotal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.xs },
  hintRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  hintDetail: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
});
