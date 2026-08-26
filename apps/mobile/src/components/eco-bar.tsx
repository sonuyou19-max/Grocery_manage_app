import { StyleSheet, Text, View } from 'react-native';

import { StackedBar } from '@/components/stacked-bar';
import { CARBON_COLORS, type CarbonTier } from '@/lib/eco';
import { useT } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * The low / medium / high bar, and nothing else.
 *
 * There was an `EcoDot` here too, rendered beside every item's name on the
 * list. It is gone: a coloured band on every row turns writing a shopping list
 * into being marked, and a judgement you did not ask for on a screen you use
 * twice a day stops being information and becomes nagging. The same claim
 * survives in this bar, where it is a summary you look at rather than a verdict
 * on each line.
 */

export interface EcoBarProps {
  shares: Record<CarbonTier, number>;
  counts: Record<CarbonTier, number>;
  /** Hide the percentage legend where the bar is a glance, not a readout. */
  compact?: boolean;
}

/** Low / medium / high as one weighted bar, lightest first. */
export function EcoBar({ shares, counts, compact = false }: EcoBarProps) {
  const { colors } = useTheme();
  const t = useT();
  // Lightest first, always. The order is fixed rather than sorted by size so
  // the bar means the same thing week to week — a sorted bar would reshuffle
  // as the basket changed and turn a comparison into a puzzle.
  const order: CarbonTier[] = ['low', 'medium', 'high'];
  const present = order.filter((tier) => counts[tier] > 0);

  return (
    <View style={styles.wrap}>
      {/* `shares`, not `counts`. The bar drew itself from the raw counts while
          the legend beside it printed the shares — the same numbers by
          construction, but two sources for one figure, and the kind of pair
          that only stays in step until somebody changes how a share is
          weighted. */}
      <StackedBar
        segments={present.map((tier) => ({
          key: tier,
          share: shares[tier],
          color: CARBON_COLORS[tier],
        }))}
      />
      {!compact && (
        <View style={styles.legend}>
          {present.map((tier) => (
            <View key={tier} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: CARBON_COLORS[tier] }]} />
              <Text style={[type.sub, { color: colors.ink }]}>
                {t(`eco.tier.${tier}`)} {Math.round(shares[tier] * 100)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
