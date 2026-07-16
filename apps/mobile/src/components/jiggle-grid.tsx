import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
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

const GAP = spacing.md;
const COLS = 2;

interface JiggleGridProps {
  lists: List[];
  onDelete: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}

/**
 * iOS-home-screen-style edit mode: square tiles jiggle, each has a (−) to
 * delete the whole list (and its items), and tiles can be dragged to reorder.
 */
export function JiggleGrid({ lists, onDelete, onMove }: JiggleGridProps) {
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const gridRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });

  const tile = width ? (width - GAP * (COLS - 1)) / COLS : 0;

  const measure = () => {
    gridRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  };

  const drop = (fromIndex: number, absX: number, absY: number) => {
    setDragging(null);
    if (!tile) return;
    const localX = absX - origin.current.x;
    const localY = absY - origin.current.y;
    const col = Math.min(Math.max(Math.floor(localX / (tile + GAP)), 0), COLS - 1);
    const row = Math.max(Math.floor(localY / (tile + GAP)), 0);
    const target = Math.min(Math.max(row * COLS + col, 0), lists.length - 1);
    onMove(fromIndex, target);
  };

  return (
    <View
      ref={gridRef}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.grid}
    >
      {tile > 0 &&
        lists.map((list, index) => (
          <Tile
            key={list.id}
            list={list}
            index={index}
            size={tile}
            isDragging={dragging === index}
            onMeasure={measure}
            onDragStart={setDragging}
            onDrop={drop}
            onDelete={onDelete}
          />
        ))}
    </View>
  );
}

interface TileProps {
  list: List;
  index: number;
  size: number;
  isDragging: boolean;
  onMeasure: () => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number, absX: number, absY: number) => void;
  onDelete: (id: string) => void;
}

function Tile({
  list,
  index,
  size,
  isDragging,
  onMeasure,
  onDragStart,
  onDrop,
  onDelete,
}: TileProps) {
  const { colors } = useTheme();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const rot = useSharedValue(0);

  useEffect(() => {
    // Slight per-tile phase so they don't jiggle in lockstep.
    rot.value = withRepeat(
      withSequence(withTiming(-1.4, { duration: 120 }), withTiming(1.4, { duration: 120 })),
      -1,
      true,
    );
    return () => cancelAnimation(rot);
  }, [rot]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      runOnJS(onMeasure)();
    })
    .onStart(() => {
      lift.value = withTiming(1);
      runOnJS(onDragStart)(index);
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onDrop)(index, e.absoluteX, e.absoluteY);
      tx.value = 0;
      ty.value = 0;
      lift.value = withTiming(0);
    })
    .onFinalize(() => {
      tx.value = 0;
      ty.value = 0;
      lift.value = withTiming(0);
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
      { scale: 1 + lift.value * 0.05 },
    ],
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
      style={[{ width: size, height: size }, isDragging && styles.raised, animStyle]}
    >
      <GestureDetector gesture={pan}>
        <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Ionicons name="basket-outline" size={24} color={colors.accent} />
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={2}>
            {list.name}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>
            {list.items.length} item{list.items.length === 1 ? '' : 's'}
          </Text>
        </View>
      </GestureDetector>

      <Pressable
        onPress={confirmDelete}
        hitSlop={8}
        style={[styles.minus, { backgroundColor: colors.crit }]}
      >
        <Ionicons name="remove" size={16} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  raised: {
    zIndex: 10,
    elevation: 8,
    shadowColor: '#0A2A14',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  minus: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
