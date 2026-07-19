import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { CATEGORY_LABELS, categorizeSync } from '@/lib/categorize';
import { dueAt, lastBoughtLabel, lifeRemaining, statusLabel } from '@/lib/pantry-intel';
import { usePantryIntel } from '@/store/pantry-intel';
import { spacing, type, useTheme } from '@/theme';

/**
 * Pantry: the honest view of what Korb is tracking. Every item you check off a
 * list is learned here with a real burn-rate — the bar shows how much of its
 * usual lifespan is left, and low items are the ones the Vibe Check surfaces.
 * "Track item" seeds a staple manually (treated as bought now).
 */
export default function PantryScreen() {
  const { colors } = useTheme();
  const { stats, logPurchase } = usePantryIntel();
  const [adding, setAdding] = useState(false);

  const now = Date.now();
  const items = useMemo(
    () => Object.values(stats).sort((a, b) => dueAt(a) - dueAt(b)),
    [stats],
  );
  const lowCount = items.filter((s) => lifeRemaining(s, now) < 0.35).length;

  const barColor = (left: number) =>
    left < 0.15 ? colors.crit : left < 0.35 ? colors.warn : colors.accent;

  return (
    <>
      <Screen
        title="Pantry"
        subtitle={
          items.length === 0
            ? 'What Korb is tracking'
            : `${items.length} tracked · ${lowCount} running low`
        }
      >
        {items.length === 0 ? (
          <EmptyState
            icon="file-tray-full-outline"
            title="Nothing tracked yet"
            body="As you tick items off your lists, Korb learns how fast you get through them and tracks them here. Or tap “Track item” to add a staple you always keep at home."
          />
        ) : (
          <Card>
            {items.map((item, i) => {
              const left = lifeRemaining(item, now);
              return (
                <View
                  key={item.key}
                  style={[
                    styles.row,
                    i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
                  ]}
                >
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                      {item.display}
                    </Text>
                    <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                      {CATEGORY_LABELS[item.category]} · {lastBoughtLabel(item.lastPurchasedAt, now)}
                    </Text>
                  </View>
                  <View style={styles.stock}>
                    <View style={[styles.bar, { backgroundColor: colors.line }]}>
                      <View
                        style={[styles.fill, { width: `${Math.max(left, 0.02) * 100}%`, backgroundColor: barColor(left) }]}
                      />
                    </View>
                    <Text style={[type.sub, { color: left < 0.35 ? barColor(left) : colors.muted }]}>
                      {statusLabel(item, now)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </Screen>

      <Fab label="Track item" onPress={() => setAdding(true)} />
      <TextPromptModal
        visible={adding}
        title="Track a pantry item"
        placeholder="e.g. Olive oil"
        confirmLabel="Track"
        onCancel={() => setAdding(false)}
        onSubmit={(name) => {
          const clean = name.trim();
          if (clean) logPurchase(clean, categorizeSync(clean));
          setAdding(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  stock: { width: 104, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
