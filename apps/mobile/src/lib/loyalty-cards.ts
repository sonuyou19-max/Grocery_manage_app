import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  guessSymbology,
  normalizeForSymbology,
  symbologyForFormat,
  type CardFormat,
  type Symbology,
} from '@/lib/barcode';
import { uuidv4 } from '@/lib/uuid';

/**
 * Loyalty cards — on this device, for this signed-in user, and nowhere else.
 *
 * Three hard rules, all deliberate:
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
 * 3. **Sign-in required.** Unlike lists, which work fully logged-out, a card
 *    needs an owner. Without one there is only "this device", and on a shared
 *    phone that bucket is exactly the leak rule 2 exists to prevent — whoever
 *    picks the phone up next would find someone else's cards. So there is no
 *    anonymous bucket at all: a user id is the *only* thing that produces a
 *    storage scope.
 *
 * How rule 2 is enforced, rather than merely intended:
 *
 * - Each user gets **their own storage key**, so switching users doesn't just
 *   filter another user's cards out of view — theirs are never read into memory
 *   at all.
 * - The scope is an **explicit argument**, derived at the call site from the
 *   live auth context. There is no module-level "current user" to fall stale
 *   while a screen is mounted, which is the usual way this class of leak
 *   happens.
 * - Reads are **scope-checked against the cache**: if the loaded scope isn't
 *   the requested one, callers get an empty list, never the previous user's
 *   data during the gap.
 * - **No signed-in user means no scope**, so reads return nothing and writes
 *   refuse — the gate is in the storage layer, not only in the UI that happens
 *   to sit in front of it.
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

/** One key per user. There is no shared or anonymous key — see rule 3 above. */
const keyFor = (userId: string) => `korb.loyaltyCards.v1.${userId}`;

/**
 * The storage scope for a user id: the id itself, or null when there is no
 * signed-in user to own the cards. Null covers both "signed out" and "auth
 * hasn't resolved yet"; callers that need to tell those apart (to choose
 * between a sign-in prompt and a spinner) read `authPending` below.
 */
const scopeFor = (userId: string | null | undefined): string | null => userId || null;

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
  /** True while this user's cards are being read, or while auth resolves. */
  loading: boolean;
  /**
   * No signed-in user, so there is nowhere to keep cards. The screen shows a
   * sign-in prompt; every mutator below is a no-op.
   */
  needsSignIn: boolean;
  /** Returns the created card, or null when there's no owner or no value. */
  addCard: (input: NewCard) => LoyaltyCard | null;
  removeCard: (id: string) => void;
  /** Change the store a card is filed under. */
  renameCardStore: (id: string, store: string) => void;
  /**
   * Switch a saved card between barcode and QR.
   *
   * Needed at the till, not just at setup: whether a chain reads 1D or 2D can't
   * be inferred from the number, so the first sign of a wrong guess is often a
   * scanner refusing it — at which point the fix has to be one tap away.
   */
  setCardFormat: (id: string, format: CardFormat) => void;
}

/**
 * The signed-in user's cards.
 *
 * Pass the user id from `useAuth()`, and pass **`undefined` while auth is still
 * initializing** — that reports `loading` rather than `needsSignIn`, so the
 * wallet shows a spinner for the moment before a restored session appears
 * instead of flashing "sign in" at someone who already is.
 *
 * The scope is intentionally an argument rather than module state, so it cannot
 * go stale under a mounted screen.
 */
export function useLoyaltyCards(userId: string | null | undefined): LoyaltyCardsApi {
  const scope = scopeFor(userId);
  const authPending = userId === undefined;
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

  const setCardFormat = useCallback(
    (id: string, format: CardFormat) => {
      if (!scope || cache?.scope !== scope) return;
      persist(
        scope,
        cache.cards.map((c) => {
          if (c.id !== id) return c;
          const symbology = symbologyForFormat(format, c.value);
          // Re-normalize: the stored value was cleaned for the *old* format, and
          // the rules differ (QR keeps every character, a printed number loses
          // its spacing). Skipping this would leave value and symbology
          // disagreeing about what the payload is.
          return { ...c, symbology, value: normalizeForSymbology(symbology, c.value) };
        }),
      );
    },
    [scope],
  );

  return {
    cards,
    // Signed out isn't "loading" — there is nothing to wait for, so the screen
    // shows the sign-in prompt straight away rather than an endless spinner.
    loading: authPending || (scope !== null && !ready),
    needsSignIn: !authPending && scope === null,
    addCard,
    removeCard,
    setCardFormat,
    renameCardStore,
  };
}
