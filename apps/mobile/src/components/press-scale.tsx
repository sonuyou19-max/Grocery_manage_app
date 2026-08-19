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
 *
 * ---------------------------------------------------------------------------
 * One animated node, not a wrapper around a Pressable
 * ---------------------------------------------------------------------------
 *
 * The first version nested them — an Animated.View carrying the caller's style,
 * with a bare Pressable inside holding the children. That laid the icon on top
 * of the label on every button in the app, and the reason is worth keeping: the
 * caller's `flexDirection: "row"` landed on the OUTER view, whose only child was
 * the Pressable, while the icon and text were children of the Pressable — which
 * had no style at all and so defaulted to `column`.
 *
 * Splitting a style between the node that sizes and the node that arranges is a
 * trap with no good fix; making the pressable itself the animated node has none
 * of the problem. The caller passes one style, it applies where the children
 * are, and the transform rides along with it.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PressScale = forwardRef<View, PressableProps & { style?: ViewStyle | ViewStyle[] }>(
  function PressScale({ style, onPressIn, onPressOut, disabled, ...rest }, ref) {
    const scale = useSharedValue(1);
    const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
      <AnimatedPressable
        ref={ref}
        disabled={disabled}
        style={[...styleAsArray(style), animated]}
        // Both handlers are forwarded, not swallowed: a caller may want the press
        // for its own reasons (a haptic, a preview) and should not have to choose
        // between that and the animation.
        onPressIn={(e) => {
          scale.value = withSpring(0.96, SPRING.press);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withSpring(1, SPRING.press);
          onPressOut?.(e);
        }}
        {...rest}
      />
    );
  },
);

/**
 * Callers pass either a style or an array of them, and spreading one into the
 * other silently drops the array case.
 */
function styleAsArray(style: ViewStyle | ViewStyle[] | undefined): ViewStyle[] {
  if (!style) return [];
  return Array.isArray(style) ? style : [style];
}
