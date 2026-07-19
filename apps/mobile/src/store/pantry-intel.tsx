import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import type { ItemCategory } from '@korb/shared';

import {
  applyAlmostOut,
  applyStillGood,
  buildDeck,
  normalizeKey,
  recordPurchase,
  type DeckCard,
  type ItemStat,
  type StatMap,
} from '@/lib/pantry-intel';
import { useGroceries } from '@/store/groceries';

/**
 * Holds the learned per-item stats that power the Pantry Vibe Check. Purchases
 * are logged whenever an item is checked off (the list screen calls
 * logPurchase). v1 is device-local, persisted to AsyncStorage.
 */

interface PantryIntelContext {
  stats: StatMap;
  logPurchase: (name: string, category: ItemCategory) => void;
  /** Swipe left: user confirms it's running low (caller adds it to a list). */
  markAlmostOut: (key: string) => void;
  /** Swipe right: user says it's still good; the model learns to wait longer. */
  markStillGood: (key: string) => void;
  /** Dev-only: inject back-dated stats so the deck is populated for testing. */
  seedDemo: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

// Back-dated sample items (name, category, days since "purchase") whose windows
// have already elapsed, so they land in the deck immediately. Dev preview only.
const DEMO: Array<[string, ItemCategory, number]> = [
  ['Almond milk', 'dairy_eggs', 16],
  ['Olive oil', 'pantry', 60],
  ['Coffee', 'pantry', 58],
  ['Bananas', 'fruit_veg', 10],
  ['Dish soap', 'household', 60],
  ['Sourdough', 'bakery', 7],
];

const STORAGE_KEY = 'korb.pantryIntel.v1';
const Ctx = createContext<PantryIntelContext | null>(null);

export function PantryIntelProvider({ children }: PropsWithChildren) {
  const [stats, setStats] = useState<StatMap>({});
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as StatMap;
          if (parsed && typeof parsed === 'object') setStats(parsed);
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true;
      });
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stats)).catch(() => {});
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [stats]);

  const value = useMemo<PantryIntelContext>(
    () => ({
      stats,
      logPurchase: (name, category) => setStats((prev) => recordPurchase(prev, name, category)),
      markAlmostOut: (key) => setStats((prev) => applyAlmostOut(prev, key)),
      markStillGood: (key) => setStats((prev) => applyStillGood(prev, key)),
      seedDemo: () =>
        setStats((prev) => {
          const now = Date.now();
          const next = { ...prev };
          for (const [name, category, daysAgo] of DEMO) {
            const key = normalizeKey(name);
            next[key] = {
              key,
              display: name,
              category,
              lastPurchasedAt: now - daysAgo * DAY,
              intervalDays: 0,
              sampleCount: 0,
              snoozeUntil: null,
            };
          }
          return next;
        }),
    }),
    [stats],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePantryIntel(): PantryIntelContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePantryIntel must be used within PantryIntelProvider');
  return ctx;
}

/**
 * The live Vibe Check deck: due items minus anything already queued on a list,
 * capped and urgency-sorted. Recomputed against the current clock each render.
 */
export function useVibeDeck(): { deck: DeckCard[]; count: number } {
  const { stats } = usePantryIntel();
  const { lists } = useGroceries();

  return useMemo(() => {
    const excludeKeys = new Set<string>();
    for (const list of lists) {
      for (const item of list.items) excludeKeys.add(normalizeKey(item.name));
    }
    const deck = buildDeck(stats, excludeKeys, Date.now());
    return { deck, count: deck.length };
  }, [stats, lists]);
}

export type { DeckCard, ItemStat };
