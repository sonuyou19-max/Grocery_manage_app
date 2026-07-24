import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/components/floating-tab-bar';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Soft, auto-dismissing confirmation — used when an action succeeds somewhere
 * the user can't see the result, e.g. a pantry swipe that files an item onto
 * another list. It states what happened and gets out of the way; it is never
 * used for errors or anything needing a decision.
 *
 * Queue-safe: a second toast fired while one is on screen replaces it and
 * restarts the timer rather than stacking or being dropped, so rapid swipes
 * always end up showing the most recent result.
 */

const VISIBLE_MS = 2000;
const FADE_MS = 180;

interface ToastValue {
  /** Show a message, replacing any toast currently on screen. */
  showToast: (message: string) => void;
}

const Ctx = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useSharedValue(0);
  const lift = useSharedValue(8);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setMessage(null), []);

  const hide = useCallback(() => {
    cancelAnimation(opacity);
    cancelAnimation(lift);
    opacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
      // Unmount only after the fade so the text doesn't vanish mid-animation.
      if (finished) runOnJS(clear)();
    });
    lift.value = withTiming(8, { duration: FADE_MS });
  }, [opacity, lift, clear]);

  const showToast = useCallback(
    (next: string) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMessage(next);
      cancelAnimation(opacity);
      cancelAnimation(lift);
      opacity.value = withTiming(1, { duration: FADE_MS });
      lift.value = withTiming(0, { duration: FADE_MS });
      hideTimer.current = setTimeout(hide, VISIBLE_MS);
    },
    [opacity, lift, hide],
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <ToastView message={message} opacity={opacity} lift={lift} />
    </Ctx.Provider>
  );
}

function ToastView({
  message,
  opacity,
  lift,
}: {
  message: string | null;
  opacity: ReturnType<typeof useSharedValue<number>>;
  lift: ReturnType<typeof useSharedValue<number>>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }],
  }));

  if (!message) return null;

  return (
    <Animated.View
      // Sits just above the floating tab bar so it never covers it, and never
      // takes touches — the user can keep swiping while it fades.
      style={[
        styles.wrap,
        { bottom: insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + spacing.sm },
        style,
      ]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <GlassView radius={radii.pill} style={styles.pill}>
        <Text style={[type.sub, { color: colors.ink }]} numberOfLines={2}>
          {message}
        </Text>
      </GlassView>
    </Animated.View>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  pill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxWidth: '100%',
  },
});
