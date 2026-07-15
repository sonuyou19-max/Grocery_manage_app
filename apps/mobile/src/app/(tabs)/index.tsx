import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Pill } from '@/components/pill';
import { Screen } from '@/components/screen';
import { spacing, type, useTheme } from '@/theme';

/**
 * Home: AI restock suggestions lead the screen, then the household's lists.
 * Sample data placeholder — replaced by Supabase queries in the next phase.
 */

const SAMPLE_SUGGESTIONS = [
  { name: 'Semi-skimmed milk', eta: '~1 day left', tone: 'crit' as const },
  { name: 'Espresso beans', eta: '~3 days', tone: 'warn' as const },
];

const SAMPLE_LISTS = [
  { name: 'Weekly groceries', detail: 'Lidl · 12 items · 4 checked', total: '€24.05' },
  { name: 'Saturday market', detail: '7 items · shared with Jonas', total: '€13.60' },
];

export default function ListsScreen() {
  const { colors } = useTheme();

  return (
    <Screen title="Good evening" subtitle="Your household · lists & suggestions">
      <Card accented>
        <Pill label="✦ Running low" />
        {SAMPLE_SUGGESTIONS.map((s) => (
          <View key={s.name} style={styles.row}>
            <View
              style={[
                styles.dot,
                { backgroundColor: s.tone === 'crit' ? colors.crit : colors.warn },
              ]}
            />
            <Text style={[type.body, styles.grow, { color: colors.ink }]}>{s.name}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{s.eta}</Text>
          </View>
        ))}
      </Card>

      <Text style={[type.label, { color: colors.muted }]}>Your lists</Text>
      {SAMPLE_LISTS.map((l) => (
        <Card key={l.name}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>{l.name}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{l.detail}</Text>
            </View>
            <Text style={[type.price, { color: colors.ink }]}>{l.total}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
