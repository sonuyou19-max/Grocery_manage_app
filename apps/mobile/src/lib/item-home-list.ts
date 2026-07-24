import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeKey } from '@/lib/pantry-intel';

/**
 * Per-item "home list" memory — which list an item belongs on.
 *
 * Single-item adds from the Pantry tab and the Vibe Check deck used to ask
 * "which list?" every time, which is a lot of taps for something the answer
 * rarely changes for. Instead we remember the list an item was last added to
 * and send it straight back there, with a soft toast saying where it went.
 *
 * Home = the list it was LAST added to: every add overwrites the entry, so
 * re-homing an item happens naturally just by adding it somewhere else.
 *
 * Keyed by the same normalized name as the pantry and item-memory caches, so
 * "Milk", "milk " and "milk" are one item everywhere.
 *
 * On-device only, matching the categoriser and item-memory precedent — it's a
 * friction-saving hint, not shared household state. That also means the stored
 * id can go stale (the list was deleted, or you signed in and moved from local
 * to household lists, which is a different id space). Callers must treat a
 * recalled id as a *suggestion* and check it still resolves to a live list.
 */

const CACHE_KEY = 'korb.itemHomeList.v1';
let homes: Record<string, string> = {};

export async function hydrateItemHomeLists(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') homes = parsed;
    }
  } catch {
    // ignore corrupt cache — callers fall back to asking which list
  }
}

/** Record the list an item was just added to. Last add wins. */
export function rememberItemList(name: string, listId: string): void {
  const key = normalizeKey(name);
  if (!key || !listId) return;
  homes[key] = listId;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(homes)).catch(() => {
    // best-effort persistence
  });
}

/**
 * The list this item was last added to, or null if we've never seen it. The id
 * is not guaranteed to still exist — verify it against the live lists before
 * using it.
 */
export function recallItemList(name: string): string | null {
  return homes[normalizeKey(name)] ?? null;
}

/**
 * Drop a list's entries once it's gone, so items homed there fall back to the
 * picker instead of holding a dead id forever.
 */
export function forgetHomeList(listId: string): void {
  let changed = false;
  for (const [key, id] of Object.entries(homes)) {
    if (id === listId) {
      delete homes[key];
      changed = true;
    }
  }
  if (!changed) return;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(homes)).catch(() => {
    // best-effort persistence
  });
}
