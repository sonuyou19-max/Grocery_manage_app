import { StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { CARBON_COLORS, type CarbonTier } from '@/lib/eco';
import { carbonFor } from '@/lib/item-carbon';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The impact dot beside an item's name, and the stacked bar that sums them up.
 *
 * Both live here because they are the same claim at two scales, and the one
 * thing that must never drift is which colour means what. A dot that is amber
 * on the list and a bar segment that is amber in Insights have to be the same
 * band or the feature is lying quietly.
 */

/**
 * A single item's band, as a dot.
 *
 * Returns null for non-food rather than a grey dot. Washing-up liquid has a
 * footprint, but not one Korb can place next to a kilo of anything edible, and
 * a neutral dot in a row of coloured ones reads as "we checked and it's fine"
 * rather than "this isn't part of the question".
 *
 * The band is also on the accessible label, never colour alone — the same rule
 * the pantry's staple bookmark follows. Around one in twelve men cannot
 * separate this palette's amber from its red by hue.
 */
export function EcoDot({
  name,
  category,
  size = 8,
}: {
  name: string;
  category: ItemCategory;
  size?: number;
}) {
  const t = useT();
  const tier = carbonFor(name, category);
  if (!tier) return null;
  return (
    <View
      accessibilityLabel={t(`eco.tier.${tier}`)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: CARBON_COLORS[tier],
      }}
    />
  );
}

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
      <View style={[styles.bar, { backgroundColor: colors.line }]}>
        {present.map((tier) => (
          <View key={tier} style={{ flex: counts[tier], backgroundColor: CARBON_COLORS[tier] }} />
        ))}
      </View>
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
  bar: { flexDirection: 'row', height: 16, borderRadius: radii.sm, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
