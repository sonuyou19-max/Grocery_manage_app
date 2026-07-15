import { useColorScheme } from 'react-native';

import { palette, radii, spacing, type } from './tokens';
import type { ThemeColors } from './tokens';

export { palette, radii, spacing, type };
export type { ThemeColors };

export interface Theme {
  colors: ThemeColors;
  scheme: 'light' | 'dark';
}

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: palette[scheme], scheme };
}
