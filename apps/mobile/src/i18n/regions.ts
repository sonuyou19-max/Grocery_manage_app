/**
 * European regions asked for at first launch. A region sets the money format
 * (currency + separators) and suggests a starting UI language; the user can
 * still pick any supported language. `suggestedLanguage` always resolves to a
 * shipped language code (falls back to English until that language is added).
 */
/**
 * Flag emoji for an ISO 3166-1 alpha-2 code.
 *
 * Built from regional indicator symbols (U+1F1E6–U+1F1FF): 'BE' becomes 🇧🇪 by
 * offsetting each letter from 'A'. No asset, no lookup table, and it renders
 * from the system font on both platforms.
 */
export function flagFor(code: string): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

export interface Region {
  /** ISO 3166-1 alpha-2 country code. */
  code: string;
  name: string;
  /** Suggested UI language code (must be a shipped language or 'en'). */
  suggestedLanguage: string;
  /** ISO 4217 currency code. */
  currency: string;
}

// Ordered roughly by population so the common cases are near the top.
export const REGIONS: Region[] = [
  { code: 'DE', name: 'Germany', suggestedLanguage: 'de', currency: 'EUR' },
  { code: 'FR', name: 'France', suggestedLanguage: 'fr', currency: 'EUR' },
  { code: 'IT', name: 'Italy', suggestedLanguage: 'it', currency: 'EUR' },
  { code: 'ES', name: 'Spain', suggestedLanguage: 'es', currency: 'EUR' },
  { code: 'PL', name: 'Poland', suggestedLanguage: 'pl', currency: 'PLN' },
  { code: 'NL', name: 'Netherlands', suggestedLanguage: 'nl', currency: 'EUR' },
  { code: 'BE', name: 'Belgium', suggestedLanguage: 'nl', currency: 'EUR' },
  { code: 'AT', name: 'Austria', suggestedLanguage: 'de', currency: 'EUR' },
  { code: 'PT', name: 'Portugal', suggestedLanguage: 'en', currency: 'EUR' },
  { code: 'IE', name: 'Ireland', suggestedLanguage: 'en', currency: 'EUR' },
  { code: 'GR', name: 'Greece', suggestedLanguage: 'en', currency: 'EUR' },
  { code: 'CH', name: 'Switzerland', suggestedLanguage: 'de', currency: 'CHF' },
  { code: 'SE', name: 'Sweden', suggestedLanguage: 'en', currency: 'SEK' },
  { code: 'DK', name: 'Denmark', suggestedLanguage: 'en', currency: 'DKK' },
  { code: 'NO', name: 'Norway', suggestedLanguage: 'en', currency: 'NOK' },
  { code: 'FI', name: 'Finland', suggestedLanguage: 'en', currency: 'EUR' },
  { code: 'CZ', name: 'Czechia', suggestedLanguage: 'en', currency: 'CZK' },
  { code: 'RO', name: 'Romania', suggestedLanguage: 'en', currency: 'RON' },
  { code: 'HU', name: 'Hungary', suggestedLanguage: 'en', currency: 'HUF' },
  { code: 'GB', name: 'United Kingdom', suggestedLanguage: 'en', currency: 'GBP' },
];

export const DEFAULT_REGION = 'DE';

export const regionByCode = (code: string | null | undefined): Region | undefined =>
  REGIONS.find((r) => r.code === code);

/** Locales that write money as "€ 2,49" (comma decimal). English/UK use "£2.49". */
const COMMA_DECIMAL = new Set(['de', 'fr', 'it', 'es', 'pl', 'nl']);

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  PLN: 'zł',
  CHF: 'CHF',
  SEK: 'kr',
  DKK: 'kr',
  NOK: 'kr',
  CZK: 'Kč',
  RON: 'lei',
  HUF: 'Ft',
  GBP: '£',
};

/** The bare symbol for a currency (e.g. "€", "zł"), for price-entry prefixes. */
export const currencySymbolFor = (currency: string): string =>
  CURRENCY_SYMBOL[currency] ?? '€';

/** Symbol-suffix currencies (zł, kr, Kč, lei, Ft) read better after the number. */
const SUFFIX_CURRENCIES = ['PLN', 'SEK', 'DKK', 'NOK', 'CZK', 'RON', 'HUF'];

/** Everything about a currency+language that formatting depends on. */
export interface MoneyParts {
  symbol: string;
  /** Decimal comma rather than point. */
  comma: boolean;
  /** Symbol after the number rather than before it. */
  suffix: boolean;
}

/**
 * Resolve the formatting rules once. Separated from the assembly below so a
 * caller animating a number can look these up on the JS thread and hand the
 * results — plain strings and booleans — to a worklet.
 */
export function moneyParts(currency: string, language: string): MoneyParts {
  return {
    symbol: CURRENCY_SYMBOL[currency] ?? '€',
    comma: COMMA_DECIMAL.has(language),
    suffix: SUFFIX_CURRENCIES.includes(currency),
  };
}

/**
 * Assemble the string. Marked `worklet`, which is what lets a counting number
 * format itself on the UI thread sixty times a second.
 *
 * This is the ONLY place the assembly is written. A second copy inside the
 * animated component was the obvious way to do it and would have been a
 * formatter that silently disagrees with the static one — in Polish, or in a
 * comma-decimal locale, on whichever screen nobody rebuilt. A worklet is a
 * normal function when called from JS, so both threads run these same lines.
 *
 * Everything it touches is a primitive: no Set lookups, no module state, no
 * Intl. That is a requirement, not a coincidence — captured values are copied
 * into the UI runtime and the richer ones do not survive the trip.
 */
export function assembleMoney(minor: number, p: MoneyParts): string {
  'worklet';
  const amount = (minor / 100).toFixed(2);
  const shown = p.comma ? amount.replace('.', ',') : amount;
  return p.suffix ? `${shown} ${p.symbol}` : `${p.symbol}${p.comma ? ' ' : ''}${shown}`;
}

/**
 * Format integer minor units (e.g. cents) for a region + language. Values are
 * stored currency-agnostically, so this only changes the symbol and separators
 * — it does not convert amounts.
 */
export function formatMoney(minor: number, currency: string, language: string): string {
  return assembleMoney(minor, moneyParts(currency, language));
}
