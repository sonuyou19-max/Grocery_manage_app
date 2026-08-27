import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

import { KorbMark } from '@/components/korb-mark';
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
 * Nothing animates a width
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
 * The word's width has to be measured for that, which is the one thing here
 * that costs a frame. It costs nothing visible: before the measurement the word
 * is transparent and the mark is centred, which is the first frame of the
 * animation anyway.
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
  wordColor,
}: {
  size?: number;
  color: string;
  wordColor: string;
}) {
  const reduced = useReducedMotion();
  const [wordW, setWordW] = useState(0);

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
    return () => cancelAnimation(land);
  }, [land, open, reduced]);

  useEffect(() => {
    // Nothing to push until the word has been measured, and starting before
    // then would slide the row by a distance that is about to change.
    if (reduced || wordW === 0) return;
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
    return () => cancelAnimation(open);
  }, [open, reduced, wordW]);

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
          <Text
            // Measured once. The name does not change length while it is on
            // screen, and re-measuring would restart a finished animation.
            onLayout={(e) => setWordW((prev) => (prev === 0 ? e.nativeEvent.layout.width : prev))}
            style={[styles.word, { color: wordColor, fontSize: size * 0.62 }]}
          >
            Korb
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  /*
   * The wordmark, not body text. Heavy and tightly tracked to match the
   * reference lettering, and `includeFontPadding: false` so Android's own line
   * padding does not push the word off the mark's optical centre — the one
   * place the two platforms would otherwise disagree about this lockup.
   */
  word: {
    fontWeight: '800',
    letterSpacing: -1.5,
    includeFontPadding: false,
  },
});
