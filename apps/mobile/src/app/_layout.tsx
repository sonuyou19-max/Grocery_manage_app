import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { BootGate } from '@/components/boot-gate';
import { ErrorBoundary } from '@/components/error-boundary';
import { ToastProvider } from '@/components/toast';
import { hydrateCategoryCache } from '@/lib/categorize';
import { hydrateItemHomeLists } from '@/lib/item-home-list';
import { setEmojiLexicon } from '@/lib/item-emoji';
import { hydrateLexicon, lexiconLookup, syncLexicon } from '@/lib/item-lexicon';
import { setUnitLexicon } from '@/lib/item-unit';
import { hydrateItemMemory } from '@/lib/item-memory';
import { initMonitoring, trackRoute } from '@/lib/monitoring';
import { CoachMarkHost } from '@/components/coach-mark-host';
import { hydrateCoachMarks } from '@/lib/coach-marks';
import { hydrateGetStarted, hydrateOnboarding } from '@/lib/onboarding';
import { hydrateStorePrefs } from '@/lib/store-prefs';
import { AuthProvider } from '@/store/auth';
import { GroceriesProvider } from '@/store/groceries';
import { EntitlementProvider } from '@/store/entitlement';
import { HouseholdProvider } from '@/store/household';
import { LocaleProvider } from '@/store/locale';
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
  // useSegments, not usePathname: it yields the route PATTERN — `list/[id]`
  // rather than `list/6f2c…` — which is what makes the breadcrumb group and
  // keeps household and list ids out of the crash report. See trackRoute.
  const segments = useSegments();

  useEffect(() => {
    trackRoute(`/${segments.join('/')}`);
  }, [segments]);

  useEffect(() => {
    // Start crash/error reporting (no-op until a Sentry DSN is configured).
    initMonitoring();
    // Load learned item→category mappings, remembered store preferences,
    // per-item usual quantity/unit/store, and each item's home list.
    void hydrateCategoryCache();
    void hydrateStorePrefs();
    void hydrateItemMemory();
    void hydrateItemHomeLists();
    // Read before the dashboard mounts, so the tour can be decided on its first
    // render instead of sliding in a beat later.
    void hydrateOnboarding();
    void hydrateGetStarted();
    // Same reason, for the in-place gesture tips: a screen decides on its first
    // render whether a tip is owed, and reading storage after mount would let
    // one appear over a screen that has already settled.
    void hydrateCoachMarks();

    // The shared item lexicon: read the device copy first so the very first
    // render already has it, then pull whatever has been published since. The
    // resolver is wired before hydration on purpose — it reads the live map, so
    // it is correct whenever it happens to be called, and item-emoji stays a
    // pure module that knows nothing about storage.
    setEmojiLexicon((term) => lexiconLookup(term)?.emoji);
    // Units come from the same rows. Note the shape: this returns `undefined`
    // for a term the lexicon has never heard of and `null` for one it knows and
    // has no confident unit for. unitFor() treats those differently — the first
    // keeps looking, the second stops — so the optional chain must not collapse
    // them into one.
    setUnitLexicon((term) => {
      const entry = lexiconLookup(term);
      return entry ? entry.unit : undefined;
    });
    void hydrateLexicon().then(() => syncLexicon());
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <ErrorBoundary>
      <ThemeProvider value={scheme === 'dark' ? navDark : navLight}>
        <LocaleProvider>
        <ToastProvider>
        <AuthProvider>
          {/* Under Auth because it is keyed on the user, and above the data
              providers because Pantry Intel waits on its answer before reading
              the purchase log — see the history window in store/entitlement. */}
          <EntitlementProvider>
          <HouseholdProvider>
            <GroceriesProvider>
              <PantryIntelProvider>
                {/* Innermost, so it can read the readiness flags of everything
                    above it — and so the local→cloud backend choice in
                    GroceriesProvider is settled behind the loading screen
                    rather than in front of the user. */}
                <BootGate>
                {/* Coach marks draw here, above the tab bar and the safe
                    areas — a tip rendered inside a screen can only dim
                    that screen. Still one native window, so the
                    overlay's measure-and-subtract stays correct. */}
                <CoachMarkHost>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="list/[id]" />
                  <Stack.Screen
                    name="shop/[id]"
                    options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
                  />
                  <Stack.Screen name="cards/index" />
                  <Stack.Screen name="cards/add" />
                  <Stack.Screen name="legal" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
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
                  {/* Same treatment as the tour it follows: no swipe-back, no
                      slide, so the two read as one uninterrupted first run. */}
                  <Stack.Screen
                    name="get-started"
                    options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
                  />
                </Stack>
                </CoachMarkHost>
                </BootGate>
                <StatusBar style="auto" />
              </PantryIntelProvider>
            </GroceriesProvider>
          </HouseholdProvider>
          </EntitlementProvider>
        </AuthProvider>
        </ToastProvider>
        </LocaleProvider>
      </ThemeProvider>
      </ErrorBoundary>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
