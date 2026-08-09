import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

/**
 * A frosted surface — and, on Android, deliberately NOT a real blur.
 *
 * ---------------------------------------------------------------------------
 * Why this component exists
 * ---------------------------------------------------------------------------
 *
 * expo-blur's Android implementation (`experimentalBlurMethod="dimezisBlurView"`)
 * is not a GPU effect the way `UIVisualEffectView` is on iOS. Read
 * node_modules/expo-blur/android/.../ExpoBlurView.kt: on attach it calls
 *
 *     blurView.setupWith(<nearest rnscreens Screen>, RenderEffectBlur())
 *
 * which installs a `ViewTreeObserver.OnPreDrawListener` on the WHOLE SCREEN.
 * Every pre-draw pass, every one of these views redraws the entire screen
 * hierarchy into an offscreen bitmap, blurs it, and paints the result — on the
 * UI thread.
 *
 * That cost is per blur view, and we had a lot of them. Every <Card> is a
 * GlassView; the Insights tab renders twenty-one cards. Add the mesh
 * background and the floating tab bar and a single frame of that screen was
 * asking Android to snapshot-and-blur the full screen twenty-three times.
 * The mesh's three blobs animate on an infinite `withRepeat`, so pre-draw
 * fired continuously and the app never got an idle frame — the UI thread was
 * saturated at rest, before any transition had even started.
 *
 * That is the flicker. Not a layout bug, not a race: every animation in the
 * app was competing for a thread that was already fully spent, so springs
 * started, stalled, and snapped. It is also the slow cold start, because all
 * of those bitmaps have to be allocated before the first frame can land.
 *
 * ---------------------------------------------------------------------------
 * What we do instead
 * ---------------------------------------------------------------------------
 *
 * On iOS, keep the real blur: it is a native effect view and costs nothing.
 *
 * On Android, render a plain View with a fill instead — and WHICH fill depends
 * on what is behind it, which is the distinction the first version of this
 * component missed.
 *
 * A card sits on the mesh gradient: a smooth, low-frequency field with no fine
 * detail for a blur to smear, so a translucent fill there produces nearly the
 * same pixels a blur would, and still reads as glass. That is `over="mesh"`,
 * the default.
 *
 * A sheet, menu, dialog, toast or the tab bar sits on APP CONTENT — list rows,
 * icons, buttons. A blur used to make those unreadable no matter what the alpha
 * was. Nothing does now, so at 90% they showed straight through and the result
 * looked, in the user's words, "very bad". Those surfaces pass `over="content"`
 * and get an opaque fill. Legibility is not a thing to trade for a material
 * effect that Android cannot afford anyway.
 *
 * The one place a real blur is load-bearing is components/teaser.tsx, where it
 * exists to make invented sample figures unreadable. That one keeps its
 * BlurView on both platforms, and check-blur.mjs knows it is the exception.
 */
interface FrostedProps extends PropsWithChildren {
  /** iOS blur strength (0–100). Ignored on Android, which does not blur. */
  intensity?: number;
  /**
   * What is behind this surface. `mesh` (default) is the gradient background —
   * a translucent fill is right there. `content` is anything else, and gets an
   * opaque fill so text and controls underneath cannot read through. See the
   * note above; getting this wrong is visible immediately.
   */
  over?: 'mesh' | 'content';
  style?: StyleProp<ViewStyle>;
  pointerEvents?: ViewStyle['pointerEvents'];
}

export function Frosted({ intensity, over = 'mesh', style, pointerEvents, children }: FrostedProps) {
  const { colors, scheme } = useTheme();

  if (Platform.OS !== 'ios') {
    const fill = over === 'content' ? colors.overlaySolid : colors.glassSolid;
    return (
      <View style={[style, { backgroundColor: fill }]} pointerEvents={pointerEvents}>
        {children}
      </View>
    );
  }

  return (
    <BlurView
      intensity={intensity ?? (scheme === 'dark' ? 34 : 55)}
      tint={colors.blurTint}
      style={style}
      pointerEvents={pointerEvents}
    >
      {/* Beneath the children and never interactive: the translucent wash that
          turns a plain blur into a surface you can read text on. */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]}
        pointerEvents="none"
      />
      {children}
    </BlurView>
  );
}
