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
}

export const SUPERMARKETS: Supermarket[] = [
  { id: 'carrefour', name: 'Carrefour', color: '#004E9F', initials: 'C' },
  { id: 'lidl', name: 'Lidl', color: '#0050AA', initials: 'L' },
  { id: 'aldi', name: 'Aldi', color: '#001E5A', initials: 'A' },
  { id: 'colruyt', name: 'Colruyt', color: '#E2001A', initials: 'Co' },
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

/** Monogram for a custom (unknown) store name. */
export function customInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
