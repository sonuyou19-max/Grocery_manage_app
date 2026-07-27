import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { WeeklyRecapCard } from '@/components/weekly-recap-card';
import { SpendTrendChart } from '@/components/spend-trend-chart';
import { categoryLabel, CATEGORY_ORDER } from '@/lib/categorize';
import { basketBalance, GROUP_COLORS, groupLabel, type BalanceSlice } from '@/lib/nutrition';
import { isResting } from '@/lib/pantry-intel';
import { cheaperStoreHints, spendByStore } from '@/lib/price-intel';
import { priceMoves, spendTrend, weekStartOf } from '@/lib/purchase-log';
import { supermarketLabel } from '@/lib/supermarkets';
import { useGroceries } from '@/store/groceries';
import { useLocale } from '@/store/locale';
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
  const { t, money } = useLocale();
  const { lists } = useGroceries();
  const { stats, purchases } = usePantryIntel();

  // The purchase log outlives the lists it came from, so these are the only
  // figures here that describe weeks rather than what's on a list right now.
  // Recomputed against a single `now` so the chart and the copy agree.
  const now = Date.now();
  const trend = useMemo(() => spendTrend(purchases, now, 8), [purchases, now]);
  const moves = useMemo(() => priceMoves(purchases), [purchases]);
  const hasTrend = trend.weeks.some((w) => w.count > 0);

  const cart = useMemo(
    () => basketBalance(lists.flatMap((l) => l.items).map((it) => ({ name: it.name, category: it.category }))),
    [lists],
  );
  // Resting items are out of every reading here: they're history Korb keeps but
  // no longer tracks, so counting them would describe a pantry you don't have.
  const tracked = useMemo(() => Object.values(stats).filter((s) => !isResting(s)), [stats]);

  const pantry = useMemo(
    () => basketBalance(tracked.map((s) => ({ name: s.display, category: s.category }))),
    [tracked],
  );

  const staples = useMemo(
    () =>
      tracked
        .filter((s) => s.sampleCount >= 1)
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .slice(0, 5),
    [tracked],
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
    <Screen title={t('tabs.insights')} subtitle={t('insights.subtitle')}>
      <WeeklyRecapCard />

      {cart.total > 0 && (
        <Card>
          <CardHead
            icon="nutrition-outline"
            title={t('insights.basketTitle')}
            hint={t('insights.basketHint', { count: cart.total })}
          />
          <BalanceBar slices={cart.slices} />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.basketNote')}</Text>
        </Card>
      )}

      {pantry.total > 0 && (
        <Card>
          <CardHead
            icon="file-tray-full-outline"
            title={t('insights.pantryMixTitle')}
            hint={t('insights.pantryMixHint', { count: pantry.total })}
          />
          <BalanceBar slices={pantry.slices} />
        </Card>
      )}

      {staples.length > 0 && (
        <Card>
          <CardHead icon="repeat-outline" title={t('insights.staplesTitle')} hint={t('insights.staplesHint')} />
          {staples.map((s) => (
            <View key={s.key} style={styles.row}>
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.display}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('insights.boughtTimes', { count: s.sampleCount + 1 })}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Spend across weeks, from the purchase log — this is the only card that
          survives deleting the list the prices were logged on. */}
      {hasTrend && (
        <Card>
          <CardHead
            icon="stats-chart-outline"
            title={t('insights.trendTitle')}
            hint={t('insights.trendWeeks', { count: trend.weeks.length })}
          />
          <View style={styles.heroRow}>
            <Text style={[type.h1, { color: colors.ink }]}>{money(trend.averageCents)}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendPerWeek')}</Text>
          </View>
          {trend.weekOverWeek != null && (
            <View style={styles.deltaRow}>
              <Ionicons
                name={trend.weekOverWeek >= 0 ? 'arrow-up' : 'arrow-down'}
                size={14}
                // Neither direction is good or bad — spending more isn't a
                // failure — so this stays ink, not a status colour.
                color={colors.muted}
              />
              <Text style={[type.sub, { color: colors.muted }]}>
                {t(trend.weekOverWeek >= 0 ? 'insights.trendUp' : 'insights.trendDown', {
                  percent: Math.abs(Math.round(trend.weekOverWeek * 100)),
                })}
              </Text>
            </View>
          )}
          <SpendTrendChart
            weeks={trend.weeks}
            currentWeekStart={weekStartOf(now)}
            peakWeekStart={trend.peak?.weekStart ?? null}
          />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendCaveat')}</Text>
        </Card>
      )}

      {/* Items that cost more (or less) than they usually do. */}
      {moves.length > 0 && (
        <Card>
          <CardHead
            icon="swap-vertical-outline"
            title={t('insights.movesTitle')}
            hint={t('insights.movesHint')}
          />
          {moves.slice(0, 5).map((m) => (
            <View key={m.key} style={styles.row}>
              <Ionicons
                name={m.change > 0 ? 'trending-up' : 'trending-down'}
                size={18}
                color={m.change > 0 ? colors.warn : colors.accent}
              />
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                {t(m.change > 0 ? 'insights.moveUp' : 'insights.moveDown', {
                  percent: Math.abs(Math.round(m.change * 100)),
                  price: money(m.latestCents),
                  usual: money(m.baselineCents),
                })}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {priced.length > 0 ? (
        <Card>
          <CardHead
            icon="cash-outline"
            title={t('insights.spendingTitle')}
            hint={t('insights.spendingHint', { count: priced.length })}
          />
          <View style={styles.spendTotal}>
            <Text style={[type.sub, { color: colors.muted }]}>{t('insights.totalLogged')}</Text>
            <Text style={[type.h2, { color: colors.ink }]}>{money(spendTotal)}</Text>
          </View>
          {spendByCat.map((x) => (
            <View key={x.category} style={styles.row}>
              <Text style={[type.sub, styles.grow, { color: colors.ink }]}>{categoryLabel(x.category, t)}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{money(x.cents)}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <CardHead icon="pricetag-outline" title={t('insights.spendingTitle')} hint={t('insights.spendingOptional')} />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.spendingEmpty')}</Text>
        </Card>
      )}

      {/* Spend per store — only when at least one priced item has a store. */}
      {storeSpend.some((s) => s.store != null) && (
        <Card>
          <CardHead icon="storefront-outline" title={t('insights.whereTitle')} hint={t('insights.whereHint')} />
          {storeSpend.map((s) => (
            <View key={s.store ?? 'none'} style={styles.row}>
              {s.store ? (
                <SupermarketBadge store={s.store} size={20} />
              ) : (
                <Ionicons name="pricetag-outline" size={20} color={colors.muted} />
              )}
              <Text style={[type.sub, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.store ? supermarketLabel(s.store) ?? s.store : t('insights.noStore')}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>{money(s.cents)}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Cheaper elsewhere — same item priced at 2+ stores. */}
      {cheaper.length > 0 && (
        <Card>
          <CardHead icon="trending-down-outline" title={t('insights.cheaperTitle')} hint={t('insights.cheaperHint')} />
          {cheaper.slice(0, 6).map((h) => (
            <View key={h.name} style={styles.hintRow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {h.name}
              </Text>
              <View style={styles.hintDetail}>
                <SupermarketBadge store={h.cheapStore} size={16} />
                <Text style={[type.sub, { color: colors.accent }]}>
                  {t('insights.cheaperAt', {
                    price: money(h.cheapCents),
                    store: supermarketLabel(h.cheapStore) ?? h.cheapStore,
                  })}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('insights.cheaperVs', { price: money(h.dearCents) })}
                </Text>
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
  const { t } = useLocale();
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
              {groupLabel(s.group, t)} {Math.round(s.fraction * 100)}%
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
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  hintRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  hintDetail: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
});
