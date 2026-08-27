import type { PropsWithChildren } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Frosted } from '@/components/frosted';
import { useOnScrim } from '@/components/sheet';
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

  /*
   * A `content` surface INSIDE a scrimmed sheet is really a `scrim` surface,
   * and asking each call site to know that is how one of them ends up wrong.
   *
   * It is read from the Sheet rather than passed down because the sheets are
   * written all over the app and this is not a fact about any of them — it is a
   * fact about the thing they are inside. The Edit item sheet came out
   * grey-green on iOS because a blur takes on what is behind it, and behind it
   * was 45% black; nothing in that file was wrong, and nothing in it could have
   * said so. See components/frosted.
   */
  const onScrim = useOnScrim();
  const surface = over === 'content' && onScrim ? 'scrim' : over;

  return (
    <Frosted
      intensity={intensity}
      over={surface}
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
