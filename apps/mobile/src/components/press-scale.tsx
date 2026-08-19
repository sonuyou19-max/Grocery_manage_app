import { forwardRef } from 'react';
import { Pressable, type PressableProps, type View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SPRING } from '@/lib/motion';

/**
 * A button that answers the finger.
 *
 * ---------------------------------------------------------------------------
 * Why a component rather than a style
 * ---------------------------------------------------------------------------
 *
 * A press that changes nothing until the action completes is what makes an app
 * feel like a web page: you tap, and for 80ms you cannot tell whether the tap
 * registered. Every native control answers immediately, before it knows what
 * the answer is.
 *
 * The obvious alternative is Pressable's own `style={({pressed}) => …}`, and it
 * is worse in the way that matters: it re-renders the subtree on press and on
 * release, and it can only step between two static values — so the release is a
 * jump rather than a settle. This drives a shared value instead, so the whole
 * thing runs on the UI thread and never touches React at all.
 *
 * 0.96 and not less. The scale has to be felt rather than seen; at 0.9 a row of
 * buttons visibly shrinks and the screen looks like it is flinching.
 *
 * ---------------------------------------------------------------------------
 * Why the spring is not written here
 * ---------------------------------------------------------------------------
 *
 * SPRING.press lives in lib/motion with the rest, and check-motion fails the
 * build on a spring config written anywhere else. That rule exists so two
 * controls that should feel the same share one value rather than two literals
 * that agree today — and "how a button answers a tap" is the single most
 * repeated motion in the app, so it is exactly the case the rule is for.
 */
export const PressScale = forwardRef<View, PressableProps & { style?: ViewStyle | ViewStyle[] }>(
  function PressScale({ style, onPressIn, onPressOut, disabled, ...rest }, ref) {
    const scale = useSharedValue(1);
    const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
      <Animated.View style={[animated, styleAsArray(style)]}>
        <Pressable
          ref={ref}
          disabled={disabled}
          // Both handlers are forwarded, not swallowed: a caller may want the
          // press for its own reasons (a haptic, a preview) and should not have
          // to choose between that and the animation.
          onPressIn={(e) => {
            // No spring on the way down. The finger is still moving, and a
            // spring here means the button is still travelling when it is
            // released — which reads as lag, not as softness.
            scale.value = withSpring(0.96, SPRING.press);
            onPressIn?.(e);
          }}
          onPressOut={(e) => {
            scale.value = withSpring(1, SPRING.press);
            onPressOut?.(e);
          }}
          {...rest}
        />
      </Animated.View>
    );
  },
);

/**
 * The animated wrapper takes the layout styles, so the scale applies to the
 * whole control rather than to its contents. Normalised because callers pass
 * either a style or an array of them, and spreading one into the other silently
 * drops the array case.
 */
function styleAsArray(style: ViewStyle | ViewStyle[] | undefined): ViewStyle[] {
  if (!style) return [];
  return Array.isArray(style) ? style : [style];
}
