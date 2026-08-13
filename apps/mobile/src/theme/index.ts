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
