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
import { useT } from '@/store/locale';
import type { List } from '@/store/groceries';
import { DURATION, EASE } from '@/lib/motion';
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
  onRename: (list: List) => void;
}

const toPositions = (lists: List[]): Positions =>
  Object.fromEntries(lists.map((l, i) => [l.id, i]));

/**
 * Edit mode for Your Lists. Rows keep the normal rectangular layout and
 * breathe gently. Dragging a row's handle moves it up/down and the row it
 * passes over slides into the vacated slot immediately (live swap), so the
 * exchange is always visible — nothing waits for the drop.
 */
export function EditList({ lists, onDelete, onReorder, onRename }: EditListProps) {
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
          onRename={onRename}
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
  onRename: (list: List) => void;
}

function Row({ list, positions, count, onCommit, onDelete, onRename }: RowProps) {
  const { colors } = useTheme();
  const t = useT();
  const id = list.id;

  const dragging = useSharedValue(false);
  const dragY = useSharedValue(0);
  const startY = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    // Gentle breathing: barely-there zoom, slow cycle.
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.012, { duration: DURATION.breathe }),
        withTiming(0.995, { duration: DURATION.breathe }),
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
      top: dragging.value ? dragY.value : withTiming(slotY, { duration: DURATION.settle }),
      zIndex: dragging.value ? 10 : 0,
      transform: [{ scale: dragging.value ? 1.03 : breathe.value }],
    };
  });

  const confirmDelete = () => {
    Alert.alert(t('lists.deleteTitle'), t('lists.deleteBody', { name: list.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('lists.deleteConfirm'),
        style: 'destructive',
        onPress: () => onDelete(list.id),
      },
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

        {/* Tapping the name renames it. Only reachable in edit mode, where the
            row no longer navigates into the list — so the tap has nothing to
            compete with, and the two existing controls (delete, drag) keep
            their own hit areas on either side. The pencil is there because a
            tappable line of text with no affordance is one nobody taps. */}
        <Pressable
          onPress={() => onRename(list)}
          style={styles.body}
          accessibilityRole="button"
          accessibilityLabel={t('lists.renameA11y', { name: list.name })}
        >
          <View style={styles.nameRow}>
            <Text
              style={[type.body, { color: colors.ink }, styles.name]}
              numberOfLines={1}
            >
              {list.name}
            </Text>
            <Ionicons name="pencil" size={13} color={colors.muted} />
          </View>
          <Text style={[type.sub, { color: colors.muted }]}>
            {t('lists.itemsCount', { count: list.items.length })}
          </Text>
        </Pressable>

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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Shrinks so a long list name truncates rather than pushing the pencil out.
  name: { flexShrink: 1 },
  body: { flex: 1, minWidth: 0, gap: 1 },
  handle: {
    width: 44,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
