import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ItemCategory } from '@korb/shared';

import { supabase } from '@/lib/supabase';

/**
 * The shared item lexicon, on the device.
 *
 * The server side is migration 0019: a global table of folded term → emoji +
 * category, learned once by the AI and published only after three unrelated
 * people asked about the same word. This module is the read half — it keeps a
 * copy on the phone so a lookup is a Map hit rather than a network call.
 *
 * Three properties it has to have, in order:
 *
 *  - **Synchronous.** It sits behind `emojiFor`, which runs on every row of
 *    every list during render. An async lookup there would mean either a
 *    flicker or a promise per row, and both are worse than a generic icon.
 *  - **Offline.** Mirrored to AsyncStorage, so a phone with no signal still
 *    renders everything it learned last time.
 *  - **Cheap to refresh.** Synced as a delta — "published rows changed since
 *    the last cursor" — so the second sync transfers almost nothing however
 *    large the dictionary grows.
 */

interface LexiconEntry {
  emoji: string;
  category: ItemCategory | null;
}

const CACHE_KEY = 'korb.itemLexicon.v1';
const CURSOR_KEY = 'korb.itemLexicon.cursor.v1';

/**
 * Ceiling on what we keep locally.
 *
 * The lexicon is shared across every customer, so unlike the rest of this app's
 * caches its size is not bounded by anything one user does. Twenty thousand
 * short entries is a couple of megabytes and covers a grocery vocabulary many
 * times over; past that the sync stops asking for more rather than growing
 * without limit on someone's phone.
 */
const MAX_ENTRIES = 20_000;

/** How many rows one delta request pulls. Several pages run per sync. */
const PAGE = 1000;

let entries = new Map<string, LexiconEntry>();
let cursor: string | null = null;
let hydrated = false;

/**
 * Bumped whenever the map changes, so React can re-render rows whose emoji has
 * just been learned. Components subscribe via useSyncExternalStore rather than
 * this module holding state — the map is read during render by pure code, and
 * making it a context would mean threading it through every call site.
 */
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeLexicon(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lexiconVersion(): number {
  return version;
}

/**
 * Look a folded term up. Returns undefined when we've never heard of it, which
 * is the caller's cue to fall back.
 *
 * Takes an ALREADY-FOLDED key: the caller (item-emoji.ts) has folded the name
 * anyway to try its own table, and folding twice is wasted work on a hot path.
 */
export function lexiconLookup(foldedTerm: string): LexiconEntry | undefined {
  return entries.get(foldedTerm);
}

/**
 * Record what the AI just told us, immediately and locally.
 *
 * The server may not publish this term for a long time — it needs two more
 * people to ask — but the person who triggered the call should never pay for it
 * twice. This is why the local cache is written from the response rather than
 * waiting for the term to come back down through the sync.
 */
export function learnLexiconEntry(
  foldedTerm: string,
  emoji: string,
  category: ItemCategory | null,
): void {
  if (!foldedTerm || !emoji) return;
  const existing = entries.get(foldedTerm);
  if (existing?.emoji === emoji && existing.category === category) return;
  entries.set(foldedTerm, { emoji, category });
  changed();
  void persist();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(() => {
      const flat: Record<string, [string, ItemCategory | null]> = {};
      for (const [term, e] of entries) flat[term] = [e.emoji, e.category];
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flat)).catch(() => {}).finally(resolve);
    }, 400);
  });
}

/** Read the on-device copy. Called once at app start, before the first render. */
export async function hydrateLexicon(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const [raw, savedCursor] = await Promise.all([
      AsyncStorage.getItem(CACHE_KEY),
      AsyncStorage.getItem(CURSOR_KEY),
    ]);
    cursor = savedCursor;
    if (raw) {
      const flat = JSON.parse(raw) as Record<string, [string, ItemCategory | null]>;
      const next = new Map<string, LexiconEntry>();
      for (const [term, [emoji, category]] of Object.entries(flat)) {
        next.set(term, { emoji, category });
      }
      entries = next;
      changed();
    }
  } catch {
    // A corrupt cache costs a re-sync, not a broken app. Start empty and let
    // the delta below refill from scratch — cursor stays null, so it will.
    entries = new Map();
    cursor = null;
  }
}

/**
 * Pull everything published since the last sync.
 *
 * Deliberately not called on every app open from cold: the dictionary changes
 * slowly and this is a network request the user did not ask for. The caller
 * (app start) fires it once, after hydration, and ignores failures completely —
 * a stale lexicon is invisible, a failed one would be a toast about a feature
 * nobody knows exists.
 */
export async function syncLexicon(): Promise<void> {
  if (entries.size >= MAX_ENTRIES) return;
  try {
    let moved = false;
    // Page until the server runs out or we hit the local ceiling. Ordering by
    // updated_at and carrying the last value as the cursor is what makes this a
    // delta; the partial index in 0019 covers exactly this query.
    for (let page = 0; page < 25; page += 1) {
      let q = supabase
        .from('item_lexicon')
        .select('term, emoji, category, updated_at')
        .order('updated_at', { ascending: true })
        .limit(PAGE);
      if (cursor) q = q.gt('updated_at', cursor);

      const { data, error } = await q;
      if (error || !data || data.length === 0) break;

      for (const row of data as Array<{
        term: string;
        emoji: string;
        category: ItemCategory | null;
        updated_at: string;
      }>) {
        if (entries.size >= MAX_ENTRIES && !entries.has(row.term)) continue;
        entries.set(row.term, { emoji: row.emoji, category: row.category });
        cursor = row.updated_at;
        moved = true;
      }
      if (data.length < PAGE) break;
    }

    if (moved) {
      changed();
      await persist();
      if (cursor) await AsyncStorage.setItem(CURSOR_KEY, cursor);
    }
  } catch {
    // Offline, or the table isn't deployed yet. Both are fine — every lookup
    // still has the curated table and the category fallback beneath it.
  }
}

/** Test seam: reset module state between check runs. */
export function __resetLexicon(): void {
  entries = new Map();
  cursor = null;
  hydrated = false;
  changed();
}
