import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { EditList } from '@/components/edit-list';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { StoreGroups } from '@/components/store-groups';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { euros } from '@/lib/money';
import { useGroceries, type List } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { radii, spacing, type, useTheme } from '@/theme';

export default function ListsScreen() {
  const { colors } = useTheme();
  const { lists, addList, deleteList, reorderLists } = useGroceries();
  const { household } = useHousehold();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  const openNewList = (name: string) => {
    const id = addList(name);
    setCreating(false);
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  const empty = lists.length === 0;

  return (
    <>
      <Screen title="Good evening" subtitle={household ? household.name : 'Your grocery lists'}>
        {empty ? (
          <EmptyState
            icon="basket-outline"
            title="No lists yet"
            body="Tap “New list” to start your first shopping list. Add items, tick them off as you shop, and (once you’re in a household) share it live with the people you shop for."
          />
        ) : (
          <>
            <View style={styles.listsHead}>
              <Text style={[type.label, { color: colors.muted }]}>Your lists</Text>
              {editing ? (
                <Pressable onPress={() => setEditing(false)} hitSlop={8}>
                  <Text style={[type.body, { color: colors.accent }]}>Done</Text>
                </Pressable>
              ) : (
                <Text style={[type.sub, { color: colors.muted }]}>hold to edit</Text>
              )}
            </View>

            {editing ? (
              <EditList lists={lists} onDelete={deleteList} onReorder={reorderLists} />
            ) : (
              lists.map((l) => (
                <ListCard key={l.id} list={l} onLongPress={() => setEditing(true)} />
              ))
            )}

            {!editing && <StoreGroups />}
          </>
        )}
      </Screen>

      {!editing && <Fab label="New list" onPress={() => setCreating(true)} />}
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

function ListCard({ list, onLongPress }: { list: List; onLongPress: () => void }) {
  const { colors } = useTheme();
  const checked = list.items.filter((it) => it.checked).length;
  const priced = list.items.filter((it) => it.priceCents != null);
  const total = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
  const progress = list.items.length ? checked / list.items.length : 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/list/[id]', params: { id: list.id } })}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
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
  listsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  grow: { flex: 1, minWidth: 0 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
