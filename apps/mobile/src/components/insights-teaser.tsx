import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { SpendTrendChart } from '@/components/spend-trend-chart';
import { Teaser } from '@/components/teaser';
import { weekStartOf, type WeekSpend } from '@/lib/purchase-log';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What a signed-out visitor sees on the Insights tab.
 *
 * ---------------------------------------------------------------------------
 * Why this blurs SAMPLE data and not the user's own
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation is to render the real tab and blur it. It is the
 * wrong one, twice over. A brand-new guest has no data, so there would be
 * nothing behind the blur but empty states — the least enticing possible
 * teaser. And a guest who HAS been shopping locally would be looking at their
 * own numbers, deliberately smeared, which is not a teaser at all: it is the
 * app withholding something that already belongs to them.
 *
 * So the blur sits over a fixed, invented household. It is rendered through the
 * real chart component, so the shape and rhythm are exactly what they will get
 * — and it carries a visible "example" label, because a blurred number that
 * happens to be legible would otherwise read as a claim about their spending.
 *
 * ---------------------------------------------------------------------------
 * One message, not two
 * ---------------------------------------------------------------------------
 *
 * There used to be a second variant for guests who already had a history,
 * chosen on "have they logged any purchases at all". A single check-off tripped
 * it, so someone who installed that morning was told they had "been shopping on
 * this device for a while" — a claim about them that the app had no business
 * making and could not verify.
 *
 * The copy now describes what KORB does rather than what the user has done, so
 * it is equally true on day one and after a year. That removes the variant, the
 * threshold, and the whole class of picking-the-wrong-one bugs along with them.
 */

/** Invented, and stable — a teaser that reshuffles on every render looks broken. */
function sampleWeeks(now: number): WeekSpend[] {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = weekStartOf(now);
  // Eight weeks with a plausible shape: an ordinary run, a big shop, a quiet
  // week, and a current week still filling up. Flat bars would undersell the
  // chart; a random walk would look like noise.
  const cents = [4820, 5140, 3960, 7310, 4450, 5020, 6180, 2740];
  return cents.map((c, i) => ({
    weekStart: thisWeek - (cents.length - 1 - i) * WEEK,
    cents: c,
    count: 6 + (i % 4),
  }));
}

export function InsightsTeaser() {
  const { colors } = useTheme();
  const { t, money } = useLocale();

  const weeks = sampleWeeks(Date.now());
  const peak = weeks.reduce((a, b) => (b.cents > a.cents ? b : a));

  return (
    <Screen title={t('tabs.insights')} subtitle={t('insights.subtitle')}>
      <Teaser title={t('teaser.title')} body={t('teaser.body')}>
        <Card>
          <View style={styles.head}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.accent} />
            <Text style={[type.label, { color: colors.ink }]}>{t('insights.trendTitle')}</Text>
          </View>
          <View style={styles.heroRow}>
            <Text style={[type.h1, { color: colors.ink }]}>{money(4950)}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendPerWeek')}</Text>
          </View>
          <SpendTrendChart
            weeks={weeks}
            currentWeekStart={weeks[weeks.length - 1].weekStart}
            peakWeekStart={peak.weekStart}
          />
        </Card>

        <Card>
          <View style={styles.head}>
            <Ionicons name="pricetag-outline" size={18} color={colors.accent} />
            <Text style={[type.label, { color: colors.ink }]}>{t('insights.spendingTitle')}</Text>
          </View>
          {[
            [t('category.fruit_veg'), 12840],
            [t('category.dairy_eggs'), 8210],
            [t('category.pantry'), 6470],
            [t('category.meat_fish'), 5930],
          ].map(([label, cents]) => (
            <View key={String(label)} style={styles.row}>
              <Text style={[type.body, styles.grow, { color: colors.ink }]}>{label}</Text>
              <Text style={[type.price, { color: colors.ink }]}>{money(Number(cents))}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <View style={styles.head}>
            <Ionicons name="storefront-outline" size={18} color={colors.accent} />
            <Text style={[type.label, { color: colors.ink }]}>{t('insights.whereTitle')}</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.seg, { flex: 5, backgroundColor: colors.accent }]} />
            <View style={[styles.seg, { flex: 3, backgroundColor: colors.accentSoft }]} />
            <View style={[styles.seg, { flex: 2, backgroundColor: colors.line }]} />
          </View>
        </Card>
      </Teaser>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  bar: { flexDirection: 'row', height: 16, borderRadius: radii.sm, overflow: 'hidden' },
  seg: { height: '100%' },
});
