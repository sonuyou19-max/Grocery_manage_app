/**
 * European regions asked for at first launch. A region sets the money format
 * (currency + separators) and suggests a starting UI language; the user can
 * still pick any supported language. `suggestedLanguage` always resolves to a
 * shipped language code (falls back to English until that language is added).
 */
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

/**
 * Format integer minor units (e.g. cents) for a region + language. Values are
 * stored currency-agnostically, so this only changes the symbol and separators
 * — it does not convert amounts.
 */
export function formatMoney(minor: number, currency: string, language: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? '€';
  const amount = (minor / 100).toFixed(2);
  const shown = COMMA_DECIMAL.has(language) ? amount.replace('.', ',') : amount;
  // Symbol-suffix currencies (zł, kr, Kč, lei, Ft) read better after the number.
  const suffix = ['PLN', 'SEK', 'DKK', 'NOK', 'CZK', 'RON', 'HUF'].includes(currency);
  return suffix ? `${shown} ${symbol}` : `${symbol}${COMMA_DECIMAL.has(language) ? ' ' : ''}${shown}`;
}
