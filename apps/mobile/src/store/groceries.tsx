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
import { unitFor } from '@/lib/item-unit';
import { forgetHomeList, rememberItemList } from '@/lib/item-home-list';
import { recallItemDetails } from '@/lib/item-memory';
import { reportWriteFailure } from '@/lib/monitoring';
import { normalizeKey } from '@/lib/pantry-intel';
import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { uuidv4 } from '@/lib/uuid';
import { liveLists, settledIds } from '@/lib/list-sweep';
import { useLocalDay } from '@/lib/use-local-day';
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
  /**
   * When it was ticked, or null when it is not. Drives the sweep that lets a
   * finished shop leave the list — see lib/list-sweep.ts, which owns the rule.
   * Always written in the same breath as `checked`; the two disagreeing is the
   * one state that must never exist.
   */
  checkedAt: number | null;
  /**
   * The member who said "I'm getting this" — a hint to stop two people buying
   * the same thing, not a lock. Null on local lists, which have no one to
   * coordinate with.
   */
  claimedBy: string | null;
  /**
   * "This one is organic, or from a local producer" — the shopper's own claim,
   * never inferred. Korb has no way to know whether the milk you picked up was
   * organic, so it does not pretend to: the flag is off until somebody says
   * otherwise, and it feeds the eco score's own separate line rather than
   * moving the item's impact band (see lib/eco.ts).
   */
  bio: boolean;
  claimedAt: number | null;
}

export type ItemPatch = Partial<
  Pick<Item, 'name' | 'category' | 'quantity' | 'unit' | 'priceCents' | 'store' | 'bio'>
>;

export interface List {
  id: string;
  name: string;
  store: string | null;
  items: Item[];
}

/**
 * What `addOrReviveItem` did:
 * - `added`   — it wasn't on the list, so a fresh row was created.
 * - `revived` — it was there but ticked off from a previous shop; un-ticked
 *               back to "to buy" rather than adding a confusing duplicate.
 * - `already` — it was already on the list unticked; nothing to do.
 */
export type AddOutcome = 'added' | 'revived' | 'already';

interface GroceriesContext {
  lists: List[];
  addList: (name: string) => string;
  deleteList: (listId: string) => void;
  reorderLists: (orderedIds: string[]) => void;
  addItem: (listId: string, name: string) => string;
  /** Add an already-structured item (from AI quick-add) without re-categorizing. */
  addParsedItem: (listId: string, item: ParsedItem) => void;
  /**
   * Put an item on a list, accounting for one already being there.
   *
   * Checking an item off never removes it, so a bought item lingers as a ticked
   * row — and that ticked row is exactly what a plain "is it already here?"
   * guard used to match, silently skipping the add and leaving the user staring
   * at last week's ticked item. This branches on the row's state instead.
   */
  addOrReviveItem: (listId: string, item: ParsedItem) => AddOutcome;
  toggleItem: (listId: string, itemId: string) => void;
  updateItem: (listId: string, itemId: string, patch: ItemPatch) => void;
  deleteItem: (listId: string, itemId: string) => void;
  /**
   * Claim an item ("I'm getting this") or release it. A no-op on local lists.
   * Any member can release any claim — see migration 0015 for why.
   */
  setClaim: (listId: string, itemId: string, claimed: boolean) => void;
  /**
   * Other members with the app open right now, from realtime presence. Empty
   * when solo, offline, or on local lists — callers must degrade to showing
   * nothing rather than a "nobody here" state.
   */
  shoppersOnline: string[];
  /**
   * Whether the on-device read that seeds `lists` has finished.
   *
   * LOCAL only — it says the cache has been read, never that the server has
   * answered. components/boot-gate waits on it, and that distinction is the
   * point: a flag that settles over the network can fail to settle at all.
   */
  hydrated: boolean;
}

const Ctx = createContext<GroceriesContext | null>(null);

/**
 * Stable empty array for the no-presence case. A fresh `[]` each render would
 * change identity every time and defeat memoization in every consumer.
 */
const EMPTY_SHOPPERS: string[] = [];

/**
 * The unit an item starts life with.
 *
 * Strict precedence, most-specific first:
 *
 *   1. `explicit` — what this add actually said. "2L milk" through quick-add
 *      means litres regardless of what any table thinks.
 *   2. `usual` — what YOU chose last time you bought it (item-memory.ts). If
 *      you buy milk by the bottle, no suggestion gets to overrule that.
 *   3. `unitFor` — the curated table, the shared lexicon, then the category.
 *      Returns null rather than guessing when none of them is confident, and
 *      null is the right answer there: an empty picker asks a question, a
 *      wrong prefill makes a claim the user has to notice and undo.
 *
 * Note `??` throughout, not `||` — 'pcs' is truthy but 0 and '' are not the
 * concern here; what matters is that a deliberate null from a higher tier is
 * not a value, so it falls through, while a real unit from any tier stops the
 * search.
 */
const seedUnit = (
  name: string,
  category: ItemCategory,
  explicit: string | null | undefined,
  usual: string | null | undefined,
): string | null => explicit ?? usual ?? unitFor(name, category);

const newItem = (name: string, category: ItemCategory, opts: Partial<Item> = {}): Item => ({
  id: uuidv4(),
  name,
  category,
  quantity: null,
  unit: null,
  priceCents: null,
  store: null,
  checked: false,
  checkedAt: null,
  // Local lists have nobody to coordinate with, so nothing is ever claimed.
  claimedBy: null,
  claimedAt: null,
  bio: false,
  ...opts,
});

// ---------------------------------------------------------------------------
// Provider selector: pick LOCAL or CLOUD by auth + household state.
// ---------------------------------------------------------------------------

export function GroceriesProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { household, activeId } = useHousehold();

  /*
   * The remembered id first, the fetched household only as a fallback.
   *
   * This used to read `household.id`, which is derived from a network fetch —
   * so every launch for a signed-in user mounted the WHOLE APP under the local
   * backend, then threw it away and mounted it again under the cloud one when
   * the fetch landed. Swapping the component type at this position unmounts
   * everything below: the navigator, every screen, every animation in flight.
   * That full remount, half a second into launch, is a large part of what read
   * as the app being "confused about what to do next".
   *
   * `activeId` is the same id read straight off the device, so on a returning
   * user the cloud backend is chosen on the first render and there is no swap
   * at all. It can be stale — the household was left, deleted, or this is a
   * different user — in which case `household` resolves to something else and
   * the key changes, costing exactly the one remount we used to pay every time.
   *
   * The cloud provider seeds itself from its own AsyncStorage cache keyed by
   * this id, so choosing it early also means real lists on the first paint
   * rather than an empty screen waiting on the network.
   */
  const householdId = activeId ?? household?.id ?? null;

  if (user && householdId) {
    return (
      <CloudGroceriesProvider householdId={householdId} key={householdId}>
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
  // Same fact as the ref, in state: the ref gates the debounced save (read
  // inside effects), this re-renders the boot gate that is waiting on it.
  const [hydratedState, setHydratedState] = useState(false);
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
        setHydratedState(true);
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

  /**
   * Set the unit only if the item still hasn't got one.
   *
   * Written as a state updater rather than a read-then-patch because the check
   * and the write have to be atomic against the user: this lands seconds after
   * the add, while the item sheet is open, and reading `lists` from the closure
   * would test a snapshot taken before they touched the picker — overwriting a
   * choice they just made.
   */
  const fillUnitIfEmpty = useCallback((listId: string, itemId: string, unit: string | null) => {
    if (!unit) return;
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                it.id === itemId && it.unit == null ? { ...it, unit } : it,
              ),
            }
          : l,
      ),
    );
  }, []);

  const setChecked = useCallback((listId: string, itemId: string, checked: boolean) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                it.id === itemId ? { ...it, checked, checkedAt: checked ? Date.now() : null } : it,
              ),
            }
          : l,
      ),
    );
  }, []);

  /**
   * The AI upgrade a plain `categorizeSync` couldn't give at add time.
   *
   * Split out of `addItem` so `insertParsed` — quick-add, pantry re-adds, and
   * now the recipe importer — can call it too. It used to be `addItem`'s
   * alone: a hand-typed "leek" got the AI's answer and taught the shared
   * lexicon what a leek looks like; an imported "Poireaux" landed in "Other"
   * forever and taught it nothing, because the exact same three lines had
   * only ever been written once.
   */
  const resolveIfUnknown = useCallback(
    (listId: string, itemId: string, name: string, category: ItemCategory) => {
      if (category !== 'other' || isKnown(name)) return;
      resolveCategoryAsync(name).then((res) => {
        if (!res || res.category === 'other') return;
        patchItem(listId, itemId, { category: res.category });
        // The real category may bring a unit with it — either the model's own
        // answer or the category default now that we know the category. Only
        // if the row still has none: the AI takes seconds to come back, and by
        // then the user may have set one in the item sheet.
        fillUnitIfEmpty(listId, itemId, seedUnit(name, res.category, res.unit, null));
        void learnCategory(name, res.category);
      });
    },
    [patchItem, fillUnitIfEmpty],
  );

  /**
   * Insert a structured item. Shared by quick-add and the pantry/vibe adds so
   * they enrich and remember identically.
   */
  const insertParsed = useCallback(
    (listId: string, p: ParsedItem) => {
      // The AI sets quantity/unit from the sentence; fall back to remembered
      // usuals for anything it left blank, and always prefill the usual store
      // (which the AI never parses).
      const usual = recallItemDetails(p.name);
      const opts = {
        quantity: p.quantity ?? usual?.quantity ?? null,
        unit: seedUnit(p.name, p.category, p.unit, usual?.unit),
        store: usual?.store ?? null,
      };
      const id = uuidv4();
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? { ...l, items: [...l.items, { ...newItem(p.name, p.category, opts), id }] }
            : l,
        ),
      );
      rememberItemList(p.name, listId);
      resolveIfUnknown(listId, id, p.name, p.category);
    },
    [resolveIfUnknown],
  );

  /*
   * Yesterday's shop leaves the list.
   *
   * Applied here rather than in each screen because "the list" is read in
   * something like thirty places — the dashboard's counts, the eco strip, the
   * vibe deck's exclusions, the settings tally — and a rule enforced at the
   * call sites is a rule that holds until somebody adds a thirty-first. The
   * store hands out a list that is already correct.
   *
   * Local lists ARE the storage, so the same effect does the sweeping: dropping
   * the settled rows from state is the deletion. Cloud has to reach a server
   * for it, which is why that backend does the two separately.
   */
  const day = useLocalDay();
  useEffect(() => {
    setLists((prev) => liveLists(prev, day));
  }, [day]);
  const visibleLists = useMemo(() => liveLists(lists, day), [lists, day]);

  const value = useMemo<GroceriesContext>(
    () => ({
      lists: visibleLists,
      addList: (name) => {
        const id = uuidv4();
        setLists((prev) => [...prev, { id, name, store: null, items: [] }]);
        return id;
      },
      deleteList: (listId) => {
        setLists((prev) => prev.filter((l) => l.id !== listId));
        forgetHomeList(listId);
      },
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
        // Prefill the quantity/unit/store last used for this item (see #3),
        // falling back to the suggested unit when there's no history.
        const usual = recallItemDetails(clean);
        const unit = seedUnit(clean, category, null, usual?.unit);
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: [...l.items, { ...newItem(clean, category, usual ?? {}), id, unit }] }
              : l,
          ),
        );
        rememberItemList(clean, listId);
        resolveIfUnknown(listId, id, clean, category);
        return id;
      },
      addParsedItem: (listId, p) => insertParsed(listId, p),
      addOrReviveItem: (listId, p) => {
        const key = normalizeKey(p.name);
        /*
         * The SWEPT list, not the raw one. A settled row is one the sweep is
         * deleting or has already deleted, so reviving it would either update a
         * row that no longer exists — the item silently never arrives — or win
         * the race and then be deleted anyway. Treating it as absent inserts a
         * fresh row, which is what "add it back to the list" means once
         * yesterday's shop has left.
         */
        const existing = visibleLists
          .find((l) => l.id === listId)
          ?.items.find((it) => normalizeKey(it.name) === key);
        if (existing) {
          // Already waiting to be bought — adding again would just duplicate it.
          if (!existing.checked) {
            rememberItemList(p.name, listId);
            return 'already';
          }
          // Ticked off from a previous shop: bring that row back to "to buy".
          setChecked(listId, existing.id, false);
          rememberItemList(p.name, listId);
          return 'revived';
        }
        insertParsed(listId, p);
        return 'added';
      },
      toggleItem: (listId, itemId) =>
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((it) =>
                    it.id === itemId
                      ? { ...it, checked: !it.checked, checkedAt: it.checked ? null : Date.now() }
                      : it,
                  ),
                }
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
      // Claiming and presence are meaningless on a local list — there is nobody
      // else on it. No-ops rather than errors, so the UI can call them
      // unconditionally and simply render nothing.
      setClaim: () => {},
      shoppersOnline: EMPTY_SHOPPERS,
      hydrated: hydratedState,
    }),
    [lists, visibleLists, hydratedState, patchItem, setChecked, insertParsed, resolveIfUnknown],
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
  checked_at: string | null;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  bio: boolean | null;
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
  checkedAt: r.checked_at ? Date.parse(r.checked_at) : null,
  bio: r.bio ?? false,
  claimedBy: r.claimed_by,
  claimedAt: r.claimed_at ? Date.parse(r.claimed_at) : null,
});

const mapList = (r: DbList): List => ({
  id: r.id,
  name: r.name,
  store: r.store,
  items: [...(r.list_items ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(mapItem),
});

/** Marks this device's local lists as re-homed. Device-wide, like the log's. */
const LISTS_MIGRATED_KEY = 'korb.lists.migrated.v1';

/**
 * Carry a guest's lists into the household they just got.
 *
 * Korb works fully signed out, so someone can shop with it for months before
 * making an account — and until now those lists lived under a different storage
 * key from the cloud ones, with nothing bridging the two. Signing up switched
 * the backend and left every list behind. The purchase history was already
 * carried across (lib/purchase-migration.ts); the lists themselves were not,
 * which meant the one thing the user actually looks at every day was the one
 * thing that disappeared.
 *
 * Runs once per device, and only into a household that has no lists of its own.
 * That condition is the whole safety argument: a brand-new account's household
 * is empty, so this is a straight move; a household that already has lists is
 * one the user joined, and dumping a stranger's shopping into it would be worse
 * than losing it. Those users keep their local copy untouched and can move
 * anything across by hand.
 */
async function migrateLocalLists(householdId: string, userId: string | null): Promise<void> {
  try {
    const [done, raw] = await Promise.all([
      AsyncStorage.getItem(LISTS_MIGRATED_KEY),
      AsyncStorage.getItem(LOCAL_KEY),
    ]);
    if (done === '1') return;

    const parsed = raw ? JSON.parse(raw) : [];
    const local: List[] = Array.isArray(parsed) ? parsed : [];
    if (local.length === 0) {
      // Nothing to carry. Still mark it done so a user who never shopped
      // offline doesn't pay for this check on every launch forever.
      await AsyncStorage.setItem(LISTS_MIGRATED_KEY, '1');
      return;
    }

    const { data: existing, error: readError } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('household_id', householdId);
    if (readError || !existing) return;

    // Is anything here NOT ours?
    //
    // The naive check is "does the household already have lists" — and it is
    // wrong in a way that destroys data. Lists and items are two round trips,
    // so a network drop between them leaves the lists uploaded and the items
    // not. On the retry a count-based check sees rows, concludes "established
    // household, leave it alone", marks itself done, and strands every item
    // permanently: the user's lists reappear completely empty. That is the
    // exact outcome this whole migration exists to prevent.
    //
    // Comparing IDS instead tells the two cases apart. Ours are client
    // generated, so a household containing only ids we recognise is our own
    // interrupted run — resume it. One containing anything else is somebody
    // else's household, and dumping a stranger's shopping into it would be
    // worse than leaving ours behind.
    const mine = new Set(local.map((l) => l.id));
    const foreign = (existing as Array<{ id: string }>).some((r) => !mine.has(r.id));
    if (foreign) {
      await AsyncStorage.setItem(LISTS_MIGRATED_KEY, '1');
      return;
    }

    // Lists first: items carry a foreign key to them. ignoreDuplicates makes
    // each step a no-op when it already ran, so resuming costs nothing and
    // cannot overwrite anything the user has since edited on another device.
    const { error: listError } = await supabase.from('shopping_lists').upsert(
      local.map((l, i) => ({
        id: l.id,
        household_id: householdId,
        name: l.name,
        store: l.store ?? null,
        position: i,
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    );
    reportWriteFailure('shopping_lists.migrate', listError);
    if (listError) return;

    const items = local.flatMap((l) =>
      l.items.map((it, i) => ({
        id: it.id,
        list_id: l.id,
        name: it.name,
        category: it.category,
        quantity: it.quantity,
        unit: it.unit,
        price_cents: it.priceCents,
        bio: it.bio,
        store: it.store,
        checked: it.checked,
        checked_at: it.checkedAt ? new Date(it.checkedAt).toISOString() : null,
        position: i,
        added_by: userId,
      })),
    );
    if (items.length > 0) {
      const { error: itemError } = await supabase
        .from('list_items')
        .upsert(items, { onConflict: 'id', ignoreDuplicates: true });
      reportWriteFailure('list_items.migrate', itemError);
    if (itemError) return;
    }

    await AsyncStorage.setItem(LISTS_MIGRATED_KEY, '1');
    // The local copy is deliberately kept, exactly as the purchase log is: it
    // is the only copy if this went somewhere the user didn't intend, and
    // signing out returns them to it intact.
  } catch {
    // Corrupt local store, or offline. The flag stays unset; try again later.
  }
}

function CloudGroceriesProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  const { user } = useAuth();
  const appActive = useAppActive();
  const [lists, setLists] = useState<List[]>([]);
  // Set once the cache read below settles, however it settles. See the
  // `hydrated` note on GroceriesContext: local only, never the network.
  const [hydratedState, setHydratedState] = useState(false);
  /** Other members with the app open, from presence. Never persisted. */
  const [shoppers, setShoppers] = useState<string[]>(EMPTY_SHOPPERS);
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
        'id, name, store, position, list_items(id, name, category, quantity, unit, price_cents, store, checked, created_at, claimed_by, claimed_at, bio)',
      )
      .eq('household_id', householdId)
      .eq('archived', false)
      .order('position');
    if (!error && data) applyServer(data as unknown as DbList[]);
  }, [householdId, applyServer]);

  // One-time: bring a guest's lists into their first household. Runs after the
  // first fetch so it can see whether the household already has any.
  const migrateOnce = useRef(false);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void fetchLists(), 300);
  }, [fetchLists]);

  /**
   * Handle a failed write by re-syncing with the server.
   *
   * A unique-violation (23505) is not really a failure: it means another member
   * won a race to add the same item, and migration 0018 refused our duplicate.
   * The right answer is the row they created, so we resync at once rather than
   * on the debounce — the optimistic row we already painted is the phantom, and
   * it should disappear in the same beat the user sees, not a third of a second
   * later. Everything else keeps the debounce, which coalesces bursts.
   */
  const recoverFrom = useCallback(
    (op: string, error: { code?: string; message?: string } | null) => {
      if (!error) return;
      /*
       * Recover, then say so. The resync below puts the screen back to the
       * truth, which is right and is also the whole problem: the user watches
       * the thing they just added vanish and there is no other trace that it
       * ever failed. `op` is a literal at each call site so one Sentry issue
       * means one code path — see reportWriteFailure for what is and is not
       * sent with it.
       */
      reportWriteFailure(op, error);
      if (error.code === '23505') void fetchLists();
      else scheduleRefetch();
    },
    [fetchLists, scheduleRefetch],
  );

  // Initial load (cache first for instant paint), then live subscription.
  // While backgrounded we drop the socket; on return we refetch to catch up and
  // re-open it (see useAppActive).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (alive && raw) setLists(JSON.parse(raw) as List[]);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHydratedState(true);
      });
    if (!appActive) return () => { alive = false; };

    // Bring a guest's lists across on the first cloud mount, then reload so the
    // just-uploaded rows are what the screen shows. Guarded by a ref as well as
    // its own storage flag: this effect re-runs on every foreground, and the
    // flag is only written after a round trip.
    if (!migrateOnce.current) {
      migrateOnce.current = true;
      void migrateLocalLists(householdId, user?.id ?? null).then(() => {
        if (alive) void fetchLists();
      });
    }

    void fetchLists();

    // One channel carries both the row changes and presence. Presence is
    // genuinely ephemeral — "who has the app open right now" should vanish when
    // someone closes it, which is exactly what a socket-scoped membership does
    // for free. (Claims are the opposite and live on the row; see 0015.)
    const channel = supabase
      .channel(`lists-${householdId}`, { config: { presence: { key: user?.id ?? 'anon' } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_lists' }, scheduleRefetch)
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Everyone except me. Presence keys are user ids, and a member with two
        // devices appears twice, so this de-duplicates.
        const others = Object.keys(state).filter((id) => id && id !== user?.id);
        // Only replace the array when the set actually changed, so a presence
        // heartbeat doesn't re-render the whole list tree every few seconds.
        setShoppers((prev) =>
          prev.length === others.length && prev.every((id) => others.includes(id)) ? prev : others,
        );
      })
      .subscribe((status) => {
        // Announce ourselves only once the socket is actually joined; tracking
        // earlier is dropped silently.
        if (status === 'SUBSCRIBED' && user?.id) void channel.track({ at: Date.now() });
      });

    return () => {
      alive = false;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      // Leaving the channel drops our presence, so backgrounding the app takes
      // us out of "shopping now" rather than leaving a ghost behind.
      setShoppers(EMPTY_SHOPPERS);
      supabase.removeChannel(channel);
    };
  }, [householdId, cacheKey, fetchLists, scheduleRefetch, appActive, user?.id]);

  const patchLocalItem = useCallback((listId: string, itemId: string, patch: ItemPatch) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          : l,
      ),
    );
  }, []);

  /** Local half of the late unit fill. See the same helper in the local store. */
  const fillUnitIfEmpty = useCallback((listId: string, itemId: string, unit: string | null) => {
    if (!unit) return;
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                it.id === itemId && it.unit == null ? { ...it, unit } : it,
              ),
            }
          : l,
      ),
    );
  }, []);

  /**
   * The AI upgrade a plain `categorizeSync` couldn't give at add time. See the
   * same helper in the local store for why this has to be shared rather than
   * `addItem`'s alone — an imported item bypassing it was exactly the bug.
   *
   * `addTimeUnit` is the unit already computed (and already written) when the
   * row was first inserted. Passed in rather than re-read, purely so the DB
   * update below can skip itself when we already know it would be a no-op —
   * the `.is('unit', null)` guard makes that safe either way, this just saves
   * the round trip.
   */
  const resolveIfUnknown = useCallback(
    (listId: string, itemId: string, name: string, category: ItemCategory, addTimeUnit: string | null) => {
      if (category !== 'other' || isKnown(name)) return;
      resolveCategoryAsync(name).then((res) => {
        if (!res || res.category === 'other') return;
        patchLocalItem(listId, itemId, { category: res.category });
        void supabase
          .from('list_items')
          .update({ category: res.category })
          .eq('id', itemId)
          .then(({ error }) => reportWriteFailure('list_items.category', error));
        // See the local store: only when the row still has no unit, since the
        // user may have picked one while the call was in flight. The
        // `is('unit', null)` on the update is the same guard applied to the
        // row another member might have edited from their phone.
        const learnedUnit = seedUnit(name, res.category, res.unit, null);
        if (learnedUnit && addTimeUnit == null) {
          fillUnitIfEmpty(listId, itemId, learnedUnit);
          void supabase
            .from('list_items')
            .update({ unit: learnedUnit })
            .eq('id', itemId)
            .is('unit', null)
            .then(({ error }) => reportWriteFailure('list_items.unit', error));
        }
        void learnCategory(name, res.category);
      });
    },
    [patchLocalItem, fillUnitIfEmpty],
  );

  const setCheckedLocal = useCallback((listId: string, itemId: string, checked: boolean) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? {
              ...l,
              items: l.items.map((it) =>
                it.id === itemId ? { ...it, checked, checkedAt: checked ? Date.now() : null } : it,
              ),
            }
          : l,
      ),
    );
  }, []);

  /*
   * Yesterday's shop leaves the list — the cloud half. See the local backend
   * above for why this is the store's job rather than each screen's.
   *
   * Two steps here where local needed one, because the rows live on a server:
   * `visibleLists` makes the UI correct immediately and offline, and the effect
   * removes the rows for good. If the delete fails there is nothing to retry —
   * the filter already hid them, and the next launch tries again.
   *
   * Deliberately not gated on "am I the one who ticked it": any member sweeping
   * is the right outcome, and the delete is idempotent, so two phones doing it
   * at the same moment is a no-op rather than a conflict.
   */
  const day = useLocalDay();
  const visibleLists = useMemo(() => liveLists(lists, day), [lists, day]);
  useEffect(() => {
    const doomed = lists.flatMap((l) => settledIds(l.items, day));
    if (doomed.length === 0) return;
    void supabase
      .from('list_items')
      .delete()
      .in('id', doomed)
      // No refetch: the filter has already hidden these rows, so a failure
      // costs nothing today and the next launch tries again. It is still worth
      // knowing about — a sweep that never succeeds means the table grows
      // without bound behind a UI that looks fine.
      .then(({ error }) => reportWriteFailure('list_items.sweep', error));
  }, [lists, day]);

  const value = useMemo<GroceriesContext>(() => {
    const dbPatch = (patch: ItemPatch): Record<string, unknown> => {
      const db: Record<string, unknown> = {};
      if (patch.name !== undefined) db.name = patch.name;
      if (patch.category !== undefined) db.category = patch.category;
      if (patch.quantity !== undefined) db.quantity = patch.quantity;
      if (patch.unit !== undefined) db.unit = patch.unit;
      if (patch.priceCents !== undefined) db.price_cents = patch.priceCents;
      if (patch.bio !== undefined) db.bio = patch.bio;
      if (patch.store !== undefined) db.store = patch.store;
      return db;
    };

    /**
     * Insert a structured item (optimistic row + persisted insert). Shared by
     * quick-add and the pantry/vibe adds so they enrich and remember alike.
     */
    const insertParsed = (listId: string, p: ParsedItem) => {
      const id = uuidv4();
      // AI sets quantity/unit; fall back to remembered usuals for blanks and
      // always prefill the usual store (the AI never parses it).
      const usual = recallItemDetails(p.name);
      const quantity = p.quantity ?? usual?.quantity ?? null;
      const unit = seedUnit(p.name, p.category, p.unit, usual?.unit);
      const store = usual?.store ?? null;
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? {
                ...l,
                items: [
                  ...l.items,
                  { ...newItem(p.name, p.category, { quantity, unit, store }), id },
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
          quantity,
          unit,
          store,
          added_by: user?.id ?? null,
        })
        .then(({ error }) => {
          recoverFrom('list_items.insert.parsed', error);
        });
      rememberItemList(p.name, listId);
      resolveIfUnknown(listId, id, p.name, p.category, unit);
    };

    return {
      lists: visibleLists,
      addList: (name) => {
        const id = uuidv4();
        setLists((prev) => [...prev, { id, name, store: null, items: [] }]);
        supabase
          .from('shopping_lists')
          .insert({ id, household_id: householdId, name, position: lists.length })
          .then(({ error }) => {
            reportWriteFailure('shopping_lists.insert', error);
            if (error) scheduleRefetch();
          });
        return id;
      },
      deleteList: (listId) => {
        setLists((prev) => prev.filter((l) => l.id !== listId));
        forgetHomeList(listId);
        supabase
          .from('shopping_lists')
          .delete()
          .eq('id', listId)
          .then(({ error }) => {
            reportWriteFailure('shopping_lists.delete', error);
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
          void supabase
            .from('shopping_lists')
            .update({ position: i })
            .eq('id', id)
            .then(({ error }) => reportWriteFailure('shopping_lists.reorder', error));
        });
      },
      addItem: (listId, name) => {
        const clean = name.trim();
        const id = uuidv4();
        if (!clean) return id;
        const category = categorizeSync(clean);
        // Prefill the quantity/unit/store last used for this item (see #3),
        // in both the optimistic row and the persisted insert.
        const usual = recallItemDetails(clean);
        const unit = seedUnit(clean, category, null, usual?.unit);
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: [...l.items, { ...newItem(clean, category, usual ?? {}), id, unit }] }
              : l,
          ),
        );
        supabase
          .from('list_items')
          .insert({
            id,
            list_id: listId,
            name: clean,
            category,
            quantity: usual?.quantity ?? null,
            unit,
            store: usual?.store ?? null,
            added_by: user?.id ?? null,
          })
          .then(({ error }) => {
            recoverFrom('list_items.insert', error);
          });
        rememberItemList(clean, listId);
        resolveIfUnknown(listId, id, clean, category, unit);
        return id;
      },
      addParsedItem: (listId, p) => insertParsed(listId, p),
      addOrReviveItem: (listId, p) => {
        const key = normalizeKey(p.name);
        /*
         * The SWEPT list, not the raw one. A settled row is one the sweep is
         * deleting or has already deleted, so reviving it would either update a
         * row that no longer exists — the item silently never arrives — or win
         * the race and then be deleted anyway. Treating it as absent inserts a
         * fresh row, which is what "add it back to the list" means once
         * yesterday's shop has left.
         */
        const existing = visibleLists
          .find((l) => l.id === listId)
          ?.items.find((it) => normalizeKey(it.name) === key);
        if (existing) {
          // Already waiting to be bought — adding again would just duplicate it.
          if (!existing.checked) {
            rememberItemList(p.name, listId);
            return 'already';
          }
          // Ticked off from a previous shop: bring that row back to "to buy".
          setCheckedLocal(listId, existing.id, false);
          supabase
            .from('list_items')
            .update({ checked: false, checked_at: null })
            .eq('id', existing.id)
            .then(({ error }) => {
              recoverFrom('list_items.revive', error);
            });
          rememberItemList(p.name, listId);
          return 'revived';
        }
        insertParsed(listId, p);
        return 'added';
      },
      toggleItem: (listId, itemId) => {
        const current = lists
          .find((l) => l.id === listId)
          ?.items.find((it) => it.id === itemId);
        const next = !(current?.checked ?? false);
        // Both columns in one UPDATE. A row whose `checked` and `checked_at`
        // disagree either never settles or settles while still on the list, so
        // they are never written apart — see lib/list-sweep.ts.
        const at = next ? new Date().toISOString() : null;
        setCheckedLocal(listId, itemId, next);
        supabase
          .from('list_items')
          .update({ checked: next, checked_at: at })
          .eq('id', itemId)
          .then(({ error }) => {
            recoverFrom('list_items.toggle', error);
          });
      },
      updateItem: (listId, itemId, patch) => {
        patchLocalItem(listId, itemId, patch);
        supabase
          .from('list_items')
          .update(dbPatch(patch))
          .eq('id', itemId)
          .then(({ error }) => {
            recoverFrom('list_items.update', error);
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
            reportWriteFailure('list_items.delete', error);
            if (error) scheduleRefetch();
          });
      },
      setClaim: (listId, itemId, claimed) => {
        const claimedBy = claimed ? user?.id ?? null : null;
        if (claimed && !claimedBy) return; // nothing to claim it as
        const claimedAt = claimed ? Date.now() : null;
        // Optimistic: the tap has to feel instant while you're stood in an
        // aisle, and realtime will confirm it on everyone else's phone.
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((it) =>
                    it.id === itemId ? { ...it, claimedBy, claimedAt } : it,
                  ),
                }
              : l,
          ),
        );
        supabase
          .from('list_items')
          .update({
            claimed_by: claimedBy,
            claimed_at: claimedAt ? new Date(claimedAt).toISOString() : null,
          })
          .eq('id', itemId)
          .then(({ error }) => {
            reportWriteFailure('list_items.claim', error);
            if (error) scheduleRefetch();
          });
      },
      shoppersOnline: shoppers,
      hydrated: hydratedState,
    };
  }, [
    lists,
    hydratedState,
    shoppers,
    householdId,
    user,
    patchLocalItem,
    setCheckedLocal,
    scheduleRefetch,
    recoverFrom,
    resolveIfUnknown,
  ]);

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
