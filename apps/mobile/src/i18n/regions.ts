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

/** Which mark a country writes decimals with. */
export type DecimalMark = ',' | '.';

export interface Region {
  /** ISO 3166-1 alpha-2 country code. */
  code: string;
  name: string;
  /**
   * The decimal mark used here — a property of the COUNTRY, not the language.
   *
   * It lived on the language, which is wrong in exactly the case this app is
   * built for: a Belgian household running the interface in English got UK
   * formatting for Belgian money, because the language was English. Somebody's
   * country decides whether €2,49 or €2.49 looks right on a shelf edge;
   * whichever language they read the app in does not.
   *
   * The one that surprises people: Switzerland writes decimals with a POINT,
   * unlike every one of its neighbours.
   */
  decimal: DecimalMark;
  /** Suggested UI language code (must be a shipped language or 'en'). */
  suggestedLanguage: string;
  /** ISO 4217 currency code. */
  currency: string;
}

// Ordered roughly by population so the common cases are near the top.
export const REGIONS: Region[] = [
  { code: 'DE', name: 'Germany', suggestedLanguage: 'de', currency: 'EUR' , decimal: ',' },
  { code: 'FR', name: 'France', suggestedLanguage: 'fr', currency: 'EUR' , decimal: ',' },
  { code: 'IT', name: 'Italy', suggestedLanguage: 'it', currency: 'EUR' , decimal: ',' },
  { code: 'ES', name: 'Spain', suggestedLanguage: 'es', currency: 'EUR' , decimal: ',' },
  { code: 'PL', name: 'Poland', suggestedLanguage: 'pl', currency: 'PLN' , decimal: ',' },
  { code: 'NL', name: 'Netherlands', suggestedLanguage: 'nl', currency: 'EUR' , decimal: ',' },
  { code: 'BE', name: 'Belgium', suggestedLanguage: 'nl', currency: 'EUR' , decimal: ',' },
  { code: 'AT', name: 'Austria', suggestedLanguage: 'de', currency: 'EUR' , decimal: ',' },
  { code: 'PT', name: 'Portugal', suggestedLanguage: 'en', currency: 'EUR' , decimal: ',' },
  { code: 'IE', name: 'Ireland', suggestedLanguage: 'en', currency: 'EUR' , decimal: '.' },
  { code: 'GR', name: 'Greece', suggestedLanguage: 'en', currency: 'EUR' , decimal: ',' },
  { code: 'CH', name: 'Switzerland', suggestedLanguage: 'de', currency: 'CHF' , decimal: '.' },
  { code: 'SE', name: 'Sweden', suggestedLanguage: 'en', currency: 'SEK' , decimal: ',' },
  { code: 'DK', name: 'Denmark', suggestedLanguage: 'en', currency: 'DKK' , decimal: ',' },
  { code: 'NO', name: 'Norway', suggestedLanguage: 'en', currency: 'NOK' , decimal: ',' },
  { code: 'FI', name: 'Finland', suggestedLanguage: 'en', currency: 'EUR' , decimal: ',' },
  { code: 'CZ', name: 'Czechia', suggestedLanguage: 'en', currency: 'CZK' , decimal: ',' },
  { code: 'RO', name: 'Romania', suggestedLanguage: 'en', currency: 'RON' , decimal: ',' },
  { code: 'HU', name: 'Hungary', suggestedLanguage: 'en', currency: 'HUF' , decimal: ',' },
  { code: 'GB', name: 'United Kingdom', suggestedLanguage: 'en', currency: 'GBP' , decimal: '.' },
];

export const DEFAULT_REGION = 'DE';

export const regionByCode = (code: string | null | undefined): Region | undefined =>
  REGIONS.find((r) => r.code === code);

/**
 * The decimal mark for a region, defaulting to the comma.
 *
 * A comma default rather than a point: every country this app ships to uses one
 * except the British Isles and Switzerland, so an unknown code is far likelier
 * to be a comma country, and a wrong guess should be wrong for as few people as
 * possible.
 */
export function decimalMarkFor(region: string | null | undefined): DecimalMark {
  return regionByCode(region)?.decimal ?? ',';
}

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
export function moneyParts(currency: string, region: string): MoneyParts {
  return {
    symbol: CURRENCY_SYMBOL[currency] ?? '€',
    // From the REGION. See Region.decimal for why the language was wrong.
    comma: decimalMarkFor(region) === ',',
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
export function formatMoney(minor: number, currency: string, region: string): string {
  return assembleMoney(minor, moneyParts(currency, region));
}
