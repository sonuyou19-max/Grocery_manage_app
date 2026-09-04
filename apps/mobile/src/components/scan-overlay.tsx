import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { DURATION } from '@/lib/motion';
import type { ScanPhase } from '@/lib/receipt-run';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What a receipt scan looks like while it is happening.
 *
 * ---------------------------------------------------------------------------
 * Their photograph, not a stock illustration
 * ---------------------------------------------------------------------------
 *
 * The obvious build is a downloaded scanning GIF. This shows the shopper the
 * receipt THEY just photographed, with a line travelling down it, and that is a
 * better answer for a reason beyond taste: a generic animation says "something
 * is loading", while their own crumpled receipt under a scan line says "we are
 * reading THAT". If they photographed the sofa by mistake — which is exactly
 * what the first test shot of this feature was — they find out here, four
 * seconds in, instead of at a review sheet full of nothing.
 *
 * It also costs no asset, no dependency and no native rebuild. The line is a
 * gradient bar on the UI thread.
 *
 * ---------------------------------------------------------------------------
 * All of the shots, not the first one
 * ---------------------------------------------------------------------------
 *
 * A long receipt is photographed in up to four sections, and the first version
 * of this showed `shots[0]` for the whole wait. That quietly undid the argument
 * above: three quarters of what was being read never appeared, so "we are
 * reading THAT" was true of a quarter of it, and a bad fourth photograph stayed
 * invisible until the review sheet.
 *
 * So the preview steps through them, one per pass of the line, with the count
 * beside it. Note what the stepping does NOT claim: the model reads all four in
 * a single call, so this is not "now on image 2 of 4" — it is the whole input,
 * shown in turn. The caption stays put, because the phase has not changed.
 *
 * ---------------------------------------------------------------------------
 * The caption tracks real work
 * ---------------------------------------------------------------------------
 *
 * Two phases, because there are two round trips. Inventing five and stepping
 * through them on a timer would look more sophisticated and would start lying
 * the moment a receipt took longer than the timer assumed — "almost done" over
 * a request that has not returned. See ScanPhase.
 *
 * ---------------------------------------------------------------------------
 * Reduce Motion
 * ---------------------------------------------------------------------------
 *
 * A bar sweeping the screen on an endless loop is the specific kind of movement
 * the setting exists for, and this is the app's first animation that never
 * stops on its own. With it on, the line holds still across the middle of the
 * receipt and breathes instead — the screen still reads as busy, and nothing
 * travels.
 */

/** How long one pass down the receipt takes. */
const SWEEP_MS = DURATION.sweep;
/** The preview's height. Fixed, so the sweep has a distance before layout. */
const PREVIEW_H = 260;

export function ScanOverlay({ uris, phase }: { uris: readonly string[]; phase: ScanPhase }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const reduced = useReducedMotion();

  const travel = useSharedValue(0);
  const [shown, setShown] = useState(0);

  /*
   * One shot per pass of the line, so the two motions read as one thing rather
   * than competing. A single photograph never cycles — there is nothing to
   * cycle to, and a timer running against a static image is just a timer.
   *
   * The change is a cross-fade (expo-image's `transition`), which is what iOS
   * itself substitutes for movement under Reduce Motion, so this steps in both
   * modes. What that setting is about is travel, and nothing travels here.
   */
  useEffect(() => {
    if (uris.length < 2) return;
    const id = setInterval(
      () => setShown((i) => (i + 1) % uris.length),
      reduced ? 2400 : SWEEP_MS,
    );
    return () => clearInterval(id);
  }, [reduced, uris.length]);

  // A shot removed mid-scan cannot happen — the shutter is behind this overlay
  // — but an index past the end would blank the frame, so it wraps rather than
  // trusting that.
  const uri = uris.length > 0 ? uris[shown % uris.length] : null;

  useEffect(() => {
    travel.value = 0;
    /*
     * One shared value, one loop, ONE cleanup.
     *
     * This was two branches with a `cancelAnimation` in each, which read fine
     * and was quietly weaker: an infinite repeat with no teardown keeps running
     * after unmount, and with the cleanup written twice, losing one of them
     * leaves the other looking like proof that teardown is handled. The style
     * below reads the same value either way, so the branch is about the
     * ANIMATION, not about lifecycle.
     */
    travel.value = reduced
      ? // Parked mid-frame and breathing, rather than travelling.
        withRepeat(withTiming(0.5, { duration: DURATION.breathe }), -1, true)
      : withRepeat(
          withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }),
          -1,
          // Reversing, not restarting: a line that jumps back to the top every
          // pass reads as a stutter, and a receipt is read top to bottom and
          // back again anyway.
          true,
        );
    return () => cancelAnimation(travel);
  }, [reduced, travel]);

  const line = useAnimatedStyle(() =>
    reduced
      ? { top: PREVIEW_H / 2 - 40, opacity: 0.35 + travel.value * 0.5 }
      : { top: travel.value * (PREVIEW_H - 80), opacity: 1 },
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.frame, { borderColor: colors.line }]}>
        {/* The photograph, dimmed so the line reads over it. `contentFit`
            top-anchored: a receipt's identity is its header, and centring a
            long one crops away the shop's name. */}
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.shot}
            contentFit="cover"
            contentPosition="top"
            transition={300}
          />
        ) : (
          <View style={[styles.shot, { backgroundColor: colors.surface }]} />
        )}
        <View style={styles.dim} pointerEvents="none" />

        <Animated.View style={[styles.line, line]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', colors.accent, 'transparent']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Only when there is more than one, and deliberately just the
            numerals: "2 / 4" needs no translating and cannot be misread. */}
        {uris.length > 1 && (
          <View style={styles.count} pointerEvents="none">
            <Text style={[type.label, styles.countText]}>
              {shown + 1} / {uris.length}
            </Text>
          </View>
        )}
      </View>

      <Text style={[type.h2, { color: colors.ink }]}>
        {t(phase === 'reading' ? 'receipt.phaseReading' : 'receipt.phaseMatching')}
      </Text>
      <Text style={[type.sub, styles.hint, { color: colors.muted }]}>
        {t('receipt.phaseHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  frame: {
    width: '78%',
    height: PREVIEW_H,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  shot: { ...StyleSheet.absoluteFill },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  line: { position: 'absolute', left: 0, right: 0, height: 80 },
  count: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  countText: { color: '#FFFFFF' },
  hint: { textAlign: 'center' },
});
