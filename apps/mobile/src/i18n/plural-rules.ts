/**
 * Which plural form each language uses for a given count.
 *
 * ---------------------------------------------------------------------------
 * Why every language needs an entry, including the boring ones
 * ---------------------------------------------------------------------------
 *
 * Only Polish used to be registered, on the reasoning that everything else uses
 * the engine's default one/other rule anyway. That reasoning was wrong, and the
 * bug it caused was invisible until somebody switched languages.
 *
 * i18n-js resolves a pluralizer like this (Pluralization.get):
 *
 *     registry[requestedLocale] || registry[i18n.locale] || registry.default
 *
 * With no entry for `en`, the first term misses and the second consults the
 * ENGINE-WIDE current locale — a completely different variable from the one the
 * caller asked for. Switch from Polish to English and, for one render, the app
 * asks for English text using the POLISH rule: count 5 resolves to `many`,
 * English has no `many`, and the screen fills with
 *
 *     [missing "en.lists.itemsCount.many" translation]
 *
 * and stays that way, because assigning i18n.locale re-renders nothing.
 *
 * Registering a rule per language makes the first term always hit, so the
 * engine-wide locale can never leak into a translation that named its own.
 * That is the real fix; the render-time assignment in store/locale.tsx closes
 * the same hole from the other side.
 *
 * ---------------------------------------------------------------------------
 * These rules may only return forms the locale files actually define
 * ---------------------------------------------------------------------------
 *
 * That is the invariant, and check-locales.mjs enforces it by running every
 * rule over a range of counts and looking each result up in the real locale
 * file. A rule is not "the CLDR rule for this language" — it is "the rule this
 * app's translations can satisfy". CLDR gives Italian and Spanish a `many`
 * category for large compact numbers (1.2M and up); Korb counts items, days and
 * weeks, never reaches those magnitudes, and does not translate that form, so
 * including it would only create a way to render an error string.
 */

export type PluralRule = (count: number) => string;

/**
 * One for exactly 1, other for everything else.
 *
 * English, German, Dutch, Spanish, Italian. Note 0 takes `other` — "0 items",
 * not "0 item".
 */
const oneOther: PluralRule = (count) => (count === 1 ? 'one' : 'other');

/**
 * French: zero and one are both singular.
 *
 * "0 produit", "1 produit", "2 produits". This is the one European language
 * here where the default English rule would produce visibly wrong text, which
 * is a good reminder that "everything else uses one/other" was never true.
 */
const french: PluralRule = (count) => (Math.abs(count) < 2 ? 'one' : 'other');

/**
 * Polish cardinal rule (CLDR): 1 produkt / 2 produkty / 5 produktów.
 *
 * Spelled out rather than imported from `make-plural` (a transitive dependency
 * of i18n-js) so bundling never depends on that package staying hoisted.
 */
const polish: PluralRule = (count) => {
  // Fractions take `other`; every count this app pluralizes is a whole number.
  if (!Number.isInteger(count)) return 'other';
  if (count === 1) return 'one';
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
  return 'many';
};

/**
 * Every language Korb ships, with no gaps.
 *
 * A missing entry here is not a missing feature — it is the fallback chain
 * above, waiting for somebody to change language. check-locales.mjs fails the
 * build if this does not cover LANGUAGES exactly.
 */
export const PLURAL_RULES: Record<string, PluralRule> = {
  en: oneOther,
  de: oneOther,
  nl: oneOther,
  es: oneOther,
  it: oneOther,
  fr: french,
  pl: polish,
};
