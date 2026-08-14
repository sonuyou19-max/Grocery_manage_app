import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
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
 * Why this is NOT a <Modal>, which is what it used to be
 * ---------------------------------------------------------------------------
 *
 * It shipped as a transparent Modal and the spotlight landed in the wrong
 * place — a hole over the section header instead of the row under it.
 *
 * On Android a react-native <Modal> is its own native window. The target is
 * measured with measureInWindow, which answers in the coordinates of the window
 * the TARGET lives in; the overlay then drew at those numbers inside a
 * different window, whose origin does not have to match. The gap is whatever
 * the two windows disagree about — status bar, display cutout, edge-to-edge
 * insets — so the error is invisible on one device and obvious on the next.
 * There is no offset to add here, because there is no fixed offset: the right
 * fix is to stop crossing windows.
 *
 * So the overlay renders inline, absolutely positioned, in the same tree as the
 * screen. It then measures ITS OWN root and subtracts, converting the target's
 * window rect into its own local space. That subtraction is what makes it
 * correct regardless of insets, safe areas or which Android version decided to
 * change the rules — it never assumes the two origins agree, it measures the
 * difference.
 *
 * The cost is that the dim stops at the screen's bounds, so the tab bar stays
 * bright. That is a fair trade for a spotlight that is actually on the thing it
 * is describing.
 *
 * ---------------------------------------------------------------------------
 * Why the hole is four rectangles, and why it is square
 * ---------------------------------------------------------------------------
 *
 * The obvious way to spotlight something is an SVG mask, or a full-screen view
 * with `mixBlendMode`. Neither is a good idea here. react-native-svg's mask
 * support on Android renders through an offscreen layer, which is the same
 * class of cost as the BlurView this app spent a release removing; blend modes
 * are not reliably supported on the New Architecture.
 *
 * Four opaque rectangles around the target leave the target untouched with no
 * compositing at all, and they tile — they must not stack, because the scrim is
 * translucent and two layers of it read as a darker patch.
 *
 * Four rectangles leave a SQUARE hole, so the hole and the ring around it are
 * both square. The first version rounded the ring, which left a dark wedge in
 * every corner where the round ring did not meet the square hole.
 *
 * Rounding the hole itself is not available at this cost. The region that needs
 * filling — a corner square minus a quarter disc — is concave, and a View with
 * a border radius can only ever paint a convex shape; the near-miss version of
 * this file used a bordered frame to round the inner edge and simply moved the
 * artifact to the frame's own rounded OUTER corners. Anything better needs a
 * real mask, which is the offscreen-layer cost ruled out above. A rectangle
 * that is exactly right beats a rounded rectangle that is nearly right.
 *
 * ---------------------------------------------------------------------------
 * Why the target is not interactive
 * ---------------------------------------------------------------------------
 *
 * A tour that makes you perform the gesture before it will move on sounds more
 * engaging and is worse: it would mean reimplementing each gesture inside the
 * overlay — a second copy of the swipe logic, drifting from the real one,
 * teaching an interaction that does not exist.
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
const PAD = 8;
/** How much vertical room the caption needs below the target. */
const CAPTION_SPACE = 210;

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
  const enter = useSharedValue(0);

  /**
   * This overlay's own position in window coordinates.
   *
   * Null until measured, and nothing is drawn before then — see the header.
   * Painting at the raw window rect and correcting a frame later would put the
   * spotlight in the wrong place first, which is precisely the bug being fixed.
   */
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!visible) setOrigin(null);
  }, [visible]);

  // Android's back button should dismiss the tip, not leave the screen under it.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);

  const ready = visible && rect !== null && origin !== null;

  useEffect(() => {
    if (!ready) {
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
     * frame. This one lives on an overlay the user dismisses in a few seconds,
     * and a gesture hint that plays once is missed by anyone who blinked.
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
  }, [ready, gesture]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const fingerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: travel.value * TRAVEL },
      { scale: 1 - press.value * 0.18 },
    ],
    opacity: 0.55 + press.value * 0.45,
  }));

  if (!visible || !rect) return null;

  // The hole, in this overlay's own coordinates. `origin` is null on the first
  // pass — the root still renders so it can be measured, but nothing is painted.
  const hx = rect.x - (origin?.x ?? 0) - PAD;
  const hy = rect.y - (origin?.y ?? 0) - PAD;
  const hw = rect.width + PAD * 2;
  const hh = rect.height + PAD * 2;

  // The caption goes below the target when there is room, above when there
  // isn't — a card that runs off the bottom of the screen is a tip nobody can
  // dismiss, and the bottom is exactly where list rows tend to be.
  const below = hy + hh + CAPTION_SPACE < screenH;

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={styles.root}
      onLayout={() =>
        rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }))
      }
    >
      {origin === null ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, enterStyle]}>
          {/* Tapping anywhere dismisses, including the hole: the target is inert
              here anyway (see the header), so an unexplained dead zone would
              just read as the app having frozen. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
            {/* The scrim, tiled so no two pieces overlap — the colour is
                translucent, so an overlap would show as a darker band. */}
            <View style={[styles.dim, { top: 0, height: Math.max(hy, 0) }]} />
            <View style={[styles.dim, { top: hy + hh, bottom: 0 }]} />
            <View
              style={[styles.dim, { top: hy, height: hh, left: 0, width: Math.max(hx, 0) }]}
            />
            <View
              style={[styles.dim, { top: hy, height: hh, left: hx + hw, right: 0 }]}
            />

            {/* A ring around the hole, so the spotlight reads as deliberate
                rather than as a rendering glitch where the dimming failed. */}
            <View
              pointerEvents="none"
              style={[
                styles.ring,
                { top: hy, left: hx, width: hw, height: hh, borderColor: colors.accent },
              ]}
            />

            {/* The finger, riding the target's centre. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.finger,
                { top: hy + hh / 2 - 18, left: hx + hw / 2 - 18 },
                fingerStyle,
              ]}
            >
              <View style={[styles.fingerDot, { backgroundColor: colors.accent }]} />
            </Animated.View>

            <View
              style={[
                styles.captionWrap,
                below
                  ? { top: hy + hh + spacing.lg }
                  : { bottom: screenH - hy + spacing.lg },
              ]}
            >
              <GlassView over="content" radius={radii.lg} style={styles.caption}>
                <View style={styles.captionHead}>
                  <Ionicons name="bulb-outline" size={20} color={colors.accent} />
                  <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
                    {t(`${textKey}Title`)}
                  </Text>
                </View>
                <Text style={[type.body, { color: colors.muted }]}>
                  {t(`${textKey}Body`)}
                </Text>
                <View style={styles.actions}>
                  <Pressable onPress={onSkipAll} hitSlop={8} style={styles.skip}>
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t('coach.skipAll')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={onDismiss}
                    style={[styles.got, { backgroundColor: colors.accent }]}
                  >
                    <Text style={[type.body, { color: colors.accentInk }]}>
                      {t('coach.gotIt')}
                    </Text>
                  </Pressable>
                </View>
              </GlassView>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const SCRIM = 'rgba(8,12,7,0.72)';

const styles = StyleSheet.create({
  // elevation as well as zIndex: on Android the two orderings are separate, and
  // without elevation the overlay can paint under an elevated card below it.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  dim: { position: 'absolute', left: 0, right: 0, backgroundColor: SCRIM },
  // Square, to match the square hole the four rectangles leave.
  ring: { position: 'absolute', borderWidth: 2 },
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
