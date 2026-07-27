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

export function LocaleProvider({ children }: PropsWithChildren) {
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

  // Keep the engine's global locale in step with the active language, so code
  // that can't read this context — notably the error boundary, which sits above
  // the provider — still translates in the user's language via `i18n.t`.
  useEffect(() => {
    i18n.locale = state?.language ?? DEFAULT_LANGUAGE;
  }, [state]);

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

  // Wait for the persisted choice before rendering, to avoid a flash of the
  // wrong language (the splash screen covers this brief gap).
  if (!ready) return null;

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
