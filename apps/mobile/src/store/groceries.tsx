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

import type { ItemCategory, ParsedItem } from '@korb/shared';

import { categorizeSync, isKnown, learnCategory, resolveCategoryAsync } from '@/lib/categorize';
import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { uuidv4 } from '@/lib/uuid';
import { useAuth } from '@/store/auth';
import { useHousehold } from '@/store/household';

/**
 * Grocery lists store with two interchangeable backends behind one identical
 * API (useGroceries / useList / useItem):
 *
 *  - Logged out (or signed in without a household): LOCAL — AsyncStorage,
 *    exactly as before. Works fully offline.
 *  - Signed in with a household: CLOUD — Supabase, scoped to the household,
 *    with optimistic UI, realtime "something changed → refetch", and a local
 *    cache for instant startup.
 *
 * Client-generated UUIDs mean an optimistic insert already carries the id the
 * server row will have, so no id reconciliation is needed. Pantry lives in its
 * own always-local provider (see store/pantry).
 */

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: number | null;
  unit: string | null;
  /** null = user chose not to log a price (pricing is always optional). */
  priceCents: number | null;
  /** Supermarket id (see lib/supermarkets) or a custom store name; optional. */
  store: string | null;
  checked: boolean;
}

export type ItemPatch = Partial<
  Pick<Item, 'name' | 'category' | 'quantity' | 'unit' | 'priceCents' | 'store'>
>;

export interface List {
  id: string;
  name: string;
  store: string | null;
  items: Item[];
}

interface GroceriesContext {
  lists: List[];
  addList: (name: string) => string;
  deleteList: (listId: string) => void;
  reorderLists: (orderedIds: string[]) => void;
  addItem: (listId: string, name: string) => string;
  /** Add an already-structured item (from AI quick-add) without re-categorizing. */
  addParsedItem: (listId: string, item: ParsedItem) => void;
  toggleItem: (listId: string, itemId: string) => void;
  updateItem: (listId: string, itemId: string, patch: ItemPatch) => void;
  deleteItem: (listId: string, itemId: string) => void;
}

const Ctx = createContext<GroceriesContext | null>(null);

const newItem = (name: string, category: ItemCategory, opts: Partial<Item> = {}): Item => ({
  id: uuidv4(),
  name,
  category,
  quantity: null,
  unit: null,
  priceCents: null,
  store: null,
  checked: false,
  ...opts,
});

// ---------------------------------------------------------------------------
// Provider selector: pick LOCAL or CLOUD by auth + household state.
// ---------------------------------------------------------------------------

export function GroceriesProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { household } = useHousehold();

  if (user && household) {
    return (
      <CloudGroceriesProvider householdId={household.id} key={household.id}>
        {children}
      </CloudGroceriesProvider>
    );
  }
  return <LocalGroceriesProvider>{children}</LocalGroceriesProvider>;
}

// ---------------------------------------------------------------------------
// LOCAL backend (offline, AsyncStorage) — the logged-out experience.
// ---------------------------------------------------------------------------

// v2: start empty. New users (and anyone upgrading past the demo seeds) begin
// with no lists instead of prepopulated sample data.
const LOCAL_KEY = 'korb.lists.v2';

function LocalGroceriesProvider({ children }: PropsWithChildren) {
  const [lists, setLists] = useState<List[]>([]);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LOCAL_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as List[];
          if (Array.isArray(parsed)) setLists(parsed);
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
      AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(lists)).catch(() => {});
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [lists]);

  const patchItem = useCallback((listId: string, itemId: string, patch: ItemPatch) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : l,
      ),
    );
  }, []);

  const value = useMemo<GroceriesContext>(
    () => ({
      lists,
      addList: (name) => {
        const id = uuidv4();
        setLists((prev) => [...prev, { id, name, store: null, items: [] }]);
        return id;
      },
      deleteList: (listId) => setLists((prev) => prev.filter((l) => l.id !== listId)),
      reorderLists: (orderedIds) => {
        setLists((prev) => {
          const rank = new Map(orderedIds.map((id, i) => [id, i]));
          return [...prev].sort(
            (a, b) => (rank.get(a.id) ?? prev.length) - (rank.get(b.id) ?? prev.length),
          );
        });
      },
      addItem: (listId, name) => {
        const clean = name.trim();
        const id = uuidv4();
        if (!clean) return id;
        const category = categorizeSync(clean);
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId ? { ...l, items: [...l.items, { ...newItem(clean, category), id }] } : l,
          ),
        );
        if (category === 'other' && !isKnown(clean)) {
          resolveCategoryAsync(clean).then((res) => {
            if (!res || res.category === 'other') return;
            patchItem(listId, id, { category: res.category });
            void learnCategory(clean, res.category);
          });
        }
        return id;
      },
      addParsedItem: (listId, p) => {
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: [
                    ...l.items,
                    newItem(p.name, p.category, { quantity: p.quantity, unit: p.unit }),
                  ],
                }
              : l,
          ),
        );
      },
      toggleItem: (listId, itemId) =>
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it)) }
              : l,
          ),
        ),
      updateItem: (listId, itemId, patch) => {
        patchItem(listId, itemId, patch);
        if (patch.category) {
          const target = lists.find((l) => l.id === listId)?.items.find((it) => it.id === itemId);
          if (target) void learnCategory(target.name, patch.category);
        }
      },
      deleteItem: (listId, itemId) =>
        setLists((prev) =>
          prev.map((l) => (l.id === listId ? { ...l, items: l.items.filter((it) => it.id !== itemId) } : l)),
        ),
    }),
    [lists, patchItem],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// CLOUD backend (Supabase, household-scoped) — optimistic + realtime refetch.
// ---------------------------------------------------------------------------

interface DbItem {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: number | null;
  unit: string | null;
  price_cents: number | null;
  store: string | null;
  checked: boolean;
  created_at: string;
}
interface DbList {
  id: string;
  name: string;
  store: string | null;
  position: number;
  list_items: DbItem[] | null;
}

const mapItem = (r: DbItem): Item => ({
  id: r.id,
  name: r.name,
  category: r.category,
  quantity: r.quantity,
  unit: r.unit,
  priceCents: r.price_cents,
  store: r.store,
  checked: r.checked,
});

const mapList = (r: DbList): List => ({
  id: r.id,
  name: r.name,
  store: r.store,
  items: [...(r.list_items ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(mapItem),
});

function CloudGroceriesProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  const { user } = useAuth();
  const appActive = useAppActive();
  const [lists, setLists] = useState<List[]>([]);
  const cacheKey = `korb.lists.cloud.${householdId}`;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyServer = useCallback(
    (rows: DbList[]) => {
      const mapped = rows.map(mapList);
      setLists(mapped);
      AsyncStorage.setItem(cacheKey, JSON.stringify(mapped)).catch(() => {});
    },
    [cacheKey],
  );

  const fetchLists = useCallback(async () => {
    const { data, error } = await supabase
      .from('shopping_lists')
      .select(
        'id, name, store, position, list_items(id, name, category, quantity, unit, price_cents, store, checked, created_at)',
      )
      .eq('household_id', householdId)
      .eq('archived', false)
      .order('position');
    if (!error && data) applyServer(data as unknown as DbList[]);
  }, [householdId, applyServer]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void fetchLists(), 300);
  }, [fetchLists]);

  // Initial load (cache first for instant paint), then live subscription.
  // While backgrounded we drop the socket; on return we refetch to catch up and
  // re-open it (see useAppActive).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (alive && raw) setLists(JSON.parse(raw) as List[]);
      })
      .catch(() => {});
    if (!appActive) return () => { alive = false; };

    void fetchLists();

    const channel = supabase
      .channel(`lists-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_lists' }, scheduleRefetch)
      .subscribe();

    return () => {
      alive = false;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, cacheKey, fetchLists, scheduleRefetch, appActive]);

  const patchLocalItem = useCallback((listId: string, itemId: string, patch: ItemPatch) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : l,
      ),
    );
  }, []);

  const value = useMemo<GroceriesContext>(() => {
    const dbPatch = (patch: ItemPatch): Record<string, unknown> => {
      const db: Record<string, unknown> = {};
      if (patch.name !== undefined) db.name = patch.name;
      if (patch.category !== undefined) db.category = patch.category;
      if (patch.quantity !== undefined) db.quantity = patch.quantity;
      if (patch.unit !== undefined) db.unit = patch.unit;
      if (patch.priceCents !== undefined) db.price_cents = patch.priceCents;
      if (patch.store !== undefined) db.store = patch.store;
      return db;
    };

    return {
      lists,
      addList: (name) => {
        const id = uuidv4();
        setLists((prev) => [...prev, { id, name, store: null, items: [] }]);
        supabase
          .from('shopping_lists')
          .insert({ id, household_id: householdId, name, position: lists.length })
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
        return id;
      },
      deleteList: (listId) => {
        setLists((prev) => prev.filter((l) => l.id !== listId));
        supabase
          .from('shopping_lists')
          .delete()
          .eq('id', listId)
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
      },
      reorderLists: (orderedIds) => {
        setLists((prev) => {
          const rank = new Map(orderedIds.map((id, i) => [id, i]));
          return [...prev].sort(
            (a, b) => (rank.get(a.id) ?? prev.length) - (rank.get(b.id) ?? prev.length),
          );
        });
        orderedIds.forEach((id, i) => {
          void supabase.from('shopping_lists').update({ position: i }).eq('id', id);
        });
      },
      addItem: (listId, name) => {
        const clean = name.trim();
        const id = uuidv4();
        if (!clean) return id;
        const category = categorizeSync(clean);
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId ? { ...l, items: [...l.items, { ...newItem(clean, category), id }] } : l,
          ),
        );
        supabase
          .from('list_items')
          .insert({ id, list_id: listId, name: clean, category, added_by: user?.id ?? null })
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
        if (category === 'other' && !isKnown(clean)) {
          resolveCategoryAsync(clean).then((res) => {
            if (!res || res.category === 'other') return;
            patchLocalItem(listId, id, { category: res.category });
            void supabase.from('list_items').update({ category: res.category }).eq('id', id);
            void learnCategory(clean, res.category);
          });
        }
        return id;
      },
      addParsedItem: (listId, p) => {
        const id = uuidv4();
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: [
                    ...l.items,
                    { ...newItem(p.name, p.category, { quantity: p.quantity, unit: p.unit }), id },
                  ],
                }
              : l,
          ),
        );
        supabase
          .from('list_items')
          .insert({
            id,
            list_id: listId,
            name: p.name,
            category: p.category,
            quantity: p.quantity,
            unit: p.unit,
            added_by: user?.id ?? null,
          })
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
      },
      toggleItem: (listId, itemId) => {
        const current = lists
          .find((l) => l.id === listId)
          ?.items.find((it) => it.id === itemId);
        const next = !(current?.checked ?? false);
        patchLocalItem(listId, itemId, { checked: next } as ItemPatch);
        supabase
          .from('list_items')
          .update({ checked: next })
          .eq('id', itemId)
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
      },
      updateItem: (listId, itemId, patch) => {
        patchLocalItem(listId, itemId, patch);
        supabase
          .from('list_items')
          .update(dbPatch(patch))
          .eq('id', itemId)
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
        if (patch.category) {
          const target = lists.find((l) => l.id === listId)?.items.find((it) => it.id === itemId);
          if (target) void learnCategory(target.name, patch.category);
        }
      },
      deleteItem: (listId, itemId) => {
        setLists((prev) =>
          prev.map((l) => (l.id === listId ? { ...l, items: l.items.filter((it) => it.id !== itemId) } : l)),
        );
        supabase
          .from('list_items')
          .delete()
          .eq('id', itemId)
          .then(({ error }) => {
            if (error) scheduleRefetch();
          });
      },
    };
  }, [lists, householdId, user, patchLocalItem, scheduleRefetch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useGroceries(): GroceriesContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGroceries must be used within GroceriesProvider');
  return ctx;
}

export function useList(listId: string | undefined): List | undefined {
  const { lists } = useGroceries();
  return lists.find((l) => l.id === listId);
}

export function useItem(listId: string | undefined, itemId: string | undefined): Item | undefined {
  const list = useList(listId);
  return list?.items.find((it) => it.id === itemId);
}
