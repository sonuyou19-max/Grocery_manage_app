import { useEffect, useRef, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { DURATION } from '@/lib/motion';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Dims its content briefly when `trigger` changes, so a card reads as having
 * recalculated rather than blinked.
 *
 * Switching an Insights card from "Last 7 days" to "Last 30 days" replaced
 * every figure on it between one frame and the next. Nothing was wrong with the
 * numbers; the problem was that a silent, instantaneous swap gives the reader
 * no signal that the thing they were looking at is now answering a different
 * question. A short dip does — it costs a quarter of a second and it is the
 * difference between a card that updated and a card that glitched.
 *
 * ---------------------------------------------------------------------------
 * Why it dips rather than crossfading
 * ---------------------------------------------------------------------------
 *
 * A true crossfade needs both the old and the new content on screen at once,
 * which means holding the previous render alive and stacking it. That is real
 * complexity — two subtrees, two measurements, a container sized to whichever
 * is taller — for an effect nobody would name if you removed it.
 *
 * Dipping the live content instead means React swaps the children whenever it
 * likes, and the dip covers the moment. The eye reads the return to full
 * opacity as the answer arriving.
 *
 * ---------------------------------------------------------------------------
 * Why it does not dip to zero
 * ---------------------------------------------------------------------------
 *
 * Going to nothing reads as the content being destroyed, and it exposes the
 * card's own background — which matters here because ranges have different row
 * COUNTS. Switch a store breakdown from a year to a week and the card gets
 * shorter; at zero opacity that collapse happens against an empty panel and
 * looks like a failure to load. Holding a floor keeps the shape visible
 * throughout, so the height change reads as part of the same movement.
 */

/** Enough to notice, not enough to lose the content. */
const FLOOR = 0.35;
/** Out faster than in: the answer arriving should feel unhurried. */
// The asymmetry is the effect, and it is the vocabulary's: clearing fast and
// arriving slower reads as the new value being placed rather than crossfaded.
const OUT_MS = DURATION.swap;
const IN_MS = DURATION.settle;

export function Recalc({
  trigger,
  style,
  children,
}: {
  /**
   * Anything comparable with Object.is. When it changes, the dip runs — so
   * pass the thing that CHANGED THE ANSWER (the range), not the answer itself,
   * or a card whose figures happen to be identical across two ranges will sit
   * there silently while the header says something new.
   */
  trigger: unknown;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const dip = useSharedValue(1);

  /*
   * Not on first render. The card is arriving, not recalculating, and every
   * Insights card dimming itself on the way in would read as the tab loading
   * badly — the same reason components/animated-money does not count up from
   * zero when it first appears.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    dip.value = withSequence(
      withTiming(FLOOR, { duration: OUT_MS, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.quad) }),
    );
  }, [trigger, dip]);

  const anim = useAnimatedStyle(() => ({ opacity: dip.value }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
