import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { LocaleGreeting, LocaleSetup } from '@/components/locale-setup';
import { i18n } from '@/i18n';
import { DEFAULT_LANGUAGE } from '@/i18n/languages';
import { DEFAULT_REGION, formatMoney, regionByCode } from '@/i18n/regions';

/**
 * Region + UI language, chosen on first launch and changeable in Settings.
 * Persisted on-device. `t` and `money` read the active language per call, so
 * switching language re-renders every consumer via the context value.
 */
interface LocaleValue {
  region: string;
  language: string;
  /** Active currency code (ISO 4217), derived from the region. */
  currency: string;
  setLocale: (region: string, language: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  money: (minorUnits: number) => string;
}

const STORE_KEY = 'korb.locale.v1';
const Ctx = createContext<LocaleValue | null>(null);

/**
 * The colours from app.json's expo-splash-screen config. Duplicated rather
 * than imported because that config is consumed by the native build, not by
 * the bundle — if either changes, both have to change. Keep them in step: the
 * whole point is that the seam is invisible.
 */
const SPLASH_BG = { light: '#2E7442', dark: '#0E120C' } as const;

export function LocaleProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [state, setState] = useState<{ region: string; language: string } | null>(null);
  const [ready, setReady] = useState(false);
  /** Language to greet in, set the moment first-run setup completes. */
  const [pendingGreeting, setPendingGreeting] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.language) {
            setState({ region: parsed.region ?? DEFAULT_REGION, language: parsed.language });
          }
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setLocale = useCallback((region: string, language: string) => {
    setState({ region, language });
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ region, language })).catch(() => {});
  }, []);

  /**
   * Keep the engine's global locale in step with the active language, so code
   * that can't read this context — notably the error boundary, which sits above
   * the provider — still translates in the user's language via `i18n.t`.
   *
   * DURING RENDER, not in an effect, and that is the whole point.
   *
   * An effect runs after the tree has already rendered, so for one full pass
   * every child saw the new language while `i18n.locale` still held the old
   * one. That gap was not theoretical: i18n-js picks a pluralizer with
   * `registry[askedFor] || registry[i18n.locale]`, so the stale global decided
   * plural forms for a language that had not asked for it, and the screen
   * filled with `[missing "en.…many" translation]`. Worse, assigning to
   * `i18n.locale` re-renders nothing, so the wrong text stayed on screen until
   * something unrelated happened to re-render it.
   *
   * A complete pluralizer registry (i18n/plural-rules.ts) already stops that
   * particular symptom. This closes the same hole from the other side, for
   * every OTHER thing the global locale feeds — date and number formatting, and
   * any `i18n.t` call made without an explicit locale.
   *
   * Assigning to a module singleton mid-render is a side effect, which React
   * normally warns against. It is safe here precisely because it is idempotent
   * and derived: the same render always computes the same value, so a
   * discarded or replayed render leaves nothing behind to clean up.
   */
  i18n.locale = state?.language ?? DEFAULT_LANGUAGE;

  const value = useMemo<LocaleValue>(() => {
    const language = state?.language ?? DEFAULT_LANGUAGE;
    const region = state?.region ?? DEFAULT_REGION;
    const currency = regionByCode(region)?.currency ?? 'EUR';
    return {
      region,
      language,
      currency,
      setLocale,
      t: (key, options) => i18n.t(key, { locale: language, ...options }),
      money: (minor) => formatMoney(minor, currency, language),
    };
  }, [state, setLocale]);

  /*
   * Wait for the persisted choice before rendering, to avoid a flash of the
   * wrong language.
   *
   * This used to `return null`, on the belief that the splash screen covered
   * the gap. It does not. Expo hides the splash on the app's FIRST FRAME — and
   * with `null` here, the first frame is an empty tree. So the sequence a user
   * actually saw was: logo, then a bare window with nothing in it, then the
   * whole app appearing at once a moment later. That flash of nothing was read
   * as the app stalling on launch, and it is the same blemish the (twice
   * reverted, see scripts/check-splash.mjs) native splash gate was trying to
   * paper over.
   *
   * A plain View in the splash's own colour fixes it with no native API at
   * all: the handoff is now splash-green to splash-green, so there is nothing
   * to see. It cannot outlive the JS that draws it, which is exactly why it is
   * safe where holding the native splash was not.
   */
  if (!ready) {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG[scheme] }]} />;
  }

  // First launch (or after a data reset): choose region + language first.
  if (!state) {
    return (
      <LocaleSetup
        onDone={(r, l) => {
          // Hold the greeting before handing over, so the choice is acknowledged
          // in the language just picked rather than disappearing into a gap.
          setPendingGreeting(l);
          setLocale(r, l);
        }}
      />
    );
  }

  // The held beat. Rendered instead of the app, not over it, so nothing behind
  // it is mounting and competing for the first frame.
  if (pendingGreeting) {
    return <LocaleGreeting language={pendingGreeting} onDone={() => setPendingGreeting(null)} />;
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}

/** Shorthand for the translate function. */
export function useT(): LocaleValue['t'] {
  return useLocale().t;
}
