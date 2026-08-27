import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { KorbMark, KorbWord, WORD_ASPECT } from '@/components/korb-mark';
import { SPRING } from '@/lib/motion';

/**
 * The basket, and then the name arriving beside it.
 *
 * ---------------------------------------------------------------------------
 * What it does
 * ---------------------------------------------------------------------------
 *
 * The mark lands alone in the middle of the screen, and a moment later the word
 * comes out from behind it and pushes it left — the two settling as one
 * lockup, centred. It is the app introducing itself in the order a person reads
 * it: the shape first, then what the shape is called.
 *
 * ---------------------------------------------------------------------------
 * Nothing animates a width, and nothing is measured
 * ---------------------------------------------------------------------------
 *
 * The obvious build is to grow the word's width from zero and let the row
 * re-centre itself. That runs layout on every frame of the animation, on the
 * one screen where the JS thread is already busy doing the work the boot gate
 * is waiting for — which is exactly when a layout-driven animation stutters.
 *
 * So the row is laid out ONCE, in its final shape, and the whole row slides.
 * At rest it is offset right by half the word's width, which puts the mark on
 * the centre line; as `open` runs to 1 the offset goes to zero and the lockup
 * lands centred. The mark never moves relative to the word — the row moves —
 * and "the word pushed it left" is what that reads as, on one transform.
 *
 * The word's width used to come from onLayout, which cost a frame and made the
 * animation's first frame a guess. It is arithmetic now: the wordmark is an
 * image of known aspect, so its width IS its height times WORD_ASPECT, and the
 * offset is known before anything is drawn.
 */

/** Gap between the mark and the word, in the finished lockup. */
const GAP = 14;
/** Long enough to read as an arrival, short enough not to delay a launch. */
const ENTER_MS = 480;
/** The mark lands first, alone, before the word starts. */
const WORD_DELAY = 260;

export function KorbWordmark({
  size = 96,
  color,
}: {
  size?: number;
  /** Applied to both halves, so the lockup is one colour by construction. */
  color?: string;
}) {
  const reduced = useReducedMotion();

  /*
   * The word's height, and from it its width. Set against the mark's cap rather
   * than its full box: the basket's artwork carries its own margin, so matching
   * box heights would leave the name visibly smaller than the mark beside it.
   */
  const wordH = size * 0.42;
  const wordW = wordH * WORD_ASPECT;

  /** 0 = mark alone on the centre line. 1 = the lockup, settled. */
  const open = useSharedValue(0);
  /** The mark's own arrival, so it does not simply appear at full size. */
  const land = useSharedValue(0);

  useEffect(() => {
    /*
     * Reduce Motion gets the finished lockup, immediately.
     *
     * Not "no animation, no word": the word is the app's name and withholding
     * it would take information away from the people who asked for less
     * movement. The setting is about motion, so the motion goes.
     */
    if (reduced) {
      land.value = 1;
      open.value = 1;
      return;
    }
    land.value = withSpring(1, SPRING.settle);
    open.value = withDelay(
      WORD_DELAY,
      withTiming(1, {
        duration: ENTER_MS,
        // Out, not inOut: it should leave promptly and settle gently, because
        // the settling is the part that reads as two things becoming one.
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
    return () => {
      cancelAnimation(land);
      cancelAnimation(open);
    };
  }, [land, open, reduced]);

  /*
   * Half the word plus the gap, undone as `open` runs. At 0 that offset puts
   * the MARK on the container's centre line; at 1 the row itself is centred.
   */
  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - open.value) * ((wordW + GAP) / 2) }],
  }));

  const mark = useAnimatedStyle(() => ({
    opacity: land.value,
    transform: [{ scale: 0.82 + land.value * 0.18 }],
  }));

  const word = useAnimatedStyle(() => ({
    // Trails the push a little, so the word appears to come OUT of the mark
    // rather than to have been waiting beside it all along.
    opacity: interpolate(open.value, [0.1, 0.75], [0, 1], 'clamp'),
    transform: [{ translateX: (1 - open.value) * -18 }],
  }));

  return (
    <View style={styles.root} pointerEvents="none">
      <Animated.View style={[styles.row, row]}>
        <Animated.View style={mark}>
          <KorbMark size={size} color={color} />
        </Animated.View>

        <Animated.View style={word}>
          <KorbWord height={wordH} color={color} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
});
