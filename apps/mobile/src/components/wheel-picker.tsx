import { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { haptics } from '@/lib/haptics';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * A flick-to-choose wheel, the way an alarm clock sets its hour.
 *
 * ---------------------------------------------------------------------------
 * Why this is written rather than installed
 * ---------------------------------------------------------------------------
 *
 * The obvious answer is @react-native-picker/picker, and it is the wrong one
 * twice over.
 *
 * It is not a wheel on Android. The package renders the platform control, which
 * on iOS is the spinning drum everybody pictures and on Android is a dropdown
 * menu. Asking for "flick up and down" and shipping a dropdown to the platform
 * this app is mostly used on would be answering a different request.
 *
 * And it is a native module. Every change on this branch so far has reached the
 * phone through `eas update` — a JavaScript-only over-the-air push. A new native
 * dependency cannot travel that way: it needs a fresh dev build installed by
 * hand before anything works at all. That is a real cost to pay for a control
 * that is a snapping ScrollView underneath.
 *
 * So: a ScrollView with `snapToInterval`, which is the same mechanism the native
 * pickers use, behaves identically on both platforms, and ships over the air.
 *
 * ---------------------------------------------------------------------------
 * The details that make it feel like a wheel rather than a list
 * ---------------------------------------------------------------------------
 *
 * - Padding, not a spacer view, centres the first and last rows. A wheel must be
 *   able to select its ends, and without half a viewport of padding above and
 *   below, the first and last values can never reach the middle.
 * - `decelerationRate="fast"`, or a flick coasts through six values and lands
 *   somewhere nobody aimed at.
 * - The selection is read on momentum end AND on drag end. A slow drag that is
 *   released without a flick fires no momentum event at all, and the value would
 *   silently stay where it was while the wheel visibly sits somewhere else.
 * - A tick of haptics as the value changes, which is most of what makes a wheel
 *   feel mechanical rather than like scrolling a page.
 *
 * ---------------------------------------------------------------------------
 * Accessibility
 * ---------------------------------------------------------------------------
 *
 * A scroll view full of text is close to unusable with a screen reader — it
 * announces every value and gives no way to pick one. So the whole control is an
 * `adjustable`: it reports the current value, and increment/decrement move it by
 * one, which is what TalkBack and VoiceOver already know how to drive. The rows
 * themselves are hidden from the tree, since they would otherwise be read out a
 * second time.
 */

const ITEM_HEIGHT = 34;
/** Three rows: the choice, and one either side to show which way it moves. */
const VISIBLE = 3;
const HEIGHT = ITEM_HEIGHT * VISIBLE;
const PAD = (HEIGHT - ITEM_HEIGHT) / 2;

export interface WheelOption<T> {
  value: T;
  label: string;
}

export function WheelPicker<T extends string | number | null>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: WheelOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollView>(null);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  /*
   * What the wheel last reported, so a scroll that settles on the value it
   * started from does not fire onChange — and, more importantly, so the effect
   * below can tell "the caller changed this" from "we just told the caller".
   * Without it, every selection scrolls the wheel back to where it already is,
   * which cancels the momentum mid-flick.
   */
  const reported = useRef(index);

  useEffect(() => {
    if (reported.current === index) return;
    reported.current = index;
    scroll.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
  }, [index]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const clamped = Math.min(options.length - 1, Math.max(0, next));
    if (clamped === reported.current) return;
    reported.current = clamped;
    haptics.tick();
    onChange(options[clamped].value);
  };

  const step = (delta: number) => {
    const next = Math.min(options.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    reported.current = next;
    scroll.current?.scrollTo({ y: next * ITEM_HEIGHT, animated: true });
    haptics.tick();
    onChange(options[next].value);
  };

  return (
    <View
      style={[styles.frame, { borderColor: colors.line, backgroundColor: colors.surface }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: options[index]?.label ?? '' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') step(1);
        if (e.nativeEvent.actionName === 'decrement') step(-1);
      }}
    >
      {/* The band that says which row counts. Behind the values and ignoring
          touches, so it never eats a flick. */}
      <View
        pointerEvents="none"
        style={[styles.band, { backgroundColor: colors.accentSoft }]}
      />
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={styles.content}
        contentOffset={{ x: 0, y: index * ITEM_HEIGHT }}
        onMomentumScrollEnd={settle}
        // A slow drag released without a flick produces no momentum event, and
        // the wheel would sit on a value it never reported.
        onScrollEndDrag={settle}
        importantForAccessibility="no-hide-descendants"
      >
        {options.map((o, i) => (
          <Pressable
            key={String(o.value)}
            // Tapping a neighbour is faster than flicking one step, and a wheel
            // that ignores a direct tap on a visible value feels broken.
            onPress={() => step(i - index)}
            style={styles.item}
          >
            <Text
              numberOfLines={1}
              style={[
                type.body,
                { color: i === index ? colors.accent : colors.muted },
                i !== index && styles.dim,
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: HEIGHT,
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    // The wheel sizes to its column rather than to its longest label, so two of
    // them side by side stay the same width.
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PAD,
    height: ITEM_HEIGHT,
  },
  // Half a viewport above and below, so the first and last values can reach the
  // middle. A wheel that cannot select its own ends is a broken wheel.
  content: { paddingVertical: PAD },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  // The rows either side are present to show which way the wheel moves, not to
  // be read; dimming them is what stops the control looking like a list.
  dim: { opacity: 0.45 },
});
