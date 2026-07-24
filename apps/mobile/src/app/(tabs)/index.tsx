import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { EditList } from '@/components/edit-list';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { ListPickerSheet } from '@/components/list-picker-sheet';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { WeeklyListSheet } from '@/components/weekly-list-sheet';
import { euros } from '@/lib/money';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { normalizeKey } from '@/lib/pantry-intel';
import { buildWeeklySuggestions, type WeeklySuggestion } from '@/lib/weekly-list';
import { useAuth } from '@/store/auth';
import { useGroceries, type List } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { usePantryIntel, useVibeDeck } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/** Time-of-day greeting key based on the device's local clock. */
function greetingKey(date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = date.getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/**
 * "All set" copy for the Vibe Check card when nothing's due. Rotates daily so it
 * feels alive — first-person, casual, a little fun.
 */
const VIBE_EMPTY_MESSAGES: Array<{ title: string; body: string }> = [
  {
    title: 'All good in the pantry 🧺',
    body: "Nothing running low yet. Shop like you normally would — I'll get a feel for your rhythm and give you a heads-up before stuff runs out.",
  },
  {
    title: 'Nothing to swipe… yet 😌',
    body: "Your shelves are looking healthy. The more you shop, the more I learn your habits — then I'll nudge you before the milk betrays you.",
  },
  {
    title: "You're all stocked up",
    body: 'Nothing to review right now. As you shop, I get a feel for how fast things disappear and pop them here before you’re caught short.',
  },
  {
    title: 'All clear ✨',
    body: "No low items today. Keep shopping — I'm quietly learning your pace so nothing sneaks up on you.",
  },
  {
    title: "Pantry's happy 🥑",
    body: "Nothing to check off yet. Shop as usual and I'll learn what you burn through fastest — then flag it here before you run dry.",
  },
  {
    title: "Nice — nothing's low",
    body: "Do your thing at the shops. I'll learn your pace and drop a reminder here right before you run out.",
  },
];

/** Deterministic pick that advances once per day and cycles through them all. */
const vibeEmptyMessage = () =>
  VIBE_EMPTY_MESSAGES[Math.floor(Date.now() / 86_400_000) % VIBE_EMPTY_MESSAGES.length];

export default function ListsScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { lists, addList, addParsedItem, deleteList, reorderLists } = useGroceries();
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const { stats } = usePantryIntel();
  const { count: vibeCount } = useVibeDeck();
  const vibeEmpty = vibeEmptyMessage();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  // Items the builder handed off, awaiting a destination-list choice.
  const [pendingItems, setPendingItems] = useState<WeeklySuggestion[]>([]);

  // Predicted-low items not already on a list — the weekly-list suggestions.
  const excludeKeys = useMemo(
    () => new Set(lists.flatMap((l) => l.items).map((it) => normalizeKey(it.name))),
    [lists],
  );
  const suggestions = useMemo(
    () => buildWeeklySuggestions(stats, excludeKeys, Date.now()),
    [stats, excludeKeys],
  );

  // On first launch, show the feature tour over the home screen (once per
  // install). The ref guards against the effect firing twice.
  const tourChecked = useRef(false);
  useEffect(() => {
    if (tourChecked.current) return;
    tourChecked.current = true;
    void hasSeenOnboarding().then((seen) => {
      if (!seen) router.push('/onboarding');
    });
  }, []);

  // First name from the household display name the user chose, when available.
  const myName = members.find((m) => m.user_id === user?.id)?.display_name?.trim();
  const firstName = myName ? myName.split(/\s+/)[0] : null;
  const base = t(`greeting.${greetingKey()}`);
  const greeting = firstName ? `${base}, ${firstName}` : base;

  const openNewList = (name: string) => {
    const id = addList(name);
    setCreating(false);
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  // Builder handed off the ticked items → ask which list to add them to.
  const onBuild = (selected: WeeklySuggestion[]) => {
    setBuilderOpen(false);
    setPendingItems(selected);
  };

  const addWeeklyToList = (listId: string) => {
    const items = pendingItems;
    setPendingItems([]);
    if (items.length === 0) return;
    // addParsedItem fills the usual store from per-item memory (#3) itself.
    for (const s of items) {
      addParsedItem(listId, {
        name: s.display,
        category: s.category,
        quantity: s.quantity,
        unit: s.unit,
      });
    }
    router.push({ pathname: '/list/[id]', params: { id: listId } });
  };

  const empty = lists.length === 0;

  // Deleting the last list while in edit mode left `editing` stuck true —
  // the "Done" button only renders in the non-empty branch below, and the Fab
  // is hidden while editing, so there was no way back to the Fab at all.
  // Exiting edit mode as soon as the list becomes empty closes that dead end.
  useEffect(() => {
    if (empty && editing) setEditing(false);
  }, [empty, editing]);

  return (
    <>
      <Screen title={greeting} subtitle={household ? household.name : t('greeting.subtitle')} hasFab>
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
                  <Text style={[type.label, { color: colors.muted, marginBottom: 3 }]}>
                    Pantry Vibe Check
                  </Text>
                  <Text style={[type.body, { color: colors.ink }]}>{vibeEmpty.title}</Text>
                  <Text style={[type.sub, { color: colors.muted, marginTop: 2 }]}>{vibeEmpty.body}</Text>
                </View>
              </View>
            </Card>
          ))}

        {!editing && suggestions.length > 0 && (
          <Pressable
            onPress={() => setBuilderOpen(true)}
            style={[styles.buildRow, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
          >
            <Ionicons name="sparkles" size={18} color={colors.accent} />
            <Text style={[type.body, { color: colors.accent, flex: 1 }]}>Build this week's list</Text>
            <View style={[styles.buildPill, { backgroundColor: colors.accent }]}>
              <Text style={[type.sub, { color: colors.accentInk, fontWeight: '700' }]}>
                {suggestions.length}
              </Text>
            </View>
          </Pressable>
        )}

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
      <WeeklyListSheet
        visible={builderOpen}
        suggestions={suggestions}
        onClose={() => setBuilderOpen(false)}
        onBuild={onBuild}
      />
      <ListPickerSheet
        visible={pendingItems.length > 0}
        title="Add these items to"
        onCancel={() => setPendingItems([])}
        onPick={addWeeklyToList}
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
  buildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  buildPill: {
    minWidth: 22,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
