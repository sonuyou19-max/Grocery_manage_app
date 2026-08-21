import AsyncStorage from '@react-native-async-storage/async-storage';

import { reportWriteFailure } from '@/lib/monitoring';
import { normalizeKey } from '@/lib/pantry-intel';
import { supabase } from '@/lib/supabase';

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
 * ---------------------------------------------------------------------------
 * On-device, and — since migration 0037 — also on the server
 * ---------------------------------------------------------------------------
 *
 * This started as a device-local hint, matching the categoriser and
 * item-memory. That was right while one person shopped from one phone and
 * stopped being right the moment two did: "You usually buy" filters a list's
 * chips by home list, so the strip appeared on whichever handset had done the
 * adding and was simply absent on the other. Reported as an iOS feature missing
 * from Android; in truth it was a feature of one phone.
 *
 * "Milk goes on the weekly shop" is a fact about the household, not about a
 * handset, and there is no sensible answer to which phone should win. So the
 * home list now lives on pantry_items.home_list_id, and this cache becomes the
 * local half of a two-sided store: written through on every remember, read as
 * the fallback when the server has no answer (signed out, offline, or an item
 * bought for the first time on this device a moment ago).
 *
 * The server write is an UPDATE rather than an upsert, deliberately. An item
 * with no pantry row has never been bought, and an item that has never been
 * bought is never due — so it can never appear in the strip this feeds, and
 * conjuring a row for it would put a history-less entry in everyone's pantry to
 * no purpose. The row's first appearance is handled where it actually happens:
 * pantry-intel's toRow seeds home_list_id from this cache when a check-off
 * creates it.
 *
 * The stored id can still go stale — the list was deleted, or you signed in and
 * moved from local to household lists, which is a different id space. Callers
 * must treat a recalled id as a *suggestion* and check it still resolves to a
 * live list.
 *
 * Entries are namespaced per household. Without that, "milk" homed to a list at
 * home would resolve to nothing at the office, and picking an office list there
 * would overwrite the home mapping — so the routing would thrash every time you
 * switched. `setHomeListScope` is called by the provider when the active
 * household changes.
 */

const CACHE_KEY = 'korb.itemHomeList.v2';
/** { [householdId | 'local']: { [itemKey]: listId } } */
let homes: Record<string, Record<string, string>> = {};
let scope = 'local';

/** Point the cache at a household (or 'local' when signed out). */
export function setHomeListScope(householdId: string | null): void {
  scope = householdId ?? 'local';
}

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
  (homes[scope] ??= {})[key] = listId;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(homes)).catch(() => {
    // best-effort persistence
  });

  // Signed out, there is no household to share with and `scope` says so.
  if (scope === 'local') return;
  supabase
    .from('pantry_items')
    .update({ home_list_id: listId })
    .eq('household_id', scope)
    .eq('item_key', key)
    .then(({ error }) => {
      // Reported, not retried, and never surfaced: the local write above has
      // already made this device behave correctly, so a failure here costs the
      // OTHER member's chips until the next add — not this user's.
      reportWriteFailure('pantry_items.homeList', error);
    });
}

/**
 * The list this item was last added to, or null if we've never seen it. The id
 * is not guaranteed to still exist — verify it against the live lists before
 * using it.
 */
export function recallItemList(name: string): string | null {
  return homes[scope]?.[normalizeKey(name)] ?? null;
}

/**
 * Drop a list's entries once it's gone, so items homed there fall back to the
 * picker instead of holding a dead id forever.
 */
/**
 * Drop every remembered home list, in memory as well as on disk.
 *
 * Called on sign-out. Removing the storage key alone would not be enough: this
 * module keeps the whole map in a module-level variable, so the next
 * rememberItemList would serialise the old households straight back over the
 * file we just deleted.
 */
export function forgetAllHomeLists(): void {
  homes = {};
  scope = 'local';
  AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}

export function forgetHomeList(listId: string): void {
  let changed = false;
  for (const entries of Object.values(homes)) {
    for (const [key, id] of Object.entries(entries)) {
      if (id === listId) {
        delete entries[key];
        changed = true;
      }
    }
  }
  if (!changed) return;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(homes)).catch(() => {
    // best-effort persistence
  });
}
