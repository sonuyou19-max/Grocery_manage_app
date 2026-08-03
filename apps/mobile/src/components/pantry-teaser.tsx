import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { ItemEmoji } from '@/components/item-emoji';
import { Screen } from '@/components/screen';
import { Teaser } from '@/components/teaser';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

import type { ItemCategory } from '@korb/shared';

/**
 * What a signed-out visitor sees on the Pantry tab.
 *
 * The Pantry is the one surface where gating is not only a monetisation choice
 * but a structural one. Its four decision fields — "still good", "always keep
 * this", a pinned cadence, "stop asking" — cannot be reconstructed from a
 * purchase log, so allowing a guest to set them would recreate exactly the
 * merge ambiguity the whole log-as-source-of-truth model removes. Behind an
 * account, nothing a guest can do ever needs reconciling.
 *
 * The copy describes what Korb does, not what the user has done. An earlier
 * version had a second variant for people with existing history, but it was
 * chosen on a threshold of one check-off, so a first-day user was told they had
 * been shopping here "for a while". Describing the feature is true whenever it
 * is read; describing the user is a guess.
 */

/** Invented, and fixed — a teaser that reshuffles on every render looks broken. */
const RUNNING_LOW: Array<{ name: string; category: ItemCategory; days: number; left: number }> = [
  { name: 'Milk', category: 'dairy_eggs', days: 6, left: 1 },
  { name: 'Bread', category: 'bakery', days: 4, left: 0 },
  { name: 'Eggs', category: 'dairy_eggs', days: 5, left: 2 },
  { name: 'Bananas', category: 'fruit_veg', days: 7, left: 1 },
];

const IN_STOCK: Array<{ name: string; category: ItemCategory; days: number; left: number }> = [
  { name: 'Coffee', category: 'pantry', days: 24, left: 16 },
  { name: 'Rice', category: 'pantry', days: 45, left: 31 },
  { name: 'Olive oil', category: 'pantry', days: 40, left: 28 },
  { name: 'Butter', category: 'dairy_eggs', days: 14, left: 9 },
  { name: 'Pasta', category: 'pantry', days: 30, left: 22 },
];

export function PantryTeaser() {
  const { colors } = useTheme();
  const t = useT();

  return (
    <Screen title={t('tabs.pantry')} subtitle={t('pantry.subtitleEmpty')}>
      <Teaser title={t('teaser.pantryTitle')} body={t('teaser.pantryBody')}>
        <Text style={[type.label, { color: colors.muted }]}>{t('pantry.runningLow')}</Text>
        <Card>
          {RUNNING_LOW.map((s) => {
            // A bar that is nearly empty reads as "buy this now" at a glance,
            // which is the whole idea the Pantry is selling.
            const fraction = Math.max(0.06, Math.min(1, s.left / s.days));
            return (
              <View key={s.name} style={styles.row}>
                <ItemEmoji name={s.name} category={s.category} />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]}>{s.name}</Text>
                  <View style={[styles.track, { backgroundColor: colors.line }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          flex: fraction,
                          backgroundColor: s.left <= 1 ? colors.crit : colors.accent,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 - fraction }} />
                  </View>
                </View>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('status.daysLeft', { count: s.left })}
                </Text>
              </View>
            );
          })}
        </Card>

        <Text style={[type.label, { color: colors.muted }]}>{t('pantry.inStock')}</Text>
        <Card>
          {IN_STOCK.map((s) => {
            const fraction = Math.max(0.06, Math.min(1, s.left / s.days));
            return (
              <View key={s.name} style={styles.row}>
                <ItemEmoji name={s.name} category={s.category} />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]}>{s.name}</Text>
                  <View style={[styles.track, { backgroundColor: colors.line }]}>
                    <View style={[styles.fill, { flex: fraction, backgroundColor: colors.accent }]} />
                    <View style={{ flex: 1 - fraction }} />
                  </View>
                </View>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('status.daysLeft', { count: s.left })}
                </Text>
              </View>
            );
          })}
        </Card>
      </Teaser>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  track: { flexDirection: 'row', height: 6, borderRadius: radii.sm, overflow: 'hidden' },
  fill: { height: '100%' },
});
