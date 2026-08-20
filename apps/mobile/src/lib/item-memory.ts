import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeKey } from '@/lib/pantry-intel';

/**
 * Per-item "usual" memory — the unit an item is measured in, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * What this used to remember, and why it stopped
 * ---------------------------------------------------------------------------
 *
 * It also carried the quantity and the store, and prefilled both on the next
 * add. That reads as helpful and is wrong: buying 0.9 kg of potatoes once is not
 * a statement that you always buy 0.9 kg. The next add arrived already claiming
 * an amount nobody had entered — and because the amount is what the price is
 * divided by, a figure invented by the app could end up in the price history as
 * though the shopper had put it there.
 *
 * The store had the same defect in a quieter form: last week's Aldi trip is not
 * a plan to go to Aldi, and a prefilled shop silently narrows what a "cheaper
 * elsewhere" comparison is even looking at.
 *
 * The unit stays, because it is not a fact about a purchase. Potatoes are
 * measured in kilos whether you buy one or ten, so remembering it is closer to
 * spelling than to data entry — and it fills a field that would otherwise have
 * to be re-chosen to mean anything at all.
 *
 * Price was never remembered: it varies per shop and per week.
 *
 * Keyed by the same normalized item name as the pantry (via normalizeKey), so
 * "Milk", "milk " and "milk" are one item across the whole app.
 *
 * On-device only (like the category cache): it's a friction-saving hint, not
 * shared household state, so it never needs a server round-trip.
 */

export interface ItemUsual {
  unit: string | null;
}

/*
 * v2 because v1's entries carry a quantity and a store this no longer applies.
 * Leaving them readable would mean a device that had used the old build kept
 * prefilling amounts from a cache the new code cannot see into.
 */
const CACHE_KEY = 'korb.itemMemory.v2';
let memory: Record<string, ItemUsual> = {};

export async function hydrateItemMemory(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') memory = parsed;
    }
  } catch {
    // ignore corrupt cache — memory stays empty, prefill simply does nothing
  }
}

/**
 * Remember the unit last chosen for an item name. No-ops when there is nothing
 * to remember, so merely opening an item's sheet never creates a junk entry
 * (nor erases a real one).
 */
export function rememberItemDetails(name: string, usual: Partial<ItemUsual>): void {
  const unit = usual.unit ?? null;
  if (unit == null) return;

  memory[normalizeKey(name)] = { unit };
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memory)).catch(() => {
    // best-effort persistence
  });
}

/** Recall the remembered usuals for an item name, or null if never seen. */
export function recallItemDetails(name: string): ItemUsual | null {
  return memory[normalizeKey(name)] ?? null;
}
