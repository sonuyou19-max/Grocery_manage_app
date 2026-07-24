/**
 * UI languages the app ships. English is the source/fallback; the first five
 * additions are the EU's largest by native speakers, plus Dutch (home market).
 * Each is labelled by its endonym so the language picker is understandable
 * regardless of the current language.
 *
 * Adding a language later = add its code here + a locale file in ./locales.
 */
export interface Language {
  code: string;
  /** The language's own name for itself, e.g. "Deutsch". */
  endonym: string;
  /** English name, for reference in settings/search. */
  english: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', endonym: 'English', english: 'English' },
  { code: 'de', endonym: 'Deutsch', english: 'German' },
  { code: 'fr', endonym: 'Français', english: 'French' },
  { code: 'it', endonym: 'Italiano', english: 'Italian' },
  { code: 'es', endonym: 'Español', english: 'Spanish' },
  { code: 'pl', endonym: 'Polski', english: 'Polish' },
  { code: 'nl', endonym: 'Nederlands', english: 'Dutch' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = 'en';

export const languageByCode = (code: string): Language | undefined =>
  LANGUAGES.find((l) => l.code === code);
