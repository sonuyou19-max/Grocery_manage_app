import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme as NavTheme,
} from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { ErrorBoundary } from '@/components/error-boundary';
import { ToastProvider } from '@/components/toast';
import { hydrateCategoryCache } from '@/lib/categorize';
import { hydrateItemHomeLists } from '@/lib/item-home-list';
import { setEmojiLexicon } from '@/lib/item-emoji';
import { hydrateLexicon, lexiconLookup, syncLexicon } from '@/lib/item-lexicon';
import { setUnitLexicon } from '@/lib/item-unit';
import { hydrateItemMemory } from '@/lib/item-memory';
import { initMonitoring, trackRoute } from '@/lib/monitoring';
import { hydrateGetStarted, hydrateOnboarding } from '@/lib/onboarding';
import { hydrateStorePrefs } from '@/lib/store-prefs';
import { useAuth, AuthProvider } from '@/store/auth';
import { useGroceries, GroceriesProvider } from '@/store/groceries';
import { EntitlementProvider } from '@/store/entitlement';
import { useHousehold, HouseholdProvider } from '@/store/household';
import { LocaleProvider } from '@/store/locale';
import { PantryIntelProvider } from '@/store/pantry-intel';
import { palette } from '@/theme';

/**
 * Called at MODULE scope, not inside the component — Expo hides the splash
 * the instant the first frame commits unless something has told it to wait,
 * and by the time a component's first effect runs, that frame is already
 * long past. This is the only call in the app that has to happen before
 * React does anything at all.
 *
 * `.catch()` because it rejects if it's ever called a second time (Fast
 * Refresh re-evaluates this module without a real app restart) — a
 * development-only noise, not a real failure.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

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

/**
 * Lifts the splash once, and only once, every store agrees there is nothing
 * left to flash the wrong thing about.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to close
 * ---------------------------------------------------------------------------
 *
 * Expo's default behaviour hides the splash the instant the first frame
 * commits — which is BEFORE any of this app's own async hydration (AsyncStorage
 * for the lists, a network round trip for the household, a session lookup for
 * auth) has had a chance to answer anything. What painted in that gap was
 * whatever each store's INITIAL state happened to claim: no lists, no
 * household, sometimes the onboarding tour deciding — a beat later, once it
 * actually knew — that it should have taken over from the start. On a fast
 * device that gap is a fifth of a second. It still reads as the app
 * forgetting your groceries every time you open it.
 *
 * ---------------------------------------------------------------------------
 * Why this waits on the local read, not the network fetch behind it
 * ---------------------------------------------------------------------------
 *
 * `groceries.loaded` and the household fetch both follow this codebase's
 * existing "cache first for instant paint" rule — the CACHED answer is what
 * gates the splash, not the live Supabase round trip refining it afterward.
 * Waiting for the network instead would trade a sub-second rendering bug for
 * a splash that can hang on a bad connection, which is a worse failure by the
 * app's own standard: a stale cached list for one more second is recoverable;
 * an indefinite splash looks exactly like a crash.
 */
function AppReadyGate({ localHydrated, children }: PropsWithChildren<{ localHydrated: boolean }>) {
  const { initializing: authInitializing } = useAuth();
  const { loading: householdLoading } = useHousehold();
  const { loaded: groceriesLoaded } = useGroceries();
  const ready = localHydrated && !authInitializing && !householdLoading && groceriesLoaded;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return <>{children}</>;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  // useSegments, not usePathname: it yields the route PATTERN — `list/[id]`
  // rather than `list/6f2c…` — which is what makes the breadcrumb group and
  // keeps household and list ids out of the crash report. See trackRoute.
  const segments = useSegments();
  /**
   * Has the on-device onboarding/tour state finished its AsyncStorage read?
   *
   * Threaded down to AppReadyGate as a prop rather than read again down
   * there, because hydrateOnboarding()/hydrateGetStarted() are ALREADY kicked
   * off right here, one effect below, for a documented reason — the tour
   * needs the answer on its first render. Calling them a second time from a
   * nested component would be harmless (they're idempotent reads) but would
   * be a second place that has to remember to do it, which is exactly the
   * kind of duplication this session has spent most of its time undoing.
   */
  const [localHydrated, setLocalHydrated] = useState(false);

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
    // Read before the dashboard mounts, so the tour can be decided on its
    // first render instead of sliding in a beat later — and so AppReadyGate
    // below knows when it's safe to lift the splash, which is the same
    // requirement from the other direction: nothing should render BEFORE
    // this is known either.
    void Promise.all([hydrateOnboarding(), hydrateGetStarted()]).then(() => {
      setLocalHydrated(true);
    });

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
              <AppReadyGate localHydrated={localHydrated}>
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
                <StatusBar style="auto" />
              </AppReadyGate>
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
