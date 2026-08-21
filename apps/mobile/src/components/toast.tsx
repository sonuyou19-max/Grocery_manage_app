import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
 *
 * ---------------------------------------------------------------------------
 * The optional action, and why it changes three things at once
 * ---------------------------------------------------------------------------
 *
 * An Undo is the only way to make a destructive edit the user cannot see
 * reversible — the climate swap rewrites rows on lists that are not on screen,
 * and without this the only way back is to remember what was there. But a toast
 * that can be tapped is a different object from one that cannot:
 *
 *  - it has to RECEIVE touches, and the plain toast deliberately does not, so
 *    the user can keep swiping the Pantry while it fades. So pointer events are
 *    opened only around the button, and only when there is one.
 *  - it has to STAY long enough to be read, considered and hit. Two seconds is
 *    right for "filed on Weekly shop" and much too short for a decision.
 *  - it must not fire the WRONG action. The label and the handler live in one
 *    piece of state with the message, so a replacing toast replaces all three
 *    together and a tap can never reach the previous toast's callback.
 */

const VISIBLE_MS = 2000;
/** Long enough to read the sentence, decide, and reach the button. */
const ACTION_MS = 6000;
const FADE_MS = 180;

export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastValue {
  /**
   * Show a message, replacing any toast currently on screen.
   *
   * With an action the toast becomes tappable and stays longer; tapping runs it
   * and dismisses immediately.
   */
  showToast: (message: string, action?: ToastAction) => void;
}

const Ctx = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  // One piece of state, not two: see the header. A separate `action` could
  // outlive the message it belonged to for a frame, which is exactly long
  // enough for a tap to undo something the user was not looking at.
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const opacity = useSharedValue(0);
  const lift = useSharedValue(8);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setToast(null), []);

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
    (next: string, action?: ToastAction) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast({ message: next, action });
      cancelAnimation(opacity);
      cancelAnimation(lift);
      opacity.value = withTiming(1, { duration: FADE_MS });
      lift.value = withTiming(0, { duration: FADE_MS });
      hideTimer.current = setTimeout(hide, action ? ACTION_MS : VISIBLE_MS);
    },
    [opacity, lift, hide],
  );

  // Run it and get out of the way — leaving the toast up after an Undo would
  // invite a second tap on an action that has already happened.
  const runAction = useCallback(() => {
    toast?.action?.onPress();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hide();
  }, [toast, hide]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <ToastView toast={toast} onAction={runAction} opacity={opacity} lift={lift} />
    </Ctx.Provider>
  );
}

function ToastView({
  toast,
  onAction,
  opacity,
  lift,
}: {
  toast: { message: string; action?: ToastAction } | null;
  onAction: () => void;
  opacity: ReturnType<typeof useSharedValue<number>>;
  lift: ReturnType<typeof useSharedValue<number>>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }],
  }));

  if (!toast) return null;
  const { message, action } = toast;

  return (
    <Animated.View
      // Sits just above the floating tab bar so it never covers it.
      //
      // Touches: "none" without an action, because the user should be able to
      // keep swiping the list underneath while it fades — that is the whole
      // character of this component and it is not given up lightly. With an
      // action, "box-none" lets the button be hit while the pill's own area
      // still passes everything else through.
      style={[
        styles.wrap,
        { bottom: insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + spacing.sm },
        style,
      ]}
      pointerEvents={action ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
    >
      <GlassView over="content" radius={radii.pill} style={styles.pill}>
        <Text style={[type.sub, styles.message, { color: colors.ink }]} numberOfLines={2}>
          {message}
        </Text>
        {action ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            // Generous, because this is a small target on a pill that is
            // already fading — and missing it costs the user the edit.
            hitSlop={12}
            style={styles.action}
          >
            <Text style={[type.sub, styles.actionLabel, { color: colors.accent }]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxWidth: '100%',
  },
  // flexShrink: 0 so a two-line message never squeezes the button to nothing —
  // an Undo that has been narrowed to three pixels is worse than no Undo, since
  // it looks available and is not.
  message: { flexShrink: 1 },
  action: { flexShrink: 0 },
  actionLabel: { fontWeight: '600' },
});
