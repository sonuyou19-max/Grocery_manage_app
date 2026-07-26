import { StyleSheet, Text, View } from 'react-native';

import type { WeekSpend } from '@/lib/purchase-log';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Weekly logged spend as a column chart.
 *
 * Design decisions worth not undoing:
 *
 * - **One fill for every bar, never shaded by value.** Bar length already
 *   encodes the amount; darkening the tall ones would double-encode it and burn
 *   the only free channel on information already on screen.
 * - **The current week is labelled, not recoloured.** It's incomplete data, not
 *   a smaller amount, and a lighter fill would read as "spent less" — the exact
 *   wrong conclusion on a Monday morning. A word says what a shade can't.
 * - **Empty weeks render a flat stub, not nothing.** A missing bar reads as a
 *   rendering bug; a stub on the baseline reads as "you logged nothing", which is
 *   what actually happened.
 * - **Only two direct labels** (the peak, and the current week). A number over
 *   every bar is noise, and the whole point of this card is one glance.
 *
 * No legend: a single series is named by the card's own title.
 */

/** Plot height. Tall enough to compare, short enough to stay a glance. */
const PLOT_HEIGHT = 64;
/** Thin marks — a saturated fill is for small marks, not big blocks. */
const BAR_WIDTH = 14;
/** Flat mark for a week with nothing logged. */
const EMPTY_STUB = 2;

interface SpendTrendChartProps {
  weeks: WeekSpend[];
  /** Highlighted with a label as still in progress. */
  currentWeekStart: number;
  peakWeekStart: number | null;
}

export function SpendTrendChart({ weeks, currentWeekStart, peakWeekStart }: SpendTrendChartProps) {
  const { colors } = useTheme();
  const { t, money, language } = useLocale();

  const max = Math.max(...weeks.map((w) => w.cents), 1);

  const dayMonth = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });
  const first = weeks[0];
  const last = weeks[weeks.length - 1];

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('insights.trendA11y', {
        count: weeks.length,
        // A screen reader can't scan bars, so it gets the shape in words.
        summary: weeks
          .map((w) => `${dayMonth.format(new Date(w.weekStart))}: ${money(w.cents)}`)
          .join(', '),
      })}
    >
      <View style={[styles.plot, { height: PLOT_HEIGHT }]}>
        {weeks.map((w) => {
          const isCurrent = w.weekStart === currentWeekStart;
          const isPeak = w.weekStart === peakWeekStart && w.cents > 0;
          const height = w.cents > 0 ? Math.max(EMPTY_STUB, (w.cents / max) * PLOT_HEIGHT) : EMPTY_STUB;

          return (
            <View key={w.weekStart} style={styles.column}>
              {/* The peak's value sits above its bar — the one number worth
                  reading without tapping anything. */}
              {isPeak && (
                <Text style={[type.sub, styles.peakLabel, { color: colors.muted }]} numberOfLines={1}>
                  {money(w.cents)}
                </Text>
              )}
              <View
                style={[
                  styles.bar,
                  {
                    height,
                    width: BAR_WIDTH,
                    // An empty week's stub is a baseline rule, not a short
                    // column, so it never reads as a tiny amount.
                    backgroundColor: w.cents > 0 ? colors.accent : colors.line,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* Hairline baseline, one shade off the surface — recessive by design. */}
      <View style={[styles.axis, { backgroundColor: colors.line }]} />

      <View style={styles.axisLabels}>
        <Text style={[type.sub, { color: colors.muted }]}>
          {first ? dayMonth.format(new Date(first.weekStart)) : ''}
        </Text>
        <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendThisWeek')}</Text>
      </View>
      {/* Names the incomplete bar in words rather than shading it. */}
      {last && last.weekStart === currentWeekStart && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendPartial')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    // The gap between columns shows the card surface — no borders drawn
    // around marks to separate them.
    gap: spacing.xs,
  },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  peakLabel: { marginBottom: 2, fontVariant: ['tabular-nums'] },
  // Rounded data-end anchored to the baseline: square where it meets the axis.
  bar: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  axis: { height: StyleSheet.hairlineWidth, borderRadius: radii.sm },
  axisLabels: { flexDirection: 'row', justifyContent: 'space-between' },
});
