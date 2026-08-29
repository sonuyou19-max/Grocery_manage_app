import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { assembleMoney, formatMoney, moneyParts } from '@/i18n/regions';
import { useLocale } from '@/store/locale';

/**
 * A money figure that counts to its new value instead of jumping to it.
 *
 * ---------------------------------------------------------------------------
 * Why a TextInput
 * ---------------------------------------------------------------------------
 *
 * A counting number has to re-render sixty times a second, and doing that with
 * React state would put sixty renders per second through the JS thread for a
 * decoration. `<Text>` has no animatable text prop, so the standard Reanimated
 * answer is a non-editable `<TextInput>`: `text` IS animatable there, and
 * `useAnimatedProps` writes it straight to the native view from the UI thread.
 * React renders this component once.
 *
 * The cost is that a TextInput is not a Text, and the two differences both
 * matter:
 *
 *   Metrics. TextInput carries its own padding, and on Android an extra font
 *   pad, so an unreset one sits a few pixels lower than the label beside it.
 *   `styles.reset` removes both — without it these numbers would not line up
 *   with any static text on the same row.
 *
 *   Semantics. A screen reader announces a TextInput as an editable field,
 *   which for a spend total is simply wrong. The wrapper carries the role and
 *   the label, and the input is hidden from the accessibility tree entirely.
 *   The label is the JS-formatted value, so it is always the settled figure
 *   rather than whatever frame the animation happens to be on.
 *
 * ---------------------------------------------------------------------------
 * Formatting on the UI thread
 * ---------------------------------------------------------------------------
 *
 * `assembleMoney` is a worklet living in i18n/regions, alongside the static
 * formatter that calls the same function. Writing a second formatter here was
 * the obvious approach and would have been a slow-motion i18n bug: two
 * implementations agreeing in English and disagreeing in Polish, on a screen
 * nobody thought to re-check. The rules it needs — symbol, decimal comma,
 * symbol position — are resolved once on the JS thread and handed over as
 * primitives, because that is all a worklet can safely capture.
 */

/** RN's TextInput accepts `text` natively; its public types do not say so. */
type AnimatableText = { text?: string };
const AnimatedTextInput = Animated.createAnimatedComponent(
  TextInput as unknown as React.ComponentType<
    React.ComponentProps<typeof TextInput> & AnimatableText
  >,
);

/**
 * Long enough to read as counting, short enough that a total is legible again
 * before the eye has finished travelling to it.
 */
const COUNT_MS = 450;

export function AnimatedMoney({
  value,
  style,
}: {
  /** Integer minor units, e.g. cents. */
  value: number;
  style?: StyleProp<TextStyle>;
}) {
  const { currency, region } = useLocale();
  // The REGION, not the language. A Belgian reading the app in English still
  // shops where money is written € 2,49 — see Region.decimal.
  const parts = useMemo(() => moneyParts(currency, region), [currency, region]);

  const shown = useSharedValue(value);

  /*
   * The first value appears, it does not count up to itself.
   *
   * Every screen mount would otherwise run the animation — and screens remount
   * on every tab switch, so the Insights total would count from zero each time
   * you looked at it. Counting means something when a number CHANGES: a range
   * switched, an item checked off. Arriving is not a change.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      shown.value = value;
      return;
    }
    shown.value = withTiming(value, { duration: COUNT_MS, easing: Easing.out(Easing.cubic) });
  }, [value, shown]);

  const animatedProps = useAnimatedProps<AnimatableText>(() => ({
    text: assembleMoney(shown.value, parts),
  }));

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={formatMoney(value, currency, region)}>
      <AnimatedTextInput
        editable={false}
        // Never focusable, never a tap target: it is a label that happens to be
        // implemented with an input.
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        defaultValue={formatMoney(value, currency, region)}
        animatedProps={animatedProps}
        style={[styles.reset, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  reset: {
    padding: 0,
    margin: 0,
    // Android gives a TextInput extra vertical padding for accents that Text
    // does not have. Left on, these numbers sit lower than their own labels.
    ...(Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' as const } : null),
  },
});
