import { I18n, useMakePlural } from 'i18n-js';

import { DEFAULT_LANGUAGE } from './languages';
import { PLURAL_RULES } from './plural-rules';
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
 * Register a pluralizer for EVERY language, not just the irregular one.
 *
 * i18n-js resolves one as `registry[askedFor] || registry[i18n.locale] ||
 * registry.default`. A language with no entry falls to the middle term, which
 * is the engine-wide locale rather than the one the caller named — so with only
 * Polish registered, the first render after switching Polish → English asked
 * for English text using the Polish rule and printed
 * `[missing "en.lists.itemsCount.many" translation]` across the screen.
 *
 * A complete registry means the first term always hits and the middle term is
 * never reached. See ./plural-rules.ts for the rules and why they are narrower
 * than CLDR.
 */
for (const [code, pluralizer] of Object.entries(PLURAL_RULES)) {
  i18n.pluralization.register(code, useMakePlural({ pluralizer }));
}

export * from './languages';
export * from './plural-rules';
export * from './regions';
