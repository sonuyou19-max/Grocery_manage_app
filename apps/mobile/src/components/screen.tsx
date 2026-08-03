import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FAB_GAP, FAB_HEIGHT } from '@/components/fab';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/components/floating-tab-bar';
import { MeshBackground } from '@/components/mesh-background';
import { spacing, type, useTheme } from '@/theme';

interface ScreenProps extends PropsWithChildren {
  title: string;
  /**
   * A small line above the title, for a header that is really two thoughts.
   *
   * The dashboard's greeting is the case this exists for. "Good afternoon,
   * Sonu" as one display string wraps wherever the width runs out — which on a
   * 360dp phone was mid-phrase, giving "Good / afternoon, / Sonu". Splitting it
   * across two nodes puts the break where it belongs, and dropping the eyebrow
   * to h2 guarantees the greeting fits one line in every language we ship,
   * including the long ones, rather than merely fitting in English.
   *
   * It scales with the title on collapse, as one block.
   */
  eyebrow?: string;
  /** Text, or a node when the line needs to be interactive (e.g. the
   * household switcher on the dashboard). */
  subtitle?: ReactNode;
  /** Set on screens that render a <Fab>, so scroll content clears its full
   * height (not just its offset above the tab bar) on short screens. */
  hasFab?: boolean;
  /** Control placed at the top-right of the header, e.g. the card wallet. */
  headerAction?: ReactNode;
}

/**
 * How far you scroll before the header has finished collapsing. Short enough
 * that it responds to the first flick, long enough that it isn't twitchy.
 */
const COLLAPSE_DISTANCE = 72;

/**
 * Standard page shell: mesh background, safe area, big display title that
 * collapses as you scroll.
 *
 * The collapse is deliberately transform-and-opacity only. Animating fontSize
 * would re-run layout on every frame, and scaling a large text node mid-flight
 * goes soft on Android before it settles — so the title shrinks by transform
 * with its origin pinned left (it stays anchored to the margin instead of
 * drifting toward the centre), and the subtitle fades rather than resizes.
 * Both properties are composited on the UI thread, which is what keeps this
 * free on the low-end hardware the Android build has to run on.
 */
export function Screen({ title, eyebrow, subtitle, hasFab, headerAction, children }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Clamped at both ends: negative offsets happen constantly on Android
  // overscroll, and without the clamp the title would balloon as you pull down.
  const titleStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [1, 0.86], Extrapolation.CLAMP),
      },
    ],
  }));

  const subtitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, COLLAPSE_DISTANCE * 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      // The subtitle row is interactive — the household switcher, and on the
      // dashboard the Plus badge — and it keeps its layout slot after fading,
      // near the top of the viewport where thumbs land. Without this, a faded-
      // out row is an invisible button: a flick that ends on it opens a sheet
      // the user cannot see they touched. Faded means gone, for touches too.
      pointerEvents: opacity < 0.05 ? 'none' : 'auto',
      transform: [
        {
          translateY: interpolate(
            scrollY.value,
            [0, COLLAPSE_DISTANCE],
            [0, -6],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  // Clear the floating tab bar (and the Fab, when present) so the last card
  // is never hidden behind either.
  const fabClearance = hasFab ? FAB_HEIGHT + FAB_GAP : 0;
  const bottomClearance = insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + spacing.lg + fabClearance;

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingBottom: bottomClearance }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            {/* The action sits beside the title block rather than above it, so
                a long translated greeting wraps within its own column instead
                of pushing the control off-screen. */}
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                {/* Eyebrow and title scale together, from the same left origin,
                    so the two lines stay locked to each other and to the
                    margin while the header collapses. */}
                <Animated.View style={[styles.titleBlock, titleStyle]}>
                  {eyebrow ? (
                    <Text style={[type.h2, { color: colors.muted }]}>{eyebrow}</Text>
                  ) : null}
                  <Text style={[type.display, { color: colors.ink }]}>{title}</Text>
                </Animated.View>
                <Animated.View style={subtitleStyle}>
                  {typeof subtitle === 'string' ? (
                    <Text style={[type.sub, { color: colors.muted }]}>{subtitle}</Text>
                  ) : (
                    (subtitle ?? null)
                  )}
                </Animated.View>
              </View>
              {headerAction ?? null}
            </View>
          </View>
          {children}
        </Animated.ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  // minWidth 0 lets the title actually wrap instead of forcing the row wide.
  headerText: { flex: 1, minWidth: 0, gap: spacing.xs },
  // Anchors the shrink to the left margin. Without it the block scales about
  // its centre and slides inward as it collapses, which reads as drift.
  titleBlock: { transformOrigin: 'left center' },
});
