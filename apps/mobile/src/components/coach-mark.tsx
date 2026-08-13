import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GlassView } from '@/components/glass';
import type { TargetRect } from '@/lib/coach-marks';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * A coach mark: dim the screen, cut a hole around one real control, and show a
 * looping animation of the gesture that control answers to.
 *
 * ---------------------------------------------------------------------------
 * Why the hole is four rectangles
 * ---------------------------------------------------------------------------
 *
 * The obvious way to spotlight something is an SVG mask, or a full-screen view
 * with `mixBlendMode`. Neither is a good idea here. react-native-svg's mask
 * support on Android renders through an offscreen layer, which is the same
 * class of cost as the BlurView this app spent a release removing; blend modes
 * are not reliably supported on the New Architecture.
 *
 * Four opaque rectangles — above, below, left and right of the target — leave
 * the target untouched with no compositing at all. It is the oldest trick
 * available and it costs four flat views.
 *
 * ---------------------------------------------------------------------------
 * Why the target is not interactive
 * ---------------------------------------------------------------------------
 *
 * A tour that makes you perform the gesture before it will move on sounds more
 * engaging and is worse: on Android the overlay is its own native window, so
 * touches cannot be passed through to the screen underneath. Faking it would
 * mean reimplementing each gesture inside the overlay — a second copy of the
 * swipe logic, drifting from the real one, teaching an interaction that does
 * not exist.
 *
 * So the tip DEMONSTRATES and gets out of the way. The animation runs on the
 * spotlit control, the caption says what it does, and one tap dismisses it and
 * hands the real gesture back. The user's first swipe is on the real row.
 */

/** Which gesture to draw. */
export type CoachGesture = 'swipeLeft' | 'swipeBoth' | 'tap';

interface CoachMarkProps {
  visible: boolean;
  /** Where the target sits, in WINDOW coordinates — see useCoachMark. */
  rect: TargetRect | null;
  /** i18n key prefix: `<prefix>Title` and `<prefix>Body`. */
  textKey: string;
  gesture: CoachGesture;
  onDismiss: () => void;
  onSkipAll: () => void;
}

/** How far the finger travels, and how long one loop takes. */
const TRAVEL = 64;
const LEG_MS = 620;
const HOLD_MS = 420;

/** Breathing room between the cutout and the target itself. */
const PAD = 6;

export function CoachMark({
  visible,
  rect,
  textKey,
  gesture,
  onDismiss,
  onSkipAll,
}: CoachMarkProps) {
  const { colors } = useTheme();
  const t = useT();
  const { height: screenH } = useWindowDimensions();

  const travel = useSharedValue(0);
  const press = useSharedValue(0);
  /*
   * The fade is ours, not the Modal's.
   *
   * animationType="fade" animates the native WINDOW, which nothing drawn inside
   * it can be timed against — see scripts/check-modal-nav. The window appears
   * instantly and everything in it fades together instead, which is also what
   * item-sheet and quick-add-sheet do.
   */
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      cancelAnimation(travel);
      cancelAnimation(press);
      cancelAnimation(enter);
      enter.value = 0;
      return;
    }
    enter.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
    /*
     * An infinite loop, which this app otherwise bans (see check-blur). The ban
     * is about the ALWAYS-ON background: an animation that never stops on a
     * view present on every screen means the UI thread never sees an idle
     * frame. This one lives in a modal the user dismisses in a few seconds, and
     * a gesture hint that plays once is missed by anyone who blinked.
     */
    if (gesture === 'tap') {
      press.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
          withDelay(HOLD_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
      );
      return;
    }
    const ease = { duration: LEG_MS, easing: Easing.inOut(Easing.cubic) };
    travel.value = withRepeat(
      gesture === 'swipeBoth'
        ? withSequence(
            withTiming(-1, ease),
            withTiming(0, ease),
            withTiming(1, ease),
            withTiming(0, ease),
            withDelay(HOLD_MS, withTiming(0, { duration: 0 })),
          )
        : withSequence(
            withTiming(-1, ease),
            withDelay(HOLD_MS, withTiming(0, ease)),
          ),
      -1,
    );
  }, [visible, gesture]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const fingerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: travel.value * TRAVEL },
      { scale: 1 - press.value * 0.18 },
    ],
    opacity: 0.55 + press.value * 0.45,
  }));

  if (!rect) return null;

  // The caption goes below the target when there is room, above when there
  // isn't — a card that runs off the bottom of the screen is a tip nobody can
  // dismiss, and the bottom is exactly where list rows tend to be.
  const below = rect.y + rect.height + 190 < screenH;
  const top = rect.y - PAD;
  const bottom = rect.y + rect.height + PAD;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      {/* Tapping anywhere dismisses, including the hole: the target is inert
          here anyway (see the header), so an unexplained dead zone would just
          read as the app having frozen. */}
      <Animated.View style={[styles.fill, enterStyle]}>
      <Pressable style={styles.fill} onPress={onDismiss}>
        {/* The cutout, as four opaque rectangles around the target. */}
        <View style={[styles.dim, { height: Math.max(top, 0) }]} />
        <View style={[styles.dim, styles.belowStrip, { top: bottom }]} />
        <View
          style={[
            styles.dim,
            styles.sideStrip,
            { top, height: rect.height + PAD * 2, left: 0, width: Math.max(rect.x - PAD, 0) },
          ]}
        />
        <View
          style={[
            styles.dim,
            styles.sideStrip,
            { top, height: rect.height + PAD * 2, left: rect.x + rect.width + PAD, right: 0 },
          ]}
        />

        {/* A ring around the hole, so the spotlight reads as deliberate rather
            than as a rendering glitch where the dimming failed. */}
        <View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              top,
              left: Math.max(rect.x - PAD, 0),
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              borderColor: colors.accent,
            },
          ]}
        />

        {/* The finger, riding the target's vertical centre. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.finger,
            { top: rect.y + rect.height / 2 - 18, left: rect.x + rect.width / 2 - 18 },
            fingerStyle,
          ]}
        >
          <View style={[styles.fingerDot, { backgroundColor: colors.accent }]} />
        </Animated.View>

        <View
          style={[
            styles.captionWrap,
            below ? { top: bottom + spacing.lg } : { bottom: screenH - top + spacing.lg },
          ]}
        >
          <GlassView over="content" radius={radii.lg} style={styles.caption}>
            <View style={styles.captionHead}>
              <Ionicons name="bulb-outline" size={20} color={colors.accent} />
              <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
                {t(`${textKey}Title`)}
              </Text>
            </View>
            <Text style={[type.body, { color: colors.muted }]}>{t(`${textKey}Body`)}</Text>
            <View style={styles.actions}>
              <Pressable onPress={onSkipAll} hitSlop={8} style={styles.skip}>
                <Text style={[type.sub, { color: colors.muted }]}>{t('coach.skipAll')}</Text>
              </Pressable>
              <Pressable
                onPress={onDismiss}
                style={[styles.got, { backgroundColor: colors.accent }]}
              >
                <Text style={[type.body, { color: colors.accentInk }]}>{t('coach.gotIt')}</Text>
              </Pressable>
            </View>
          </GlassView>
        </View>
      </Pressable>
      </Animated.View>
    </Modal>
  );
}

const SCRIM = 'rgba(8,12,7,0.72)';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { position: 'absolute', left: 0, right: 0, backgroundColor: SCRIM },
  belowStrip: { bottom: 0 },
  sideStrip: { right: undefined },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radii.md,
  },
  finger: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fingerDot: { width: 28, height: 28, borderRadius: 14 },
  captionWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  caption: { padding: spacing.lg, gap: spacing.md },
  captionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skip: { flex: 1, paddingVertical: spacing.sm },
  got: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
