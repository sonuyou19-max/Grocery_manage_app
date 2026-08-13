import { useColorScheme } from 'react-native';

import { palette, radii, spacing, type } from './tokens';
import type { ThemeColors } from './tokens';

/** The two palettes the app ships. Named so anything deriving colours of its
 *  own (lib/list-tint) can be keyed by it rather than restating the union. */
export type ColorScheme = 'light' | 'dark';

export { palette, radii, spacing, type };
export type { ThemeColors };

export interface Theme {
  colors: ThemeColors;
  scheme: ColorScheme;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: palette[scheme], scheme };
}

/**
 * Props that give a ScrollView a visible scrollbar.
 *
 * Long lists were scrolling with no indicator at all, so nothing on screen said
 * how much was below the fold or how far down you already were — on a full
 * week's shop that reads as a list with no end. The indicator is the one piece
 * of UI that answers both questions without costing any layout.
 *
 * `indicatorStyle` is the part worth spelling out. It is iOS-only and defaults
 * to black, which on this app's dark palette is a black bar on a near-black
 * background — technically present, invisible in practice. Android draws its
 * own themed scrollbar and ignores the prop.
 *
 * Spread onto vertical scrollers only. Horizontal chip rows and the onboarding
 * pager deliberately keep theirs hidden: those scroll by a card at a time and a
 * bar under them is noise, not orientation.
 */
export function useScrollIndicator() {
  const { scheme } = useTheme();
  return {
    showsVerticalScrollIndicator: true,
    indicatorStyle: scheme === 'dark' ? ('white' as const) : ('black' as const),
  };
}
