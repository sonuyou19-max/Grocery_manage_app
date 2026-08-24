import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Keep content out from under the notch, the Dynamic Island and the home bar.
 *
 * ---------------------------------------------------------------------------
 * Why not `SafeAreaView`, which does exactly this
 * ---------------------------------------------------------------------------
 *
 * Because it does not, inside a modal, on iOS.
 *
 * `SafeAreaView` from react-native-safe-area-context is a NATIVE view: it reads
 * its own `safeAreaInsets` from UIKit and applies the padding itself, without
 * consulting any React context. That works on an ordinary screen. On a screen
 * presented as `modal` or `fullScreenModal` — which react-native-screens hands
 * to UIKit as a separate presentation — it came back with a top inset of ZERO,
 * and every one of those screens drew its header underneath the status bar.
 * The receipt camera's instructions were printed across the clock and the
 * Dynamic Island; six other screens had the same fault, all of them modals, all
 * of them only on iPhone.
 *
 * `useSafeAreaInsets()` is the JS half of the same library and does not have
 * that problem: it reads a React context fed by the provider at the root, which
 * is seeded from `initialWindowMetrics` — the WINDOW's insets, captured at
 * launch, which no presentation style can change. So the numbers are right from
 * the first frame, in a modal or out of one.
 *
 * ---------------------------------------------------------------------------
 * Additive, like the component it replaces
 * ---------------------------------------------------------------------------
 *
 * The library's default is `additive`: the inset is added to whatever padding
 * the style already asks for. That is not a detail to drop. A header with
 * `padding: 16` wants 16 points of breathing room BELOW the island, not text
 * pressed against it — so this resolves the style's own padding first and adds
 * the inset to it, exactly as the native view did on the screens where it
 * worked.
 */

type Edge = 'top' | 'bottom' | 'left' | 'right';

/** All four, matching `SafeAreaView`'s behaviour when `edges` is omitted. */
const ALL: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

/**
 * The padding a style asks for on one side, before any inset.
 *
 * React Native's precedence: the specific side wins over the axis, and the axis
 * wins over `padding`. Reading only `padding` — or only `paddingTop` — would
 * silently drop whichever of the three a given screen happened to use.
 */
function ownPadding(style: ViewStyle, edge: Edge): number {
  const axis = edge === 'top' || edge === 'bottom' ? style.paddingVertical : style.paddingHorizontal;
  const side = {
    top: style.paddingTop,
    bottom: style.paddingBottom,
    left: style.paddingLeft,
    right: style.paddingRight,
  }[edge];
  const value = side ?? axis ?? style.padding ?? 0;
  // Percentage padding cannot be added to a point inset. Treated as zero own
  // padding rather than guessed at — the inset still applies, which is the part
  // that matters.
  return typeof value === 'number' ? value : 0;
}

export interface SafeProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  /** Which sides to inset. Omitted means all four. */
  edges?: readonly Edge[];
}

export function Safe({ style, edges = ALL, children }: SafeProps) {
  const insets = useSafeAreaInsets();
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;

  const padding: ViewStyle = {};
  for (const edge of edges) {
    const key = `padding${edge[0].toUpperCase()}${edge.slice(1)}` as
      | 'paddingTop'
      | 'paddingBottom'
      | 'paddingLeft'
      | 'paddingRight';
    padding[key] = ownPadding(flat, edge) + insets[edge];
  }

  return <View style={[style, padding]}>{children}</View>;
}
