import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { Card } from '@/components/card';
import { Fab } from '@/components/fab';
import { EditList } from '@/components/edit-list';
import { Pill } from '@/components/pill';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { euros } from '@/lib/money';
import { useGroceries, type List } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Suggestion {
  name: string;
  eta: string;
  tone: 'crit' | 'warn';
}

const INITIAL_SUGGESTIONS: Suggestion[] = [
  { name: 'Semi-skimmed milk', eta: '~1 day left', tone: 'crit' },
  { name: 'Espresso beans', eta: '~3 days', tone: 'warn' },
  { name: 'Toilet paper', eta: '~4 days', tone: 'warn' },
];

export default function ListsScreen() {
  const { colors } = useTheme();
  const { lists, addList, addItem, deleteList, reorderLists } = useGroceries();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(INITIAL_SUGGESTIONS);

  const openNewList = (name: string) => {
    const id = addList(name);
    setCreating(false);
    router.push({ pathname: '/list/[id]', params: { id } });
  };

  const removeSuggestion = (name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSuggestions((prev) => prev.filter((s) => s.name !== name));
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
          {suggestions.length === 0 ? (
            <View style={styles.caughtUp}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={[type.sub, { color: colors.muted }]}>All caught up — nothing running low.</Text>
            </View>
          ) : (
            suggestions.map((s) => (
              <SuggestionRow
                key={s.name}
                suggestion={s}
                onAdd={() => {
                  const target = lists[0];
                  if (target) addItem(target.id, s.name);
                }}
                onDone={() => removeSuggestion(s.name)}
              />
            ))
          )}
        </Card>

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

/**
 * A running-low suggestion. Tapping Add strikes the item through, flips the
 * chip to "Added", then fades and collapses the row away.
 */
function SuggestionRow({
  suggestion,
  onAdd,
  onDone,
}: {
  suggestion: Suggestion;
  onAdd: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const [added, setAdded] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotion.current = v;
    });
  }, []);

  const handleAdd = () => {
    if (added) return;
    setAdded(true);
    onAdd();

    const finish = () => onDone();
    if (reduceMotion.current) {
      setTimeout(finish, 500);
      return;
    }
    Animated.sequence([
      Animated.delay(650),
      Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start(finish);
  };

  return (
    <Animated.View style={[styles.suggestion, { opacity }]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: suggestion.tone === 'crit' ? colors.crit : colors.warn },
          added && { backgroundColor: colors.accent },
        ]}
      />
      <Text
        style={[
          type.body,
          styles.grow,
          { color: added ? colors.muted : colors.ink },
          added && styles.struck,
        ]}
      >
        {suggestion.name}
      </Text>
      {!added && <Text style={[type.sub, { color: colors.muted }]}>{suggestion.eta}</Text>}
      <Pressable
        onPress={handleAdd}
        style={[
          styles.addChip,
          { borderColor: colors.accent },
          added && { backgroundColor: colors.accent },
        ]}
        hitSlop={6}
      >
        {added ? (
          <View style={styles.addedRow}>
            <Ionicons name="checkmark" size={13} color={colors.accentInk} />
            <Text style={[styles.addChipText, { color: colors.accentInk }]}>Added</Text>
          </View>
        ) : (
          <Text style={[styles.addChipText, { color: colors.accent }]}>Add</Text>
        )}
      </Pressable>
    </Animated.View>
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
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  grow: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  struck: { textDecorationLine: 'line-through' },
  addChip: {
    borderWidth: 1.5,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.md,
    minWidth: 58,
    alignItems: 'center',
  },
  addChipText: { fontSize: 12, fontWeight: '800' },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
