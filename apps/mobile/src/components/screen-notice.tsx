import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { DURATION } from '@/lib/motion';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What a screen says when something has gone wrong ON that screen.
 *
 * ---------------------------------------------------------------------------
 * Why the toast could not do this
 * ---------------------------------------------------------------------------
 *
 * ToastProvider renders its pill in the ROOT view, above the navigator. That is
 * right for nearly every screen and wrong for the handful presented as
 * `modal` or `fullScreenModal`: on iOS those are separately presented view
 * controllers drawn ABOVE the root view, so a toast raised from one is behind
 * it and cannot be seen at all.
 *
 * It is not lost, which is what made it confusing to report. It sits there for
 * its three seconds unseen, and if the screen is dismissed while the timer is
 * still running the pill appears over whatever is underneath — so the message
 * arrives attached to the wrong screen, moments after the thing it describes.
 * Reported exactly that way: "I see the error message not when the upload
 * fails, but when I click cancel and go back to the main page."
 *
 * So a screen inside a modal presentation keeps its own notice, in its own
 * tree, where it is on top of what it is talking about.
 *
 * ---------------------------------------------------------------------------
 * And it is for errors, which the toast is explicitly not
 * ---------------------------------------------------------------------------
 *
 * components/toast says so in as many words: "it is never used for errors or
 * anything needing a decision". Three screens were using it for exactly that
 * anyway, because it was the only thing there. This is the thing that was
 * missing rather than a second copy of the toast.
 *
 * Longer on screen than a toast, because a confirmation is glanced at and an
 * explanation is read — and this one may arrive after a minute of waiting, when
 * nobody is still looking at the phone. Tappable to dismiss for the same
 * reason: the one control an error message owes you is a way to be done with it.
 */
const VISIBLE_MS = 6000;
const FADE_MS = DURATION.exit;

export interface ScreenNotice {
  /** Show `message`, replacing anything already up and restarting the clock. */
  show: (message: string) => void;
  dismiss: () => void;
  /** Pass straight to <ScreenNoticeView />. Null when there is nothing to say. */
  message: string | null;
}

export function useScreenNotice(): ScreenNotice {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setMessage(null);
  }, []);

  const show = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), VISIBLE_MS);
    },
    [],
  );

  // A screen dismissed mid-notice would otherwise leave a timer holding a
  // setState on an unmounted tree — the same shape as the toast's own cleanup.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { show, dismiss, message };
}

export function ScreenNoticeView({
  notice,
  /** Extra room at the bottom, for a screen with its own pinned controls. */
  offset = 0,
}: {
  notice: ScreenNotice;
  offset?: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const { message, dismiss } = notice;

  // Driven off `message` rather than by the setter, so a notice raised while one
  // is already up re-runs the fade from wherever it had got to instead of
  // cutting.
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = withTiming(message ? 1 : 0, { duration: FADE_MS });
  }, [message, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!message) return null;

  return (
    <Animated.View
      style={[styles.wrap, { bottom: insets.bottom + spacing.lg + offset }, style]}
      pointerEvents="box-none"
      accessibilityLiveRegion="assertive"
    >
      <Pressable onPress={dismiss} accessibilityRole="button">
        <GlassView over="content" radius={radii.lg} style={styles.pill}>
          <Text style={[type.sub, { color: colors.ink }]}>{message}</Text>
        </GlassView>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  pill: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, maxWidth: '100%' },
});
