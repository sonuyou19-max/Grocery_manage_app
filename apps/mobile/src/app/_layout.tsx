import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { palette } from '@/theme';

const navLight: NavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.light.accent,
    background: palette.light.bg,
    card: palette.light.surface,
    text: palette.light.ink,
    border: palette.light.line,
  },
};

const navDark: NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.dark.accent,
    background: palette.dark.bg,
    card: palette.dark.surface,
    text: palette.dark.ink,
    border: palette.dark.line,
  },
};

export default function RootLayout() {
  const scheme = useColorScheme();

  return (
    <ThemeProvider value={scheme === 'dark' ? navDark : navLight}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
