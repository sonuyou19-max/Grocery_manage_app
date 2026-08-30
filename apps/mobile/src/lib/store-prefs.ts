import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { SUPERMARKETS, type Supermarket } from '@/lib/supermarkets';

/**
 * Persistent store preferences:
 * - custom stores the user typed (e.g. "Indian Store") become first-class
 *   picker options next time;
 * - every selection is timestamped so the picker orders stores from most
 *   recently used to least, with never-used chains after in catalog order.
 * Persisted in AsyncStorage, kept in memory for sync access, and exposed via
 * useSyncExternalStore so open sheets re-render on change.
 */

const PREFS_KEY = 'korb.storePrefs.v1';

export interface StorePrefs {
  custom: string[];
  lastUsed: Record<string, number>;
}

let prefs: StorePrefs = { custom: [], lastUsed: {} };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const persist = () => {
  AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {
    // best-effort persistence
  });
};

export async function hydrateStorePrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StorePrefs>;
      prefs = {
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
        lastUsed: parsed.lastUsed && typeof parsed.lastUsed === 'object' ? parsed.lastUsed : {},
      };
      emit();
    }
  } catch {
    // ignore corrupt prefs
  }
}

const isChainId = (store: string) => SUPERMARKETS.some((s) => s.id === store);

/** Record a selection: remembers custom stores and bumps recency. */
export function recordStoreUse(store: string): void {
  const clean = store.trim();
  if (!clean) return;

  const next: StorePrefs = {
    custom: [...prefs.custom],
    lastUsed: { ...prefs.lastUsed, [clean]: Date.now() },
  };
  if (
    !isChainId(clean) &&
    !next.custom.some((c) => c.toLowerCase() === clean.toLowerCase())
  ) {
    next.custom.push(clean);
  }
  prefs = next;
  persist();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStorePrefs(): StorePrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export type StoreOptionEntry =
  | { kind: 'chain'; id: string; chain: Supermarket }
  | { kind: 'custom'; id: string };

/**
 * Picker order: everything ever used sorts by recency (newest first), then
 * never-used chains in catalog order. Custom stores always have a timestamp,
 * so they slot in naturally by recency.
 */
export function orderedStoreOptions(current: StorePrefs): StoreOptionEntry[] {
  const entries: StoreOptionEntry[] = [
    ...SUPERMARKETS.map((chain) => ({ kind: 'chain' as const, id: chain.id, chain })),
    ...current.custom.map((name) => ({ kind: 'custom' as const, id: name })),
  ];

  const catalogRank = new Map(SUPERMARKETS.map((s, i) => [s.id, i]));
  return entries.sort((a, b) => {
    const usedA = current.lastUsed[a.id] ?? 0;
    const usedB = current.lastUsed[b.id] ?? 0;
    if (usedA !== usedB) return usedB - usedA;
    return (catalogRank.get(a.id) ?? SUPERMARKETS.length) - (catalogRank.get(b.id) ?? SUPERMARKETS.length);
  });
}
