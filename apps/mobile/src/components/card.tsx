import type { PropsWithChildren } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { GlassView } from '@/components/glass';
import { cascade } from '@/lib/cascade';
import { radii, spacing } from '@/theme';

interface CardProps extends PropsWithChildren {
  style?: ViewStyle;
  accented?: boolean;
  /**
   * Where this card sits in the screen's arrival, or nothing to appear at once.
   *
   * Opt-in rather than automatic, and the number comes from the caller rather
   * than from a counter in here. A counter would have to be mutated during
   * render to work, which is the one thing a render is not allowed to do — and
   * on a screen whose cards are conditional it would count differently on the
   * render where a card is hidden.
   */
  order?: number;
}

/** A frosted-glass card over the mesh background. */
export function Card({ children, style, accented = false, order }: CardProps) {
  const glass = (
    <GlassView radius={radii.lg} accented={accented} style={[styles.card, style]}>
      {children}
    </GlassView>
  );
  /*
   * The animation goes on a wrapper rather than on GlassView itself. GlassView
   * is a blur on iOS, and an entering animation on the blurring view animates
   * what the blur is sampling as well as the view — the card arrives with its
   * background sliding underneath it.
   */
  if (order == null) return glass;
  return <Animated.View entering={cascade(order)}>{glass}</Animated.View>;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
