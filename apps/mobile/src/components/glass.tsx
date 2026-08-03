import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radii, useTheme } from '@/theme';

interface GlassViewProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  /** Corner radius; defaults to the large token. */
  radius?: number;
  /** Blur strength override (0–100). */
  intensity?: number;
  /** Accent the hairline border (e.g. call-to-action cards). */
  accented?: boolean;
}

/**
 * Frosted-glass surface: a background blur under a translucent fill with a
 * thin, semi-transparent border. Use for floating menus, bottom sheets and
 * cards so they read as glass over the mesh gradient rather than flat panels.
 */
export function GlassView({ children, style, radius = radii.lg, intensity, accented = false }: GlassViewProps) {
  const { colors, scheme } = useTheme();

  return (
    <BlurView
      intensity={intensity ?? (scheme === 'dark' ? 34 : 55)}
      tint={colors.blurTint}
      experimentalBlurMethod="dimezisBlurView"
      style={[
        styles.base,
        { borderRadius: radius, borderColor: accented ? colors.accent : colors.glassBorder },
        style,
      ]}
    >
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill, borderRadius: radius }]}
        pointerEvents="none"
      />
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    /**
     * A full device-independent pixel, not a hairline.
     *
     * This was `hairlineWidth * 1.5`, which on a 3x screen is half a physical
     * pixel — a value the compositor renders by fading the border toward
     * transparent. Combined with a border colour that was itself nearly white,
     * a card had no visible edge at all on anything but a good display. A
     * frosted surface still needs a boundary; making it 1dp means the width is
     * the same apparent thickness on every density instead of thinning out as
     * screens get sharper.
     */
    borderWidth: 1,
  },
});
