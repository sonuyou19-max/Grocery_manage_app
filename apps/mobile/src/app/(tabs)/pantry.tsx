import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { usePantry } from '@/store/pantry';
import { spacing, type, useTheme } from '@/theme';

/**
 * Pantry: learned consumption rates per item — stock bar + days-left estimate.
 * Estimates come from consumption events once the backend lands; for now the
 * store seeds a few and lets you add your own.
 */
export default function PantryScreen() {
  const { colors } = useTheme();
  const { pantry, addPantryItem } = usePantry();
  const [adding, setAdding] = useState(false);

  const lowCount = pantry.filter((p) => p.left < 0.35).length;

  const barColor = (left: number) =>
    left < 0.15 ? colors.crit : left < 0.35 ? colors.warn : colors.accent;

  return (
    <>
      <Screen
        title="Pantry"
        subtitle={`${pantry.length} tracked · ${lowCount} running low`}
      >
        <Card>
          {pantry.map((item, i) => (
            <View
              key={item.id}
              style={[
                styles.row,
                i < pantry.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
              ]}
            >
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

      <Fab label="Track item" onPress={() => setAdding(true)} />
      <TextPromptModal
        visible={adding}
        title="Track a pantry item"
        placeholder="e.g. Olive oil"
        confirmLabel="Track"
        onCancel={() => setAdding(false)}
        onSubmit={(name) => {
          addPantryItem(name);
          setAdding(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  grow: { flex: 1 },
  stock: { width: 100, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
