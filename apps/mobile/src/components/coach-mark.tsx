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
  withTiming,
} from 'react-native-reanimated';

import { useCoachMarkPortal } from '@/components/coach-mark-host';
import type { TargetRect } from '@/lib/coach-marks';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * A coach mark: dim everything, punch a hole around one real control, and point
 * a caption at it.
 *
 * ---------------------------------------------------------------------------
 * Where it renders, and why not in a <Modal>
 * ---------------------------------------------------------------------------
 *
 * The overlay is drawn by CoachMarkHost at the root of the tree, so it covers
 * the tab bar and the safe areas as well as the page. It is NOT a Modal: on
 * Android a Modal is its own native window, and this overlay positions itself
 * from a rect measured with measureInWindow in the SCREEN's window. Those two
 * origins need not agree — status bar, cutout, edge-to-edge insets — and the
 * mismatch is what once put the spotlight a whole row out of place.
 *
 * Staying in one window means the difference can simply be measured: the
 * overlay measures its own root and subtracts, converting the target's window
 * rect into its own local space. It never assumes the origins agree.
 *
 * ---------------------------------------------------------------------------
 * Why the hole is rectangles plus a frame, inside one opacity group
 * ---------------------------------------------------------------------------
 *
 * A real mask is the obvious tool and the wrong one here: react-native-svg's
 * mask support on Android renders through an offscreen layer, the same class of
 * cost as the BlurView this app spent a release removing, and blend modes are
 * not reliable on the New Architecture.
 *
 * Instead: four rectangles around the target, plus a bordered frame whose inner
 * radius rounds the hole. What makes the combination work is where the
 * translucency lives. The pieces are OPAQUE and their PARENT carries the
 * opacity, so the subtree composites once and the pieces may overlap freely.
 *
 * That one detail is the whole trick, and getting it wrong shipped twice. With
 * translucent pieces they must tile exactly, and tiling rectangles leave a
 * square hole — so a rounded ring over it showed a dark wedge in every corner.
 * Squaring the ring removed the wedges and left a square hole framing rounded
 * rows. Adding the frame moved the artifact to the frame's own rounded OUTER
 * corners. With the alpha on the group, the rectangles simply overlap those
 * corners and the only uncovered region is the rounded rectangle wanted all
 * along.
 *
 * ---------------------------------------------------------------------------
 * Why the target is not interactive
 * ---------------------------------------------------------------------------
 *
 * Requiring the gesture before the tip moves on would mean a second copy of the
 * swipe logic living inside the overlay, drifting from the real one. The tip
 * describes and gets out of the way: one tap dismisses it and hands the real
 * gesture back, so the user's first swipe is on the real row.
 */

/** Which gesture the caption describes. */
export type CoachGesture = 'swipeLeft' | 'swipeBoth' | 'tap';

export interface CoachMarkContent {
  /** Where the target sits, in WINDOW coordinates — see useCoachMark. */
  rect: TargetRect;
  /** i18n key prefix: `<prefix>Title` and `<prefix>Body`. */
  textKey: string;
  gesture: CoachGesture;
  onDismiss: () => void;
  onSkipAll: () => void;
}

interface CoachMarkProps extends Omit<CoachMarkContent, 'rect'> {
  visible: boolean;
  rect: TargetRect | null;
}

/**
 * The hole hugs the card exactly — same bounds, same radius — so it reads as
 * the card punching through the dim rather than a box drawn around it.
 */
const PAD = 0;
const HOLE_R = radii.md;
/** Frame thickness. Any value works; it only has to reach past the corners. */
const FRAME = 28;
/** How much vertical room the caption needs below the target. */
const CAPTION_SPACE = 210;
/** Half-width of the caret that points at the card. */
const CARET = 9;

/** Screens mount this; it renders nothing itself and publishes to the host. */
export function CoachMark({ visible, rect, ...rest }: CoachMarkProps) {
  useCoachMarkPortal(visible && rect ? { rect, ...rest } : null);
  return null;
}

export function CoachMarkOverlay({ content }: { content: CoachMarkContent }) {
  const { rect, textKey, onDismiss, onSkipAll } = content;
  const { colors } = useTheme();
  const t = useT();
  const { height: screenH, width: screenW } = useWindowDimensions();

  const enter = useSharedValue(0);

  /** This overlay's own origin in window coordinates — see the header. */
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss]);

  useEffect(() => {
    if (origin === null) return;
    enter.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(enter);
  }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const hx = rect.x - (origin?.x ?? 0) - PAD;
  const hy = rect.y - (origin?.y ?? 0) - PAD;
  const hw = rect.width + PAD * 2;
  const hh = rect.height + PAD * 2;

  // The caption goes below the target when there is room, above when there
  // isn't — a card that runs off the bottom is a tip nobody can dismiss, and
  // the bottom is exactly where list rows tend to be.
  const below = hy + hh + CAPTION_SPACE < screenH;

  // The caret points at the target's centre, but stays inside the caption's
  // rounded corners so it never floats off the edge of the card.
  const caretMin = spacing.lg + HOLE_R;
  const caretMax = screenW - spacing.lg - HOLE_R - CARET * 2;
  const caretLeft = Math.min(
    Math.max(hx + hw / 2 - CARET, caretMin),
    Math.max(caretMax, caretMin),
  );

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={styles.root}
      onLayout={() => rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }))}
    >
      {origin === null ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, enterStyle]}>
          {/* Tapping anywhere dismisses, including the hole: the target is
              inert here anyway, so a dead zone would just read as a freeze. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
            <View style={styles.scrimGroup} pointerEvents="none">
              <View style={[styles.op, { top: 0, height: Math.max(hy, 0), left: 0, right: 0 }]} />
              <View style={[styles.op, { top: hy + hh, bottom: 0, left: 0, right: 0 }]} />
              <View style={[styles.op, { top: hy, height: hh, left: 0, width: Math.max(hx, 0) }]} />
              <View style={[styles.op, { top: hy, height: hh, left: hx + hw, right: 0 }]} />
              <View
                style={{
                  position: 'absolute',
                  top: hy - FRAME,
                  left: hx - FRAME,
                  width: hw + FRAME * 2,
                  height: hh + FRAME * 2,
                  borderWidth: FRAME,
                  borderColor: SCRIM_SOLID,
                  borderRadius: HOLE_R + FRAME,
                }}
              />
            </View>

            {/* A hairline on the cut edge, not a highlight around it. Heavy
                enough to define the shape against the dim, light enough that
                the card still reads as the card. */}
            <View
              pointerEvents="none"
              style={[
                styles.ring,
                { top: hy, left: hx, width: hw, height: hh, borderColor: colors.line },
              ]}
            />

            <View
              style={[
                styles.captionWrap,
                below
                  ? { top: hy + hh + spacing.md }
                  : { bottom: screenH - hy + spacing.md },
              ]}
            >
              {below && (
                <View
                  style={[
                    styles.caret,
                    styles.caretUp,
                    { left: caretLeft, borderBottomColor: colors.surface },
                  ]}
                />
              )}
              <View
                style={[
                  styles.caption,
                  { backgroundColor: colors.surface, borderColor: colors.line },
                ]}
              >
                <View style={styles.captionHead}>
                  <Ionicons name="bulb-outline" size={20} color={colors.accent} />
                  <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
                    {t(`${textKey}Title`)}
                  </Text>
                </View>
                <Text style={[type.body, styles.body, { color: colors.muted }]}>
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
              </View>
              {!below && (
                <View
                  style={[
                    styles.caret,
                    styles.caretDown,
                    { left: caretLeft, borderTopColor: colors.surface },
                  ]}
                />
              )}
            </View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/** Opaque: the alpha lives on the group, not the pieces — see the header. */
const SCRIM_SOLID = 'rgb(8,12,7)';
const SCRIM_ALPHA = 0.72;

const styles = StyleSheet.create({
  // elevation as well as zIndex: on Android the two orderings are separate, and
  // without elevation the overlay can paint under an elevated sibling.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  scrimGroup: { ...StyleSheet.absoluteFillObject, opacity: SCRIM_ALPHA },
  op: { position: 'absolute', backgroundColor: SCRIM_SOLID },
  ring: { position: 'absolute', borderWidth: 1, borderRadius: HOLE_R },
  captionWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  // Matches a card's radius, so the tip reads as one of them rather than a
  // different kind of surface floating over the page.
  caption: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  captionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Roomier than the default: this is the one paragraph in the app somebody
  // actually stops to read.
  body: { lineHeight: 22 },
  // The classic zero-size-box triangle: two transparent side borders and one
  // coloured border make the point.
  caret: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: CARET,
    borderRightWidth: CARET,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  caretUp: { top: -CARET, borderBottomWidth: CARET },
  caretDown: { bottom: -CARET, borderTopWidth: CARET },
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
