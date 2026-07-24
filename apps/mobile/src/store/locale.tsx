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

import { LocaleSetup } from '@/components/locale-setup';
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
  setLocale: (region: string, language: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  money: (minorUnits: number) => string;
}

const STORE_KEY = 'korb.locale.v1';
const Ctx = createContext<LocaleValue | null>(null);

export function LocaleProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<{ region: string; language: string } | null>(null);
  const [ready, setReady] = useState(false);

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

  const value = useMemo<LocaleValue>(() => {
    const language = state?.language ?? DEFAULT_LANGUAGE;
    const region = state?.region ?? DEFAULT_REGION;
    const currency = regionByCode(region)?.currency ?? 'EUR';
    return {
      region,
      language,
      setLocale,
      t: (key, options) => i18n.t(key, { locale: language, ...options }),
      money: (minor) => formatMoney(minor, currency, language),
    };
  }, [state, setLocale]);

  // Wait for the persisted choice before rendering, to avoid a flash of the
  // wrong language (the splash screen covers this brief gap).
  if (!ready) return null;

  // First launch (or after a data reset): choose region + language first.
  if (!state) return <LocaleSetup onDone={setLocale} />;

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
