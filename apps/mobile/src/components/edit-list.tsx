import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import type { List } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

/** Fixed row height so drag math maps 1:1 to indices. */
const ROW_HEIGHT = 64;
const ROW_GAP = spacing.md;
const STEP = ROW_HEIGHT + ROW_GAP;

type Positions = Record<string, number>;

interface EditListProps {
  lists: List[];
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

const toPositions = (lists: List[]): Positions =>
  Object.fromEntries(lists.map((l, i) => [l.id, i]));

/**
 * Edit mode for Your Lists. Rows keep the normal rectangular layout and
 * breathe gently. Dragging a row's handle moves it up/down and the row it
 * passes over slides into the vacated slot immediately (live swap), so the
 * exchange is always visible — nothing waits for the drop.
 */
export function EditList({ lists, onDelete, onReorder }: EditListProps) {
  const positions = useSharedValue<Positions>(toPositions(lists));

  // Keep the animated position map in sync when lists change (add/delete/commit).
  const ids = lists.map((l) => l.id).join(',');
  useEffect(() => {
    positions.value = toPositions(lists);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (current: Positions) => {
    const ordered = [...lists].sort((a, b) => (current[a.id] ?? 0) - (current[b.id] ?? 0));
    onReorder(ordered.map((l) => l.id));
  };

  return (
    <View style={{ height: lists.length * STEP - ROW_GAP }}>
      {lists.map((list) => (
        <Row
          key={list.id}
          list={list}
          positions={positions}
          count={lists.length}
          onCommit={commit}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

interface RowProps {
  list: List;
  positions: SharedValue<Positions>;
  count: number;
  onCommit: (positions: Positions) => void;
  onDelete: (id: string) => void;
}

function Row({ list, positions, count, onCommit, onDelete }: RowProps) {
  const { colors } = useTheme();
  const id = list.id;

  const dragging = useSharedValue(false);
  const dragY = useSharedValue(0);
  const startY = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    // Gentle breathing: barely-there zoom, slow cycle.
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.012, { duration: 1200 }),
        withTiming(0.995, { duration: 1200 }),
      ),
      -1,
      true,
    );
    return () => {
      cancelAnimation(breathe);
      breathe.value = 1;
    };
  }, [breathe]);

  const pan = Gesture.Pan()
    .activateAfterLongPress(100)
    .onStart(() => {
      dragging.value = true;
      startY.value = (positions.value[id] ?? 0) * STEP;
      dragY.value = startY.value;
      runOnJS(haptics.tick)(); // picked up a card
    })
    .onUpdate((e) => {
      dragY.value = startY.value + e.translationY;

      // Live swap: when the dragged row crosses a slot boundary, move the
      // occupant of that slot into our old slot right away.
      const newIndex = Math.min(
        Math.max(Math.round(dragY.value / STEP), 0),
        count - 1,
      );
      const oldIndex = positions.value[id] ?? 0;
      if (newIndex !== oldIndex) {
        const next: Positions = { ...positions.value };
        for (const key in next) {
          if (key !== id && next[key] === newIndex) {
            next[key] = oldIndex;
            break;
          }
        }
        next[id] = newIndex;
        positions.value = next;
        runOnJS(haptics.snap)(); // snapped into a new slot
      }
    })
    .onEnd(() => {
      dragging.value = false;
      runOnJS(onCommit)(positions.value);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  const animStyle = useAnimatedStyle(() => {
    const slotY = (positions.value[id] ?? 0) * STEP;
    return {
      top: dragging.value ? dragY.value : withTiming(slotY, { duration: 200 }),
      zIndex: dragging.value ? 10 : 0,
      transform: [{ scale: dragging.value ? 1.03 : breathe.value }],
    };
  });

  const confirmDelete = () => {
    Alert.alert('Delete list', `Delete “${list.name}” and its items?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(list.id) },
    ]);
  };

  return (
    <Animated.View style={[styles.rowWrap, animStyle]}>
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Pressable
          onPress={confirmDelete}
          hitSlop={10}
          style={[styles.minus, { backgroundColor: colors.crit }]}
        >
          <Ionicons name="remove" size={15} color="#FFFFFF" />
        </Pressable>

        <View style={styles.body}>
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
            {list.name}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>
            {list.items.length} item{list.items.length === 1 ? '' : 's'}
          </Text>
        </View>

        <GestureDetector gesture={pan}>
          <View style={styles.handle} collapsable={false}>
            <Ionicons name="reorder-three-outline" size={26} color={colors.muted} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  minus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 1 },
  handle: {
    width: 44,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
