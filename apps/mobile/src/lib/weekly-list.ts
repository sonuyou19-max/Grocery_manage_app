import type { ItemCategory, ParsedItem } from '@korb/shared';

import { recallItemDetails } from '@/lib/item-memory';
import { buildDeck, type StatMap } from '@/lib/pantry-intel';

/**
 * "Build my weekly list" suggestions: the pantry items predicted to be running
 * low (buildDeck — due, urgency-sorted, and already excluding anything on a
 * list), enriched with each item's remembered usual quantity/unit/store (#3).
 * Pure composition of existing intelligence — no new data.
 */

export interface WeeklySuggestion {
  key: string;
  display: string;
  category: ItemCategory;
  quantity: number | null;
  unit: ParsedItem['unit'];
  store: string | null;
}

const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'] as const;
const asUnit = (u: string | null): ParsedItem['unit'] =>
  u && (UNITS as readonly string[]).includes(u) ? (u as ParsedItem['unit']) : null;

export function buildWeeklySuggestions(
  stats: StatMap,
  excludeKeys: Set<string>,
  now: number,
): WeeklySuggestion[] {
  return buildDeck(stats, excludeKeys, now).map((c) => {
    const usual = recallItemDetails(c.display);
    return {
      key: c.key,
      display: c.display,
      category: c.category,
      quantity: usual?.quantity ?? null,
      unit: asUnit(usual?.unit ?? null),
      store: usual?.store ?? null,
    };
  });
}
