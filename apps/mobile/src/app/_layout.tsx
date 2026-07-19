import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { hydrateCategoryCache } from '@/lib/categorize';
import { hydrateStorePrefs } from '@/lib/store-prefs';
import { AuthProvider } from '@/store/auth';
import { GroceriesProvider } from '@/store/groceries';
import { HouseholdProvider } from '@/store/household';
import { PantryIntelProvider } from '@/store/pantry-intel';
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

  useEffect(() => {
    // Load learned item→category mappings and remembered store preferences.
    void hydrateCategoryCache();
    void hydrateStorePrefs();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={scheme === 'dark' ? navDark : navLight}>
        <AuthProvider>
          <HouseholdProvider>
            <GroceriesProvider>
              <PantryIntelProvider>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="list/[id]" />
                  <Stack.Screen name="auth/sign-in" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="auth/household" options={{ presentation: 'modal' }} />
                  <Stack.Screen
                    name="vibe-check"
                    options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                  />
                  <Stack.Screen
                    name="onboarding"
                    options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
                  />
                </Stack>
                <StatusBar style="auto" />
              </PantryIntelProvider>
            </GroceriesProvider>
          </HouseholdProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
