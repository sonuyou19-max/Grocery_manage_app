import { Image } from 'expo-image';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';

import { MeshBackground } from '@/components/mesh-background';
import { hydrateFirstRunFlags } from '@/lib/onboarding';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { spacing, useTheme } from '@/theme';

/**
 * Holds a branded loading screen over the app until launch has actually
 * resolved, instead of letting an empty dashboard flash for a beat.
 *
 * ---------------------------------------------------------------------------
 * Read this before changing anything here
 * ---------------------------------------------------------------------------
 *
 * A gate like this has been attempted twice before and broke the app both
 * times — the logo on screen forever, then an Android ANR. Both attempts held
 * the NATIVE splash via expo-splash-screen. That is the part that made them
 * unrecoverable: once `preventAutoHideAsync()` has been called, the only thing
 * that can take that screen down is JS calling `hideAsync()`, so any way JS can
 * fail to get there — a promise that never settles, a bundle that never
 * finishes evaluating — leaves a screen nothing can dismiss. The second attempt
 * added an unconditional 2.5s timeout and STILL hung, which says the failure
 * was never in the readiness logic at all.
 *
 * This gate is a React component. It cannot outlive the JS that draws it: if
 * the bundle is broken, this renders nothing rather than something permanent,
 * and ErrorBoundary is above it either way. That is the whole design.
 *
 * Two rules keep it that way. Both are enforced by scripts/check-splash.mjs:
 *
 *   1. NEVER call expo-splash-screen from here. Expo's default (hide on the
 *      first frame) hands straight over to this component, and store/locale
 *      paints the splash's own colour on that first frame so the seam is
 *      invisible.
 *   2. NEVER wait on a flag that settles over the network. supabase-js applies
 *      no client timeout, so `useHousehold().loading`, entitlement and pantry
 *      intel can simply never resolve. Everything below is an AsyncStorage read
 *      with a `.catch()` and a `.finally()` — reads that cannot fail to finish.
 *
 * And a backstop for the case where the reasoning above is wrong anyway: an
 * unconditional timer reveals the app at BOOT_CAP_MS regardless of any flag.
 * It has no dependencies and no conditions, so the only way it does not fire is
 * if JS has stopped entirely — in which case this component is not on screen to
 * block anything.
 */

/**
 * How long the loading screen may stay up no matter what.
 *
 * Sized to be longer than the reads it waits on (a handful of AsyncStorage
 * gets, single-digit ms on real hardware) and shorter than a user's patience.
 * If this timer is ever what releases the gate, something is wrong — but the
 * app still starts, which is the only property that matters here.
 */
const BOOT_CAP_MS = 2500;

/** Matches app.json's expo-splash-screen colours, same as store/locale. */
const SPLASH_BG = { light: '#2E7442', dark: '#0E120C' } as const;

export function BootGate({ children }: PropsWithChildren) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { colors } = useTheme();
  const t = useT();

  /*
   * The three things worth waiting for, and nothing else.
   *
   * - `initializing` is Supabase's stored-session read. It can hit the network
   *   to refresh an expired token, so it is the one flag here with a network
   *   path — but store/auth clears it in a `.finally()` on both the success and
   *   the failure branch, and check-splash asserts that it still does.
   * - `restored` is the remembered household id, read from AsyncStorage. NOT
   *   `loading`, which is false both before the fetch starts and after it ends
   *   and so cannot answer "has this resolved".
   * - `hydrated` is the lists cache, also AsyncStorage, in whichever backend
   *   the selector picked.
   */
  const { initializing } = useAuth();
  const { restored } = useHousehold();
  const { hydrated } = useGroceries();

  /*
   * Whether the first-run flags have been read. Without this the dashboard
   * paints before `onboardingSeen()` knows the answer, and the tour arrives a
   * beat later on top of an already-visible empty screen — which is exactly the
   * "logo → empty dashboard → onboarding" sequence this gate exists to remove.
   * Waiting here means the dashboard's very first render already knows, so the
   * tour is there from the start.
   */
  const [flagsRead, setFlagsRead] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = () => {
      if (alive) setFlagsRead(true);
    };
    // hydrateFirstRunFlags swallows its own storage errors, so this cannot
    // reject — the catch is here so that stays true if that ever changes.
    hydrateFirstRunFlags().then(done).catch(done);
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The backstop. No dependency array entries, no conditions, no early return
   * above it — it is armed on mount and fires. Do not make this conditional.
   */
  const [capReached, setCapReached] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setCapReached(true), BOOT_CAP_MS);
    return () => clearTimeout(id);
  }, []);

  const ready = !initializing && restored && hydrated && flagsRead;

  if (ready || capReached) return <>{children}</>;

  return (
    <View
      style={[styles.root, { backgroundColor: SPLASH_BG[scheme] }]}
      accessibilityRole="progressbar"
      accessibilityLabel={t('boot.loading')}
    >
      {/* The mesh sits over the splash colour rather than replacing it, so the
          background the user is already looking at resolves into the app's own
          instead of cutting to it. */}
      <MeshBackground />
      <View style={styles.centre}>
        <Image
          source={require('../../assets/images/splash-icon.png')}
          style={styles.mark}
          contentFit="contain"
          // No fade: this picks up exactly where the native splash left off,
          // and the same mark dissolving back in would read as a flicker.
          transition={0}
        />
        <ActivityIndicator color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  // The splash renders this at 128dp (see app.json); matching it means the mark
  // does not jump size at the handover. Change one and you must change the
  // other — the jump is small enough to look like a rendering glitch rather
  // than a mistake, which is what makes it easy to ship.
  mark: { width: 128, height: 128 },
});
