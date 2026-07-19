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

import { supabase } from '@/lib/supabase';
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
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';

/**
 * Learned per-item stats behind the Pantry Vibe Check, with two interchangeable
 * backends (same as the groceries store):
 *
 *  - Logged out / no household: LOCAL — AsyncStorage, per-device.
 *  - Signed in with a household: CLOUD — the shared pantry_items table, so
 *    every member's check-offs feed one burn-rate, kept live via realtime.
 *
 * Purchases are logged whenever an item is checked off (the list screen calls
 * logPurchase). The learning math itself lives in lib/pantry-intel and is
 * reused by both backends unchanged.
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

const seededDemoStats = (base: StatMap): StatMap => {
  const now = Date.now();
  const next = { ...base };
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
};

const Ctx = createContext<PantryIntelContext | null>(null);

// ---------------------------------------------------------------------------
// Provider selector
// ---------------------------------------------------------------------------

export function PantryIntelProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { household } = useHousehold();

  if (user && household) {
    return (
      <CloudPantryIntelProvider householdId={household.id} key={household.id}>
        {children}
      </CloudPantryIntelProvider>
    );
  }
  return <LocalPantryIntelProvider>{children}</LocalPantryIntelProvider>;
}

// ---------------------------------------------------------------------------
// LOCAL backend (AsyncStorage)
// ---------------------------------------------------------------------------

const LOCAL_KEY = 'korb.pantryIntel.v1';

function LocalPantryIntelProvider({ children }: PropsWithChildren) {
  const [stats, setStats] = useState<StatMap>({});
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LOCAL_KEY)
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
      AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(stats)).catch(() => {});
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
      seedDemo: () => setStats((prev) => seededDemoStats(prev)),
    }),
    [stats],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// CLOUD backend (shared pantry_items) — optimistic + realtime refetch + cache
// ---------------------------------------------------------------------------

interface DbPantryRow {
  item_key: string | null;
  name: string;
  display_name: string | null;
  category: ItemCategory;
  last_purchased_at: string | null;
  avg_purchase_interval_days: number | null;
  sample_count: number | null;
  snooze_until: string | null;
}

const mapRow = (r: DbPantryRow): ItemStat => ({
  key: r.item_key ?? normalizeKey(r.name),
  display: r.display_name ?? r.name,
  category: r.category,
  lastPurchasedAt: r.last_purchased_at ? Date.parse(r.last_purchased_at) : 0,
  intervalDays: r.avg_purchase_interval_days ?? 0,
  sampleCount: r.sample_count ?? 0,
  snoozeUntil: r.snooze_until ? Date.parse(r.snooze_until) : null,
});

const toRow = (householdId: string, s: ItemStat) => ({
  household_id: householdId,
  item_key: s.key,
  name: s.display,
  display_name: s.display,
  category: s.category,
  last_purchased_at: s.lastPurchasedAt ? new Date(s.lastPurchasedAt).toISOString() : null,
  // 0 samples means "still on the category default" — store null, not a rate.
  avg_purchase_interval_days: s.sampleCount > 0 ? s.intervalDays : null,
  sample_count: s.sampleCount,
  snooze_until: s.snoozeUntil ? new Date(s.snoozeUntil).toISOString() : null,
});

function CloudPantryIntelProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  const [stats, setStats] = useState<StatMap>({});
  const statsRef = useRef<StatMap>({});
  statsRef.current = stats;
  const cacheKey = `korb.pantryIntel.cloud.${householdId}`;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (map: StatMap) => {
      setStats(map);
      AsyncStorage.setItem(cacheKey, JSON.stringify(map)).catch(() => {});
    },
    [cacheKey],
  );

  const fetchStats = useCallback(async () => {
    const { data, error } = await supabase
      .from('pantry_items')
      .select(
        'item_key, name, display_name, category, last_purchased_at, avg_purchase_interval_days, sample_count, snooze_until',
      )
      .eq('household_id', householdId);
    if (!error && data) {
      const map: StatMap = {};
      for (const row of data as DbPantryRow[]) {
        const s = mapRow(row);
        map[s.key] = s;
      }
      apply(map);
    }
  }, [householdId, apply]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void fetchStats(), 300);
  }, [fetchStats]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (alive && raw) setStats(JSON.parse(raw) as StatMap);
      })
      .catch(() => {});
    void fetchStats();

    const channel = supabase
      .channel(`pantry-${householdId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pantry_items', filter: `household_id=eq.${householdId}` },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      alive = false;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, cacheKey, fetchStats, scheduleRefetch]);

  const value = useMemo<PantryIntelContext>(() => {
    const upsert = (keys: string[], map: StatMap) => {
      const rows = keys.map((k) => map[k]).filter(Boolean).map((s) => toRow(householdId, s));
      if (rows.length === 0) return;
      supabase
        .from('pantry_items')
        .upsert(rows, { onConflict: 'household_id,item_key' })
        .then(({ error }) => {
          if (error) scheduleRefetch();
        });
    };

    return {
      stats,
      logPurchase: (name, category) => {
        const next = recordPurchase(statsRef.current, name, category);
        apply(next);
        upsert([normalizeKey(name)], next);
      },
      markAlmostOut: (key) => {
        const next = applyAlmostOut(statsRef.current, key);
        apply(next);
        upsert([key], next);
      },
      markStillGood: (key) => {
        const next = applyStillGood(statsRef.current, key);
        apply(next);
        upsert([key], next);
      },
      seedDemo: () => {
        const next = seededDemoStats(statsRef.current);
        apply(next);
        upsert(
          DEMO.map(([name]) => normalizeKey(name)),
          next,
        );
      },
    };
  }, [stats, householdId, apply, scheduleRefetch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

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
