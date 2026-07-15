import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { spacing, type, useTheme } from '@/theme';

/**
 * Pantry: learned consumption rates per item — stock bar + days-left estimate.
 * Sample data placeholder — driven by consumption_events once the backend lands.
 */

const SAMPLE_PANTRY = [
  { name: 'Semi-skimmed milk', note: 'usually lasts 5 days', left: 0.12, eta: '~1 day left' },
  { name: 'Espresso beans', note: 'usually lasts 18 days', left: 0.26, eta: '~3 days left' },
  { name: 'Olive oil', note: '1 L · usually lasts 2 months', left: 0.7, eta: '~5 weeks left' },
];

export default function PantryScreen() {
  const { colors } = useTheme();

  const barColor = (left: number) =>
    left < 0.15 ? colors.crit : left < 0.35 ? colors.warn : colors.accent;

  return (
    <Screen title="Pantry" subtitle="Tracked items · estimates improve with use">
      <Card>
        {SAMPLE_PANTRY.map((item) => (
          <View key={item.name} style={styles.row}>
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>{item.name}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{item.note}</Text>
            </View>
            <View style={styles.stock}>
              <View style={[styles.bar, { backgroundColor: colors.line }]}>
                <View
                  style={[
                    styles.fill,
                    { width: `${item.left * 100}%`, backgroundColor: barColor(item.left) },
                  ]}
                />
              </View>
              <Text style={[type.sub, { color: colors.muted }]}>{item.eta}</Text>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  grow: { flex: 1 },
  stock: { width: 96, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
