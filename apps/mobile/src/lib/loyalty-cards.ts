import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { guessSymbology, normalizeForSymbology, type Symbology } from '@/lib/barcode';
import { uuidv4 } from '@/lib/uuid';

/**
 * Loyalty cards — on this device, for this user, and nowhere else.
 *
 * Two hard rules, both deliberate:
 *
 * 1. **Device only.** Cards never touch Supabase — no table, no RPC, no
 *    realtime. A loyalty number is a payment-adjacent identifier tied to a
 *    named retail account, and syncing it would mean holding it server-side for
 *    a feature whose whole value is offline (you need it *at the till*, where
 *    signal is often worst). The cost is that cards don't follow you to a new
 *    phone; that is the accepted trade.
 *
 * 2. **Per user, even within a household.** Household members share lists and a
 *    pantry, but a loyalty card is personal — its points and purchase history
 *    belong to one account holder. So cards are keyed by user id and are
 *    invisible to everyone else, including a partner in the same household on
 *    the same device.
 *
 * How rule 2 is enforced, rather than merely intended:
 *
 * - Each scope gets **its own storage key**, so switching users doesn't just
 *   filter another user's cards out of view — theirs are never read into memory
 *   at all.
 * - The scope is an **explicit argument**, derived at the call site from the
 *   live auth context. There is no module-level "current user" to fall stale
 *   while a screen is mounted, which is the usual way this class of leak
 *   happens.
 * - Reads are **scope-checked against the cache**: if the loaded scope isn't
 *   the requested one, callers get an empty list and a loading flag, never the
 *   previous user's data during the gap.
 */

export interface LoyaltyCard {
  id: string;
  /** A SUPERMARKETS id, or any custom name the user typed. */
  store: string;
  symbology: Symbology;
  /**
   * The code, ready to encode. Scanned QR payloads are verbatim; printed
   * numbers have had spacing (and numeric grouping dashes) removed. Case is
   * always preserved — see normalizeCardValue in lib/barcode.ts for why.
   */
  value: string;
  createdAt: number;
}

/** Signed-out scope. The device owner's own bucket; no user identity exists. */
const DEVICE_SCOPE = 'device';

const keyFor = (scope: string) => `korb.loyaltyCards.v1.${scope}`;

/**
 * Which bucket a user id maps to.
 *
 * `undefined` means *not yet known* — auth is still restoring the session — and
 * returns null rather than falling back to the device bucket. Without that
 * distinction there's a live race at launch: for the moment before the session
 * resolves, a signed-in user looks signed-out, so a card added right then would
 * be filed under `device` and appear to vanish once auth caught up.
 */
const scopeFor = (userId: string | null | undefined): string | null => {
  if (userId === undefined) return null;
  return userId || DEVICE_SCOPE;
};

/**
 * Only ever holds ONE scope's cards. Replaced wholesale on a scope change, so
 * a signed-out or different user cannot observe the previous user's cards.
 */
let cache: { scope: string; cards: LoyaltyCard[] } | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => cache;

function isCard(value: unknown): value is LoyaltyCard {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<LoyaltyCard>;
  return typeof c.id === 'string' && typeof c.store === 'string' && typeof c.value === 'string';
}

/** In-flight loads, so concurrent mounts don't each hit storage. */
const loading = new Map<string, Promise<void>>();

async function load(scope: string): Promise<void> {
  const existing = loading.get(scope);
  if (existing) return existing;

  const task = (async () => {
    let cards: LoyaltyCard[] = [];
    try {
      const raw = await AsyncStorage.getItem(keyFor(scope));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) cards = parsed.filter(isCard);
      }
    } catch {
      // Corrupt or unreadable — start empty rather than crash the wallet. The
      // user can re-add; nothing here is the only copy of anything.
    }
    cache = { scope, cards };
    emit();
  })().finally(() => {
    loading.delete(scope);
  });

  loading.set(scope, task);
  return task;
}

function persist(scope: string, cards: LoyaltyCard[]): void {
  cache = { scope, cards };
  emit();
  AsyncStorage.setItem(keyFor(scope), JSON.stringify(cards)).catch(() => {
    // best-effort persistence
  });
}

/**
 * Delete every card for a user. Called on account deletion so "delete my
 * account" really does remove the loyalty numbers too, matching what the
 * privacy policy promises about local data.
 */
export async function wipeLoyaltyCards(userId: string | null | undefined): Promise<void> {
  const scope = scopeFor(userId);
  // Nothing to wipe if we don't know whose cards these are — better to leave
  // them than to clear the wrong bucket.
  if (!scope) return;
  try {
    await AsyncStorage.removeItem(keyFor(scope));
  } catch {
    // best-effort
  }
  if (cache?.scope === scope) {
    cache = { scope, cards: [] };
    emit();
  }
}

export interface NewCard {
  store: string;
  value: string;
  /** Omit to infer from the value's shape and check digit. */
  symbology?: Symbology;
}

export interface LoyaltyCardsApi {
  cards: LoyaltyCard[];
  /** True until this scope's cards are in memory. */
  loading: boolean;
  /** Returns the created card, or null when the value is empty. */
  addCard: (input: NewCard) => LoyaltyCard | null;
  removeCard: (id: string) => void;
  /** Change the store a card is filed under. */
  renameCardStore: (id: string, store: string) => void;
}

/**
 * The signed-in user's cards.
 *
 * Pass the user id from `useAuth()`, and pass **`undefined` while auth is still
 * initializing** — that reports `loading` and refuses writes, instead of
 * briefly treating a signed-in user as signed-out. The scope is intentionally
 * an argument rather than module state, so it cannot go stale under a mounted
 * screen.
 */
export function useLoyaltyCards(userId: string | null | undefined): LoyaltyCardsApi {
  const scope = scopeFor(userId);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    // Load whenever the scope changes — including a sign-out, which must
    // replace the cache rather than leave the previous user's cards in it.
    if (scope && cache?.scope !== scope) void load(scope);
  }, [scope, snapshot]);

  // The gate: only serve cards that belong to the scope being asked for. A
  // mid-load render therefore shows an empty wallet, never someone else's.
  const ready = scope !== null && snapshot?.scope === scope;
  const cards = ready ? snapshot.cards : [];

  const addCard = useCallback(
    (input: NewCard): LoyaltyCard | null => {
      if (!scope || cache?.scope !== scope) return null;
      const store = input.store.trim();
      // Symbology first, because how the value may be cleaned depends on it —
      // a QR payload has to survive byte-for-byte, a printed number doesn't.
      const symbology = input.symbology ?? guessSymbology(input.value);
      const value = normalizeForSymbology(symbology, input.value);
      if (!value || !store) return null;
      const card: LoyaltyCard = {
        id: uuidv4(),
        store,
        symbology,
        value,
        createdAt: Date.now(),
      };
      // Newest first: the card you just added is the one you're about to use.
      persist(scope, [card, ...cache.cards]);
      return card;
    },
    [scope],
  );

  const removeCard = useCallback(
    (id: string) => {
      if (!scope || cache?.scope !== scope) return;
      persist(
        scope,
        cache.cards.filter((c) => c.id !== id),
      );
    },
    [scope],
  );

  const renameCardStore = useCallback(
    (id: string, store: string) => {
      if (!scope || cache?.scope !== scope) return;
      const clean = store.trim();
      if (!clean) return;
      persist(
        scope,
        cache.cards.map((c) => (c.id === id ? { ...c, store: clean } : c)),
      );
    },
    [scope],
  );

  return { cards, loading: !ready, addCard, removeCard, renameCardStore };
}
