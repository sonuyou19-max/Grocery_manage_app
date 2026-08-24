/**
 * Popular European supermarket chains for the per-item store picker.
 *
 * We render brand-colored monogram badges (not trademarked logo images): this
 * works offline, avoids asset/copyright overhead, and real logos can replace
 * the badges later without changing the data model. A store is stored on an
 * item as a plain string — a known id here, or any custom name the user types.
 */

export interface Supermarket {
  id: string;
  name: string;
  /** Brand-ish background color. */
  color: string;
  /** Monogram shown on the badge. */
  initials: string;
  /** Use dark text on light brand colors. */
  darkText?: boolean;
  /**
   * The barcode format this chain's loyalty cards are known to use, when we know
   * it. Purely a **hint**: it warns the user when what they typed can't be drawn
   * that way, and never overrides their choice.
   *
   * Left undefined unless observed, and even then treat it as soft — these
   * chains operate across many countries and a format confirmed in Belgium may
   * differ in Poland. A wrong hint should only ever cost a dismissible warning.
   */
  cardFormat?: 'ean13' | 'ean8' | 'upca' | 'itf14' | 'code128' | 'qr';
  /** Digits the printed card number has, when it differs from the barcode's. */
  cardDigits?: number;
}

export const SUPERMARKETS: Supermarket[] = [
  // Observed in testing: the printed account number is longer than the barcode,
  // which encodes 13 digits as EAN-13. Reported for one market — hence a hint,
  // not a rule.
  { id: 'carrefour', name: 'Carrefour', color: '#004E9F', initials: 'C', cardFormat: 'ean13' },
  { id: 'lidl', name: 'Lidl', color: '#0050AA', initials: 'L' },
  { id: 'aldi', name: 'Aldi', color: '#001E5A', initials: 'A' },
  // Observed in testing: Colruyt issues QR loyalty cards.
  { id: 'colruyt', name: 'Colruyt', color: '#E2001A', initials: 'Co', cardFormat: 'qr' },
  { id: 'delhaize', name: 'Delhaize', color: '#B01E23', initials: 'D' },
  { id: 'albert_heijn', name: 'Albert Heijn', color: '#00ADE6', initials: 'AH' },
  { id: 'jumbo', name: 'Jumbo', color: '#EDB700', initials: 'J', darkText: true },
  { id: 'action', name: 'Action', color: '#E3000F', initials: 'Ac' },
  { id: 'rewe', name: 'Rewe', color: '#CC071E', initials: 'R' },
  { id: 'edeka', name: 'Edeka', color: '#003399', initials: 'E' },
  { id: 'kaufland', name: 'Kaufland', color: '#E10915', initials: 'K' },
  { id: 'auchan', name: 'Auchan', color: '#C8102E', initials: 'Au' },
  { id: 'mercadona', name: 'Mercadona', color: '#00843D', initials: 'M' },
  { id: 'tesco', name: 'Tesco', color: '#00539F', initials: 'T' },
  { id: 'intermarche', name: 'Intermarché', color: '#E2001A', initials: 'Im' },
];

const BY_ID = new Map(SUPERMARKETS.map((s) => [s.id, s]));

export function getSupermarket(id: string | null | undefined): Supermarket | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/** Display label for any store value (known id or custom name). */
export function supermarketLabel(store: string | null | undefined): string | null {
  if (!store) return null;
  return getSupermarket(store)?.name ?? store;
}

/**
 * Which chain a receipt's printed header is, or null for a shop we don't know.
 *
 * Tills print "CARREFOUR MARKET", "COLRUYT SA", "ALDI SUISSE" — the chain name
 * plus whatever the legal entity is called. So this looks for the catalogue
 * name as a whole WORD SEQUENCE inside the printed text, folded for case and
 * accents, and takes the longest match when more than one fits.
 *
 * That tiebreak is defensive and, as the catalogue stands, unreachable: no
 * chain's name contains another's. It is here for the entry that eventually
 * breaks that — a "Carrefour Express" beside "Carrefour" — because the
 * alternative is whichever happens to be listed first.
 *
 * Word-bounded rather than a plain substring test, because the short ids are
 * the dangerous ones: a bare `includes` would find "aldi" inside "Baldini" and
 * file an Italian deli's receipts under a German discounter forever.
 *
 * Null is an ordinary answer. `store` keeps the printed text either way, so an
 * unrecognised chain loses a badge and nothing else — which is why this is
 * allowed to be conservative and never has to guess.
 */
export function storeIdFor(printed: string | null | undefined): string | null {
  if (!printed) return null;
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const hay = fold(printed);

  let best: { id: string; length: number } | null = null;
  for (const s of SUPERMARKETS) {
    const needle = fold(s.name);
    // \b would not fire against an accented or hyphenated neighbour, so the
    // boundary is spelt out: start-or-non-letter, then the name, then
    // end-or-non-letter.
    const re = new RegExp(`(^|[^\\p{L}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
    if (!re.test(hay)) continue;
    if (!best || needle.length > best.length) best = { id: s.id, length: needle.length };
  }
  return best?.id ?? null;
}

/** Monogram for a custom (unknown) store name. */
export function customInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
