import type { PropsWithChildren } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';

import { GlassView } from '@/components/glass';
import { radii, spacing } from '@/theme';

interface CardProps extends PropsWithChildren {
  style?: ViewStyle;
  accented?: boolean;
}

/** A frosted-glass card over the mesh background. */
export function Card({ children, style, accented = false }: CardProps) {
  return (
    <GlassView radius={radii.lg} accented={accented} style={[styles.card, style]}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
