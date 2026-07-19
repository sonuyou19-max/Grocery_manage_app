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
import { useAuth } from '@/store/auth';
import { useGroceries, type List } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useVibeDeck } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/** Time-of-day greeting based on the device's local clock. */
function timeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function ListsScreen() {
  const { colors } = useTheme();
  const { lists, addList, deleteList, reorderLists } = useGroceries();
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const { count: vibeCount } = useVibeDeck();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  // First name from the household display name the user chose, when available.
  const myName = members.find((m) => m.user_id === user?.id)?.display_name?.trim();
  const firstName = myName ? myName.split(/\s+/)[0] : null;
  const greeting = firstName ? `${timeGreeting()}, ${firstName}` : timeGreeting();

  const openNewList = (name: string) => {
    const id = addList(name);
    setCreating(false);
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  const empty = lists.length === 0;

  return (
    <>
      <Screen title={greeting} subtitle={household ? household.name : 'Your grocery lists'}>
        {!editing &&
          (vibeCount > 0 ? (
            <Pressable onPress={() => router.push('/vibe-check')}>
              <Card accented>
                <View style={styles.vibeRow}>
                  <Text style={styles.vibeEmoji}>☕️</Text>
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>Pantry Vibe Check</Text>
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {vibeCount} item{vibeCount === 1 ? '' : 's'} to review · 10 seconds
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.accent} />
                </View>
              </Card>
            </Pressable>
          ) : (
            <Card>
              <View style={[styles.vibeRow, { alignItems: 'flex-start' }]}>
                <Ionicons name="checkmark-circle" size={26} color={colors.accent} />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]}>Pantry Vibe Check · All set</Text>
                  <Text style={[type.sub, { color: colors.muted }]}>
                    Nothing to review right now. As you shop, Korb learns how fast you get through
                    things and surfaces them here — a quick swipe — before you run out.
                  </Text>
                </View>
              </View>
            </Card>
          ))}
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
  vibeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vibeEmoji: { fontSize: 26 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
