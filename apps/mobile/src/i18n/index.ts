import { I18n } from 'i18n-js';

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

export * from './languages';
export * from './regions';
