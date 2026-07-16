import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Fab } from '@/components/fab';
import { Pill } from '@/components/pill';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { euros } from '@/lib/money';
import { useGroceries, type List } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

const SUGGESTIONS = [
  { name: 'Semi-skimmed milk', eta: '~1 day left', tone: 'crit' as const },
  { name: 'Espresso beans', eta: '~3 days', tone: 'warn' as const },
];

export default function ListsScreen() {
  const { colors } = useTheme();
  const { lists, addList, addItem } = useGroceries();
  const [creating, setCreating] = useState(false);

  const openNewList = (name: string) => {
    const id = addList(name);
    setCreating(false);
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  return (
    <>
      <Screen title="Good evening" subtitle="Your household · lists & suggestions">
        {/* AI restock suggestions lead the screen */}
        <Card accented>
          <View style={styles.cardHead}>
            <Pill label="✦ Running low" />
            <Text style={[type.sub, { color: colors.muted }]}>from your usage</Text>
          </View>
          {SUGGESTIONS.map((s) => (
            <View key={s.name} style={styles.suggestion}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: s.tone === 'crit' ? colors.crit : colors.warn },
                ]}
              />
              <Text style={[type.body, styles.grow, { color: colors.ink }]}>{s.name}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{s.eta}</Text>
              <Pressable
                onPress={() => {
                  const target = lists[0];
                  if (target) addItem(target.id, s.name);
                }}
                style={[styles.addChip, { borderColor: colors.accent }]}
                hitSlop={6}
              >
                <Text style={[styles.addChipText, { color: colors.accent }]}>Add</Text>
              </Pressable>
            </View>
          ))}
        </Card>

        <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>Your lists</Text>
        {lists.map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
      </Screen>

      <Fab label="New list" onPress={() => setCreating(true)} />
      <TextPromptModal
        visible={creating}
        title="New list"
        placeholder="e.g. Weekly groceries"
        confirmLabel="Create"
        onCancel={() => setCreating(false)}
        onSubmit={openNewList}
      />
    </>
  );
}

function ListCard({ list }: { list: List }) {
  const { colors } = useTheme();
  const checked = list.items.filter((it) => it.checked).length;
  const priced = list.items.filter((it) => it.priceCents != null);
  const total = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
  const progress = list.items.length ? checked / list.items.length : 0;

  return (
    <Pressable onPress={() => router.push({ pathname: '/list/[id]', params: { id: list.id } })}>
      <Card>
        <View style={styles.listHead}>
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]}>{list.name}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {list.store ? `${list.store} · ` : ''}
              {list.items.length} item{list.items.length === 1 ? '' : 's'} · {checked} in cart
            </Text>
          </View>
          {priced.length > 0 ? (
            <Text style={[type.price, { color: colors.ink }]}>{euros(total)}</Text>
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          )}
        </View>
        {list.items.length > 0 && (
          <View style={[styles.track, { backgroundColor: colors.line }]}>
            <View
              style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]}
            />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  addChip: { borderWidth: 1.5, borderRadius: radii.pill, paddingVertical: 3, paddingHorizontal: spacing.md },
  addChipText: { fontSize: 12, fontWeight: '800' },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
