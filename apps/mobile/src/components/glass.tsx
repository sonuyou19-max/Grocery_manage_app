import type { PropsWithChildren } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Frosted } from '@/components/frosted';
import { radii, useTheme } from '@/theme';

interface GlassViewProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  /** Corner radius; defaults to the large token. */
  radius?: number;
  /** Blur strength override (0–100). iOS only — Android does not blur. */
  intensity?: number;
  /** Accent the hairline border (e.g. call-to-action cards). */
  accented?: boolean;
  /**
   * What sits behind this surface — see components/frosted.tsx. Sheets, menus
   * and dialogs must pass `content`, or on Android the rows and buttons under
   * them read straight through.
   */
  over?: 'mesh' | 'content';
}

/**
 * Frosted-glass surface: a translucent fill with a thin, semi-transparent
 * border, blurred on iOS. Use for floating menus, bottom sheets and cards so
 * they read as glass over the mesh gradient rather than flat panels.
 *
 * This is the highest-volume frosted surface in the app — every <Card> is one,
 * and the Insights tab renders twenty-one of them. See components/frosted.tsx
 * for why that made a real Android blur unaffordable.
 */
export function GlassView({
  children,
  style,
  radius = radii.lg,
  intensity,
  accented = false,
  over = 'mesh',
}: GlassViewProps) {
  const { colors } = useTheme();

  return (
    <Frosted
      intensity={intensity}
      over={over}
      style={[
        styles.base,
        { borderRadius: radius, borderColor: accented ? colors.accent : colors.glassBorder },
        style,
      ]}
    >
      {children}
    </Frosted>
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
