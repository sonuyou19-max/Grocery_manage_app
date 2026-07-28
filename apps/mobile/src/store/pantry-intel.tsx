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
import { uuidv4 } from '@/lib/uuid';
import { useAppActive } from '@/lib/use-app-active';
import {
  applyAlmostOut,
  applyResting,
  applyStaple,
  applyStillGood,
  buildDeck,
  normalizeKey,
  recordPurchase,
  type DeckCard,
  type ItemStat,
  type StatMap,
} from '@/lib/pantry-intel';
import {
  MISTAKE_WINDOW_MS,
  recentRecordFor,
  SESSION_WINDOW_MS,
  type Purchase,
} from '@/lib/purchase-log';
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

/**
 * What was bought, beyond the name — recorded on the purchase log so Insights
 * can show trends across weeks. All optional, because pricing an item is
 * optional in this app and most never are.
 */
export interface PurchaseDetail {
  priceCents?: number | null;
  store?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

interface PantryIntelContext {
  stats: StatMap;
  /**
   * An item was checked off. Always updates the burn rate; additionally appends
   * to the purchase log when a price is attached, since an unpriced purchase has
   * nothing to say about spending.
   */
  logPurchase: (name: string, category: ItemCategory, detail?: PurchaseDetail) => void;
  /** Every logged purchase, newest first — priced or not. */
  purchases: Purchase[];
  /**
   * An item was UNchecked. Removes the transaction only if it is younger than
   * MISTAKE_WINDOW_MS, on the reasoning that unticking seconds after ticking is
   * a mistap, while unticking hours later is "we need this again" — a new
   * shopping cycle, which must leave the earlier purchase standing.
   */
  unlogRecent: (name: string) => void;
  /** Swipe left: user confirms it's running low (caller adds it to a list). */
  markAlmostOut: (key: string) => void;
  /** Swipe right: user says it's still good; the model learns to wait longer. */
  markStillGood: (key: string) => void;
  /**
   * Mark a staple and/or pin its restock cadence. Pass `cadenceDays: null` to
   * hand the interval back to the learning engine.
   */
  setStaple: (key: string, patch: { keepStocked?: boolean; cadenceDays?: number | null }) => void;
  /**
   * Retire an item from prediction, or bring it back. Resting keeps the item's
   * whole history; it just stops being asked about. Bringing it back restarts
   * its countdown (see applyResting).
   */
  setResting: (key: string, resting: boolean) => void;
  /** Dev-only: inject back-dated stats so the deck is populated for testing. */
  seedDemo: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How far back the purchase log is kept and read.
 *
 * Bounded on purpose at both backends: the cloud query asks only for this
 * window (so a household shopping for years doesn't grow the response without
 * limit), and the local mirror trims to it on write. Insights never looks
 * further back than a couple of months, so anything older is weight without
 * readers.
 */
// A year. Sixteen weeks could not answer "what did Christmas cost last year?"
// or show a seasonal swing, which is most of why anyone opens a spend history.
// These are short text rows — a year of them is kilobytes per household.
const PURCHASE_WINDOW_WEEKS = 52;
const PURCHASE_WINDOW_MS = PURCHASE_WINDOW_WEEKS * 7 * DAY;

/**
 * Belt-and-braces cap on the local mirror. The time window normally keeps this
 * small, but a heavy user with a device clock that jumped could otherwise
 * accumulate rows indefinitely.
 */
// Raised with the window: a year of shopping comfortably exceeds a thousand
// check-offs now that EVERY one is logged, not just the priced minority, and a
// cap below the window would silently truncate the history the window promises.
const LOCAL_PURCHASE_CAP = 4000;

/**
 * Build a log entry, or null when there is nothing identifiable to log.
 *
 * The id is generated here rather than left to the database, for the same
 * reason list items generate theirs: an optimistic row has to carry the
 * identity the server row will have, or the client cannot address what it just
 * wrote. Addressing a specific transaction is the whole point — a record gets
 * corrected inside the session window, or removed when a check-off turns out
 * to have been a mistap.
 */
function toPurchase(
  name: string,
  detail: PurchaseDetail | undefined,
  now: number,
): Purchase | null {
  const raw = detail?.priceCents;
  // A price is optional; a nonsense one is dropped rather than stored, since a
  // negative or non-finite value would poison every average it lands in. The
  // purchase itself is logged either way — migration 0020 made price_cents
  // nullable precisely so an unpriced check-off is still a transaction.
  const priceCents =
    raw == null || !Number.isFinite(raw) || raw < 0 ? null : Math.round(raw);
  const display = name.trim();
  const key = normalizeKey(display);
  if (!key) return null;
  return {
    id: uuidv4(),
    key,
    name: display,
    store: detail?.store ?? null,
    priceCents,
    at: now,
    quantity: detail?.quantity ?? null,
    unit: detail?.unit ?? null,
  };
}

/**
 * Fold a new purchase into the log, replacing the item's open record when there
 * is one.
 *
 * This is the "don't double-count a mid-aisle correction" rule: untick, change
 * the quantity, retick, and you get one transaction updated rather than two
 * appended. Outside the session window it appends, because that is a genuinely
 * separate purchase.
 *
 * Shared by both backends deliberately — a local and a cloud copy of this would
 * drift, and the drift would only show as one household's spend being subtly
 * higher than another's.
 */
function foldPurchase(existing: Purchase[], entry: Purchase): Purchase[] {
  const open = recentRecordFor(existing, entry.key, entry.at, SESSION_WINDOW_MS);
  if (!open) return [entry, ...existing];
  // Keep the ORIGINAL id and timestamp: this is the same transaction being
  // corrected, not a new one. Moving the timestamp forward would let a long
  // shop keep extending its own window indefinitely.
  const merged: Purchase = { ...entry, id: open.id, at: open.at };
  return existing.map((p) => (p.id === open.id ? merged : p));
}

/** Newest first, inside the window, capped. */
function trimPurchases(all: Purchase[], now: number): Purchase[] {
  const cutoff = now - PURCHASE_WINDOW_MS;
  return all
    .filter((p) => p.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, LOCAL_PURCHASE_CAP);
}

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

/** Normalized keys of the dev sample items (for repeatable previews). */
export const DEMO_KEYS = DEMO.map(([name]) => normalizeKey(name));

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
/** The on-device purchase log, mirroring the cloud price_entries table. */
const LOCAL_PURCHASES_KEY = 'korb.purchaseLog.v1';

/** Marks the local backfill spent, so it can never run twice. */
const LOCAL_BACKFILL_KEY = 'korb.purchaseLog.backfilled.v1';

/**
 * The logged-out equivalent of migration 0020's backfill.
 *
 * The SQL migration only reaches households on the server. Someone who has
 * never signed in has all their history in AsyncStorage, and without this their
 * Insights would drop to near zero on upgrade — which reads as data loss, not
 * as a new feature.
 *
 * Same shape as the SQL: one transaction per pantry item at its REAL
 * last-purchased date, not today, so the spend chart shows a distributed year
 * rather than one impossible spike in the current week. No price or store,
 * because a local pantry stat carries neither.
 */
function backfillLocal(stats: StatMap, existing: Purchase[], now: number): Purchase[] {
  const cutoff = now - PURCHASE_WINDOW_MS;
  const seen = new Set(existing.map((p) => `${p.key}|${Math.floor(p.at / (24 * 60 * 60 * 1000))}`));
  const added: Purchase[] = [];
  for (const stat of Object.values(stats)) {
    if (!stat.lastPurchasedAt || stat.lastPurchasedAt < cutoff) continue;
    // Same day-granularity dedupe as the SQL, so a user who already has genuine
    // entries doesn't get them doubled.
    const slot = `${stat.key}|${Math.floor(stat.lastPurchasedAt / (24 * 60 * 60 * 1000))}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    added.push({
      id: uuidv4(),
      key: stat.key,
      name: stat.display,
      store: null,
      priceCents: null,
      at: stat.lastPurchasedAt,
      quantity: null,
      unit: null,
    });
  }
  return added.length > 0 ? trimPurchases([...added, ...existing], now) : existing;
}

function LocalPantryIntelProvider({ children }: PropsWithChildren) {
  const [stats, setStats] = useState<StatMap>({});
  const [purchases, setPurchases] = useState<Purchase[]>([]);
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

    // Load the log and the stats together: the one-time backfill needs both,
    // and running it against a half-loaded pair would write a partial history
    // and then mark itself done.
    Promise.all([
      AsyncStorage.getItem(LOCAL_PURCHASES_KEY),
      AsyncStorage.getItem(LOCAL_KEY),
      AsyncStorage.getItem(LOCAL_BACKFILL_KEY),
    ])
      .then(([rawLog, rawStats, backfilled]) => {
        const now = Date.now();
        // Trim on read as well as write: entries age out of the window while
        // the app is closed, so a log untouched for months would otherwise come
        // back oversized and stale.
        const parsed = rawLog ? JSON.parse(rawLog) : [];
        let log: Purchase[] = Array.isArray(parsed) ? trimPurchases(parsed as Purchase[], now) : [];

        if (backfilled !== '1') {
          const savedStats = rawStats ? (JSON.parse(rawStats) as StatMap) : {};
          log = backfillLocal(savedStats && typeof savedStats === 'object' ? savedStats : {}, log, now);
          // Persist both the result and the flag. Marking it done even when
          // nothing was added is deliberate: a user with no pantry history has
          // nothing to backfill, and re-checking on every launch forever would
          // be work with a known answer.
          AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(log)).catch(() => {});
          AsyncStorage.setItem(LOCAL_BACKFILL_KEY, '1').catch(() => {});
        }
        setPurchases(log);
      })
      .catch(() => {
        // A corrupt log costs history, not function — start empty.
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
      purchases,
      logPurchase: (name, category, detail) => {
        setStats((prev) => recordPurchase(prev, name, category));
        const entry = toPurchase(name, detail, Date.now());
        if (!entry) return;
        setPurchases((prev) => {
          const next = trimPurchases(foldPurchase(prev, entry), entry.at);
          // Written straight through rather than on the debounced stats timer:
          // this is history, and losing an entry to a kill mid-timer means a
          // purchase that silently never happened.
          AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      },
      unlogRecent: (name) => {
        const key = normalizeKey(name);
        setPurchases((prev) => {
          const doomed = recentRecordFor(prev, key, Date.now(), MISTAKE_WINDOW_MS);
          if (!doomed) return prev;
          const next = prev.filter((p) => p.id !== doomed.id);
          AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      },
      markAlmostOut: (key) => setStats((prev) => applyAlmostOut(prev, key)),
      markStillGood: (key) => setStats((prev) => applyStillGood(prev, key)),
      setStaple: (key, patch) => setStats((prev) => applyStaple(prev, key, patch)),
      setResting: (key, resting) => setStats((prev) => applyResting(prev, key, resting)),
      seedDemo: () => setStats((prev) => seededDemoStats(prev)),
    }),
    [stats, purchases],
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
  keep_stocked: boolean | null;
  cadence_days: number | null;
  archived_at: string | null;
}

const mapRow = (r: DbPantryRow): ItemStat => ({
  key: r.item_key ?? normalizeKey(r.name),
  display: r.display_name ?? r.name,
  category: r.category,
  lastPurchasedAt: r.last_purchased_at ? Date.parse(r.last_purchased_at) : 0,
  intervalDays: r.avg_purchase_interval_days ?? 0,
  sampleCount: r.sample_count ?? 0,
  snoozeUntil: r.snooze_until ? Date.parse(r.snooze_until) : null,
  keepStocked: r.keep_stocked ?? false,
  cadenceDays: r.cadence_days ?? null,
  archivedAt: r.archived_at ? Date.parse(r.archived_at) : null,
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
  keep_stocked: s.keepStocked ?? false,
  cadence_days: s.cadenceDays ?? null,
  archived_at: s.archivedAt ? new Date(s.archivedAt).toISOString() : null,
});

interface DbPriceRow {
  id: string;
  item_key: string | null;
  item_name: string;
  store: string | null;
  price_cents: number | null;
  quantity: number | null;
  unit: string | null;
  recorded_at: string;
}

const mapPriceRow = (r: DbPriceRow): Purchase => ({
  id: r.id,
  key: r.item_key ?? normalizeKey(r.item_name),
  name: r.item_name,
  store: r.store,
  priceCents: r.price_cents,
  at: Date.parse(r.recorded_at),
  quantity: r.quantity == null ? null : Number(r.quantity),
  unit: r.unit,
});

function CloudPantryIntelProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  const appActive = useAppActive();
  const [stats, setStats] = useState<StatMap>({});
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const statsRef = useRef<StatMap>({});
  statsRef.current = stats;
  // Read inside logPurchase so two check-offs in the same tick both land —
  // reading the `purchases` closure would let the second overwrite the first.
  const purchasesRef = useRef<Purchase[]>([]);
  purchasesRef.current = purchases;
  const cacheKey = `korb.pantryIntel.cloud.${householdId}`;
  const purchaseCacheKey = `korb.purchaseLog.cloud.${householdId}`;
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
        'item_key, name, display_name, category, last_purchased_at, avg_purchase_interval_days, sample_count, snooze_until, keep_stocked, cadence_days, archived_at',
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

  const applyPurchases = useCallback(
    (list: Purchase[]) => {
      setPurchases(list);
      AsyncStorage.setItem(purchaseCacheKey, JSON.stringify(list)).catch(() => {});
    },
    [purchaseCacheKey],
  );

  /**
   * The household's recent priced purchases. Windowed in the query rather than
   * client-side, so the response stays bounded however long the household has
   * been shopping.
   */
  const fetchPurchases = useCallback(async () => {
    const since = new Date(Date.now() - PURCHASE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('price_entries')
      .select('id, item_key, item_name, store, price_cents, quantity, unit, recorded_at')
      .eq('household_id', householdId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(LOCAL_PURCHASE_CAP);
    if (!error && data) applyPurchases((data as DbPriceRow[]).map(mapPriceRow));
  }, [householdId, applyPurchases]);

  /**
   * Something changed in the household — pull both halves.
   *
   * This used to refresh only the stats, which is why two phones in one
   * household showed different Insights: the money log was fetched on open and
   * on foreground and never again, so each device saw its own optimistic writes
   * plus whatever it happened to fetch at launch. The list-derived cards agreed
   * (list_items is on realtime) while the log-derived one diverged, and once
   * Insights reads the log for *everything* that divergence would cover the
   * whole tab.
   *
   * Costs nothing extra: every check-off already upserts pantry_items, which IS
   * published to realtime, so the socket message we are reacting to is one the
   * other device was already sending. price_entries stays unpublished — see
   * migration 0013 — because it does not need its own channel to stay fresh.
   */
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      void fetchStats();
      void fetchPurchases();
    }, 300);
  }, [fetchStats, fetchPurchases]);

  // While backgrounded we drop the socket; on return we refetch to catch up and
  // re-open it (see useAppActive).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (alive && raw) setStats(JSON.parse(raw) as StatMap);
      })
      .catch(() => {});
    AsyncStorage.getItem(purchaseCacheKey)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setPurchases(trimPurchases(parsed as Purchase[], Date.now()));
      })
      .catch(() => {});
    if (!appActive) return () => { alive = false; };

    void fetchStats();
    // Not on the realtime path (price_entries is deliberately unpublished — see
    // migration 0013), so this is refreshed on open and on returning to the
    // foreground. A member's purchase landing mid-session changes no decision
    // currently on screen.
    void fetchPurchases();

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
  }, [householdId, cacheKey, purchaseCacheKey, fetchStats, fetchPurchases, scheduleRefetch, appActive]);

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
      purchases,
      logPurchase: (name, category, detail) => {
        const next = recordPurchase(statsRef.current, name, category);
        apply(next);
        upsert([normalizeKey(name)], next);

        const entry = toPurchase(name, detail, Date.now());
        if (!entry) return;
        // Is this a correction to a transaction still inside its session
        // window, or a genuinely new purchase? The answer decides insert vs
        // update, and it is taken from the same helper the local backend uses
        // so the two cannot disagree.
        const open = recentRecordFor(purchasesRef.current, entry.key, entry.at, SESSION_WINDOW_MS);
        // Optimistic either way, so Insights reflects the shop immediately.
        applyPurchases(trimPurchases(foldPurchase(purchasesRef.current, entry), entry.at));

        const row = {
          household_id: householdId,
          item_key: entry.key,
          item_name: entry.name,
          store: entry.store,
          price_cents: entry.priceCents,
          quantity: entry.quantity,
          unit: entry.unit,
        };
        const write = open
          // Correcting: keep the original row and its recorded_at, so a long
          // shop cannot keep pushing its own window forward.
          ? supabase.from('price_entries').update(row).eq('id', open.id)
          : supabase
              .from('price_entries')
              .insert({ ...row, id: entry.id, recorded_at: new Date(entry.at).toISOString() });

        write.then(({ error }) => {
          // Re-sync on failure so the optimistic row doesn't linger as a
          // purchase that only this device believes in.
          if (error) void fetchPurchases();
        });
      },
      unlogRecent: (name) => {
        const key = normalizeKey(name);
        const doomed = recentRecordFor(purchasesRef.current, key, Date.now(), MISTAKE_WINDOW_MS);
        if (!doomed) return;
        applyPurchases(purchasesRef.current.filter((p) => p.id !== doomed.id));
        supabase
          .from('price_entries')
          .delete()
          .eq('id', doomed.id)
          .then(({ error }) => {
            if (error) void fetchPurchases();
          });
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
      setStaple: (key, patch) => {
        const next = applyStaple(statsRef.current, key, patch);
        apply(next);
        upsert([key], next);
      },
      setResting: (key, resting) => {
        const next = applyResting(statsRef.current, key, resting);
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
  }, [stats, purchases, householdId, apply, applyPurchases, fetchPurchases, scheduleRefetch]);

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
    // Only items still waiting to be bought suppress a card. A ticked item is
    // one you already bought — it stays on the list as a checked row, and
    // treating that as "queued" would hide it from the deck forever.
    const excludeKeys = new Set<string>();
    for (const list of lists) {
      for (const item of list.items) {
        if (!item.checked) excludeKeys.add(normalizeKey(item.name));
      }
    }
    const deck = buildDeck(stats, excludeKeys, Date.now());
    return { deck, count: deck.length };
  }, [stats, lists]);
}

export type { DeckCard, ItemStat };
