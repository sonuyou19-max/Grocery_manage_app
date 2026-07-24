import { I18n, useMakePlural } from 'i18n-js';

import { DEFAULT_LANGUAGE } from './languages';
import de from './locales/de';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import it from './locales/it';
import nl from './locales/nl';
import pl from './locales/pl';

/**
 * The translation engine. English is the source and fallback, so a partial
 * locale renders English for anything not yet translated — safe to ship
 * incrementally. Screens read strings via `useT()` from `@/store/locale`,
 * which passes the active language per call.
 */
export const i18n = new I18n({ en, de, fr, it, es, pl, nl });
i18n.enableFallback = true;
i18n.defaultLocale = DEFAULT_LANGUAGE;
i18n.locale = DEFAULT_LANGUAGE;

/**
 * Polish cardinal plural rule (CLDR). Polish needs three forms where English
 * needs two — 1 produkt / 2 produkty / 5 produktów — so without this the engine
 * would fall back to the English one/other split and render "5 produkty".
 * Spelled out rather than imported from `make-plural` (a transitive dependency
 * of i18n-js) so bundling never depends on that package staying hoisted.
 */
const polishPlural = (count: number): string => {
  // Fractions take "other"; every count we pluralize is a whole number.
  if (!Number.isInteger(count)) return 'other';
  if (count === 1) return 'one';
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
  return 'many';
};

i18n.pluralization.register('pl', useMakePlural({ pluralizer: polishPlural }));

export * from './languages';
export * from './regions';
