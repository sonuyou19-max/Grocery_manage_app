import { asUnit, type ItemCategory, type ParsedItem } from '@korb/shared';

import { recallItemDetails } from '@/lib/item-memory';
import { unitFor } from '@/lib/item-unit';
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
      // No quantity and no store. A suggestion is a reminder that you are due
      // something, not a claim about how much of it you buy or where — and both
      // used to arrive prefilled from the last purchase.
      quantity: null,
      // Your own choice first, then the suggestion — same precedence as the
      // add paths in the groceries store, so an item suggested here and an
      // item typed by hand arrive with the same unit.
      unit: asUnit(usual?.unit) ?? unitFor(c.display, c.category),
      store: null,
    };
  });
}
