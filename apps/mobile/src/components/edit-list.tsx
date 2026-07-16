import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { List } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

/** Fixed row height so drag math maps 1:1 to indices. */
const ROW_HEIGHT = 64;
const ROW_GAP = spacing.md;
const STEP = ROW_HEIGHT + ROW_GAP;

interface EditListProps {
  lists: List[];
  onDelete: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}

/**
 * Edit mode for Your Lists. Keeps the normal rectangular row layout — rows
 * breathe gently (slow, subtle zoom in/out) instead of shaking, each has a
 * (−) badge to delete, and the handle drags a row up/down to reorder.
 */
export function EditList({ lists, onDelete, onMove }: EditListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  return (
    <View style={styles.column}>
      {lists.map((list, index) => (
        <Row
          key={list.id}
          list={list}
          index={index}
          count={lists.length}
          isDragging={draggingId === list.id}
          onDragStart={() => setDraggingId(list.id)}
          onDrop={(from, to) => {
            setDraggingId(null);
            onMove(from, to);
          }}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

interface RowProps {
  list: List;
  index: number;
  count: number;
  isDragging: boolean;
  onDragStart: () => void;
  onDrop: (fromIndex: number, toIndex: number) => void;
  onDelete: (id: string) => void;
}

function Row({ list, index, count, isDragging, onDragStart, onDrop, onDelete }: RowProps) {
  const { colors } = useTheme();
  const ty = useSharedValue(0);
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
    .activateAfterLongPress(120)
    .onStart(() => {
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const target = Math.min(Math.max(index + Math.round(e.translationY / STEP), 0), count - 1);
      ty.value = withTiming(0, { duration: 150 });
      runOnJS(onDrop)(index, target);
    })
    .onFinalize(() => {
      ty.value = withTiming(0, { duration: 150 });
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: breathe.value }],
  }));

  const confirmDelete = () => {
    Alert.alert('Delete list', `Delete “${list.name}” and its items?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(list.id) },
    ]);
  };

  return (
    <Animated.View
      layout={LinearTransition.duration(220)}
      style={[styles.rowWrap, isDragging && styles.raised, animStyle]}
    >
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
  column: { gap: ROW_GAP },
  rowWrap: { height: ROW_HEIGHT },
  raised: {
    zIndex: 10,
    elevation: 8,
    shadowColor: '#0A2A14',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
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
