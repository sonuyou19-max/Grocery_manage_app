import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeKey } from '@/lib/pantry-intel';

/**
 * Per-item "usual" memory — the same idea as the learned category cache
 * (lib/categorize), for the optional detail fields. When you re-add an item
 * you've bought before, we prefill the quantity, unit and supermarket you last
 * chose for it, so common items take one tap instead of re-entry.
 *
 * Keyed by the same normalized item name as the pantry (via normalizeKey), so
 * "Milk", "milk " and "milk" are one item across the whole app. Price is
 * deliberately NOT remembered — it varies per shop and per week, so prefilling
 * it would be misleading.
 *
 * On-device only (like the category cache): it's a friction-saving hint, not
 * shared household state, so it never needs a server round-trip.
 */

export interface ItemUsual {
  quantity: number | null;
  unit: string | null;
  store: string | null;
}

const CACHE_KEY = 'korb.itemMemory.v1';
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
 * Remember the detail fields last chosen for an item name. Stores a snapshot so
 * the memory always reflects your most recent choice. No-ops when every field
 * is empty, so merely opening an item's sheet without setting anything never
 * creates a junk entry (nor erases a real one).
 */
export function rememberItemDetails(name: string, usual: Partial<ItemUsual>): void {
  const quantity = usual.quantity ?? null;
  const unit = usual.unit ?? null;
  const store = usual.store ?? null;
  if (quantity == null && unit == null && store == null) return;

  memory[normalizeKey(name)] = { quantity, unit, store };
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memory)).catch(() => {
    // best-effort persistence
  });
}

/** Recall the remembered usuals for an item name, or null if never seen. */
export function recallItemDetails(name: string): ItemUsual | null {
  return memory[normalizeKey(name)] ?? null;
}
