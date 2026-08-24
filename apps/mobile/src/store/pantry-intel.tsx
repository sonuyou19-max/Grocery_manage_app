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

import { categorizeSync } from '@/lib/categorize';
import { recallItemList } from '@/lib/item-home-list';
import { reportWriteFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';
import { uuidv4 } from '@/lib/uuid';
import { useAppActive } from '@/lib/use-app-active';
import {
  applyAlmostOut,
  applyStopped,
  applyStaple,
  applyStillGood,
  buildDeck,
  normalizeKey,
  pantryCounts,
  queuedKeys,
  recordPurchase,
  revertPurchase,
  statsFromPurchases,
  type DeckCard,
  type ItemStat,
  type StatMap,
} from '@/lib/pantry-intel';
import {
  MISTAKE_WINDOW_MS,
  recentRecordFor,
  SESSION_WINDOW_MS,
  undoableRecordFor,
  type Purchase,
} from '@/lib/purchase-log';
import { purchasesToMigrate } from '@/lib/purchase-migration';
import { useAuth } from '@/store/auth';
import { useEntitlement } from '@/store/entitlement';
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
  /** The size of ONE pack. */
  quantity?: number | null;
  unit?: string | null;
  /**
   * How many packs (migration 0036). Without this the count is lost at exactly
   * the moment the purchase becomes history, which is where every per-unit
   * comparison is computed from — four pots of cream would enter the price log
   * as one, at four times the real price per ml.
   */
  packs?: number | null;
  /** The shopper's organic/local flag, carried from the list item. */
  bio?: boolean | null;
  /**
   * The manufacturer, when a receipt named one (migration 0038).
   *
   * A fact about this PURCHASE and never about the item. Folded into the name
   * it would become part of item_key, and "milk every six days" would fragment
   * into Alpro-milk and own-brand-milk — two histories, half the samples each,
   * neither ever coming due. Nothing hand-typed sets it.
   */
  brand?: string | null;
  /** The scanned receipt this was read from, or null when logged by hand. */
  receiptId?: string | null;
  /**
   * WHEN the purchase happened, when that is not now.
   *
   * Only a receipt passes this. It is what lets last night's shop, scanned this
   * morning, amend last night's ticks instead of duplicating them: the session
   * window is measured from the purchase's own instant, so handing it the
   * receipt's printed time points the whole existing amendment rule at the
   * right two hours. See lib/receipt-commit.
   */
  at?: number;
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
   * An item was UNchecked. Removes the transaction when the untick reads as a
   * correction rather than a restock — inside MISTAKE_WINDOW_MS of the last
   * tick, or at any time when this is the only purchase the item has ever had.
   * See undoableRecordFor for why elapsed time alone was the wrong test.
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
   * its countdown (see applyStopped).
   */
  /**
   * Stop buying an item, or start again.
   *
   * `restartClock: false` is the toast's Undo and nothing else — see
   * applyStopped for why an accidental tap must not move lastPurchasedAt.
   */
  setStopped: (
    key: string,
    stopped: boolean,
    options?: { restartClock?: boolean },
  ) => void;
  /**
   * Erase an item from the household entirely: the pantry row AND every
   * purchase ever logged against it.
   *
   * The hard counterpart to `setStopped`, and the difference is the whole
   * reason both exist. Resting keeps the history and stops the questions —
   * it is for something you have stopped buying but might buy again, and it
   * is reversible. This is for a row that should never have been there: a
   * typo, a one-off, an item somebody else in the household added by mistake.
   * It is not reversible, and because the purchase log is what Insights is
   * computed from, it also takes that item out of spending, staples, price
   * comparisons and the impact score. Callers MUST say so before asking.
   *
   * Shopping lists are deliberately left alone — see the Pantry tab for why.
   */
  forgetItem: (key: string) => void;
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
  category: ItemCategory,
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
    // `now` unless a receipt said otherwise. Everything downstream — the
    // session window, the fold, the trim — measures from this one number.
    at: detail?.at ?? now,
    quantity: detail?.quantity ?? null,
    packs: detail?.packs ?? 1,
    unit: detail?.unit ?? null,
    bio: detail?.bio === true,
    brand: detail?.brand ?? null,
    // Recorded at purchase time rather than looked up later: the log is what
    // the pantry is rebuilt from, and a category the user corrected by hand
    // must survive that rebuild. See migration 0023.
    category,
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
  if (!open) return [{ ...entry, touchedAt: entry.at }, ...existing];
  // Keep the ORIGINAL id and timestamp: this is the same transaction being
  // corrected, not a new one. Moving the timestamp forward would let a long
  // shop keep extending its own window indefinitely.
  //
  // `touchedAt` DOES move, and must: it is the record of this tick, not of the
  // shop. Leaving it pinned alongside `at` is what let a row tapped on and off
  // for a quarter of an hour become impossible to untick — see
  // undoableRecordFor for the full account.
  const merged: Purchase = { ...entry, id: open.id, at: open.at, touchedAt: entry.at };
  return existing.map((p) => (p.id === open.id ? merged : p));
}

/**
 * Stable empty map for the signed-out backend.
 *
 * A fresh `{}` each render would change identity every time and defeat the
 * memoization in every consumer — including useVibeDeck, which would then
 * rebuild a deck of nothing on every single render.
 */
const EMPTY_STATS: StatMap = {};

/**
 * Newest first, inside the window, capped.
 *
 * `cutoff` is the oldest purchase to keep. It comes from the server for signed-
 * in accounts (see entitlement.tsx — a free account sees the last few weeks,
 * Plus sees the year) and falls back to the full retention window when there
 * isn't one: guests, and the moment before the first answer arrives.
 *
 * Falling back to the FULL window rather than the free one is deliberate. Being
 * briefly generous costs nothing; being briefly stingy would blank out a
 * paying customer's history every time the app opened on a slow connection.
 */
function trimPurchases(all: Purchase[], now: number, cutoff?: number | null): Purchase[] {
  const oldest = cutoff ?? now - PURCHASE_WINDOW_MS;
  return all
    .filter((p) => p.at >= oldest)
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

/**
 * The device-local pantry model, RETIRED.
 *
 * Kept only as a name to delete. Builds before this one persisted a StatMap
 * here for signed-out users; the pantry is now derived from the log and never
 * stored, so any surviving copy is orphaned data describing someone's shopping
 * habits. "We store nothing but the log when you are signed out" has to be true
 * on disk, not just in new code, so it is actively removed rather than left to
 * rot.
 */
const RETIRED_LOCAL_STATS_KEY = 'korb.pantryIntel.v1';
/** Same: the flag for a backfill that no longer exists. */
const RETIRED_LOCAL_BACKFILL_KEY = 'korb.purchaseLog.backfilled.v1';
/** The on-device purchase log, mirroring the cloud price_entries table. */
const LOCAL_PURCHASES_KEY = 'korb.purchaseLog.v1';

function LocalPantryIntelProvider({ children }: PropsWithChildren) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    // Retire the old on-device pantry. removeItem on an absent key is a no-op,
    // so this needs no flag of its own and costs nothing after the first run.
    AsyncStorage.multiRemove([RETIRED_LOCAL_STATS_KEY, RETIRED_LOCAL_BACKFILL_KEY]).catch(() => {});

    AsyncStorage.getItem(LOCAL_PURCHASES_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        // Trim on read as well as write: rows age out of the window while the
        // app is closed, so a log untouched for months would come back
        // oversized and stale.
        if (Array.isArray(parsed)) setPurchases(trimPurchases(parsed as Purchase[], Date.now()));
      })
      .catch(() => {
        // A corrupt log costs history, not function — start empty.
      });
  }, []);

  const value = useMemo<PantryIntelContext>(
    () => ({
      // Empty, always. Every pantry-derived surface is written to render
      // nothing when this is empty, which is what makes the Vibe Check card and
      // the weekly builder disappear for a guest without a single extra guard.
      stats: EMPTY_STATS,
      purchases,
      logPurchase: (name, category, detail) => {
        const entry = toPurchase(name, category, detail, Date.now());
        if (!entry) return;
        setPurchases((prev) => {
          const next = trimPurchases(foldPurchase(prev, entry), entry.at);
          // Written straight through rather than on a debounced timer: this is
          // the only record a guest has, and losing an entry to a kill
          // mid-timer means a purchase that silently never happened.
          AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      },
      // No stat to revert here, unlike the cloud backend: signed out there is
      // no pantry model at all, so removing the transaction removes the whole
      // trace of the mistaken tick.
      unlogRecent: (name) => {
        const key = normalizeKey(name);
        setPurchases((prev) => {
          const doomed = undoableRecordFor(prev, key, Date.now(), MISTAKE_WINDOW_MS);
          if (!doomed) return prev;
          const next = prev.filter((p) => p.id !== doomed.id);
          AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      },
      // Every one of these is a Pantry-tab action, and the Pantry tab is behind
      // an account. They are no-ops rather than missing so the context shape
      // stays identical across both backends — a caller that reached one of
      // these while signed out would be a routing bug, and a silent no-op is a
      // better failure than a crash in a shipped app.
      markAlmostOut: () => {},
      markStillGood: () => {},
      setStaple: () => {},
      setStopped: () => {},
      forgetItem: () => {},
      seedDemo: () => {},
    }),
    [purchases],
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
  home_list_id: string | null;
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
  homeList: r.home_list_id ?? null,
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
  /*
   * The stat's own value first, the device's memory only as a seed.
   *
   * This runs on every check-off, and the stat it is given was built by
   * spreading the row that came back from the server — so the household's
   * answer is what is normally written straight back, and one member checking
   * something off cannot blank the home list another member set.
   *
   * recallItemList fills the gap that leaves: an item bought for the first time
   * has no server row to carry a value, and rememberItemList's own update (see
   * lib/item-home-list) found no row to write to for exactly the same reason.
   * This is the moment the row comes into existence, and the device that just
   * added the item is the one that knows where it went.
   */
  home_list_id: s.homeList ?? recallItemList(s.display) ?? null,
});

interface DbPriceRow {
  id: string;
  item_key: string | null;
  item_name: string;
  store: string | null;
  price_cents: number | null;
  bio: boolean | null;
  quantity: number | null;
  packs: number;
  unit: string | null;
  category: ItemCategory | null;
  brand: string | null;
  recorded_at: string;
}

const mapPriceRow = (r: DbPriceRow): Purchase => ({
  id: r.id,
  key: r.item_key ?? normalizeKey(r.item_name),
  name: r.item_name,
  store: r.store,
  priceCents: r.price_cents,
  bio: r.bio ?? false,
  at: Date.parse(r.recorded_at),
  quantity: r.quantity == null ? null : Number(r.quantity),
  // Rows predate 0036 or arrive from a client that has not been updated.
  packs: r.packs == null ? 1 : Number(r.packs),
  unit: r.unit,
  category: r.category,
  brand: r.brand ?? null,
});

/** Marks this device's orphaned local log as re-homed. Device-wide, not
 *  per-household: your history belongs in the FIRST household you bring it to,
 *  and copying it into every household you later join would be inventing
 *  spending that never happened there. */
const LOCAL_MIGRATED_KEY = 'korb.purchaseLog.migrated.v1';

/**
 * Carry a guest's on-device purchase history into the household they just
 * joined.
 *
 * Runs once per device, after the first cloud fetch so it can see what the
 * household already has. Everything about it is best-effort: a failure leaves
 * the local log untouched and the flag unset, so the next launch tries again.
 *
 * See lib/purchase-migration.ts for why this merges rather than moves, and why
 * "already there" is same-item-same-day rather than an exact timestamp.
 */
async function migrateLocalPurchases(
  householdId: string,
  applyPurchases: (list: Purchase[]) => void,
  onSeeded: () => Promise<void>,
): Promise<void> {
  try {
    const [done, rawLocal] = await Promise.all([
      AsyncStorage.getItem(LOCAL_MIGRATED_KEY),
      AsyncStorage.getItem(LOCAL_PURCHASES_KEY),
    ]);
    if (done === '1') return;
    const parsed = rawLocal ? JSON.parse(rawLocal) : [];
    const local: Purchase[] = Array.isArray(parsed) ? parsed : [];
    if (local.length === 0) {
      // Nothing to carry — still mark it done, so a user who never shopped
      // offline doesn't pay for this check on every launch forever.
      await AsyncStorage.setItem(LOCAL_MIGRATED_KEY, '1');
      return;
    }

    const now = Date.now();
    const since = new Date(now - PURCHASE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('price_entries')
      .select('id, item_key, item_name, store, price_cents, quantity, packs, unit, category, bio, brand, recorded_at')
      .eq('household_id', householdId)
      .gte('recorded_at', since)
      .limit(LOCAL_PURCHASE_CAP);
    // Without a reliable picture of what's already there we cannot tell a new
    // row from a duplicate, and guessing wrong doubles someone's spend chart.
    // Leave the flag unset and try again next launch.
    if (error || !data) return;

    const cloud = (data as DbPriceRow[]).map(mapPriceRow);
    const missing = purchasesToMigrate(local, cloud, now, PURCHASE_WINDOW_MS);

    if (missing.length > 0) {
      const { error: insertError } = await supabase.from('price_entries').insert(
        missing.map((p) => ({
          id: p.id,
          household_id: householdId,
          item_key: p.key,
          item_name: p.name,
          store: p.store,
          price_cents: p.priceCents,
          bio: p.bio,
          quantity: p.quantity,
          packs: p.packs,
          unit: p.unit,
          category: p.category,
          recorded_at: new Date(p.at).toISOString(),
        })),
      );
      /*
       * The costliest silent failure in the app. This is the sign-in transfer:
       * everything the user logged before they had an account. Leaving the flag
       * unset means the next launch tries again, which is the right recovery —
       * but if it never succeeds, the user is told their history is safe and it
       * is sitting on one device.
       */
      reportWriteFailure('price_entries.migrate', insertError);
      if (insertError) return;
    }

    // Turn the whole log into a pantry.
    //
    // This is the moment the sign-up promise is kept. Uploading the purchases
    // alone would leave the Pantry tab empty on the other side of the gate —
    // technically the history is safe, but the person who was told "your pantry
    // is ready" would open it and find nothing, which is worse than not having
    // promised. The rebuild is what makes the tab arrive already knowing their
    // rhythms instead of starting to learn from today.
    await seedPantryFromLog([...missing, ...cloud], householdId);
    // Pull the rows we just wrote. Without this the screen the user signed up
    // FROM stays empty until something else remounts it — they land back on
    // Pantry, see nothing, and only discover their history by switching tabs
    // and returning.
    await onSeeded();

    await AsyncStorage.setItem(LOCAL_MIGRATED_KEY, '1');
    // The local log is deliberately NOT deleted. It costs a few kilobytes, and
    // it is the only copy of this history if the upload turns out to have gone
    // somewhere the user didn't intend — a household they joined by mistake,
    // say. Signing out returns them to it intact.
    applyPurchases(trimPurchases([...missing, ...cloud], now));
  } catch {
    // Corrupt local log, or offline. Either way the flag stays unset.
  }
}

/**
 * Write a pantry derived from the household's purchase log.
 *
 * Insert-only, deliberately. Rows another member already has are left exactly
 * as they are, because theirs may carry decisions this rebuild cannot see — a
 * pinned cadence, a staple flag, a resting item. statsFromPurchases can
 * reproduce rhythms but never choices (see lib/pantry-intel.ts), so overwriting
 * would silently undo settings somebody deliberately made. Only items the
 * household has no row for at all are created.
 *
 * Best-effort throughout: a failure here costs a pantry that fills in on the
 * next check-off rather than one that arrives complete, and it must never take
 * the sign-up down with it.
 */
async function seedPantryFromLog(log: Purchase[], householdId: string): Promise<void> {
  if (log.length === 0) return;
  try {
    const { data, error } = await supabase
      .from('pantry_items')
      .select('item_key')
      .eq('household_id', householdId);
    // Without a reliable list of what is already there we cannot tell a new row
    // from an existing one, and guessing wrong would overwrite someone's
    // settings. Skip rather than risk it.
    if (error || !data) return;

    const known = new Set((data as Array<{ item_key: string | null }>).map((r) => r.item_key));
    // Categories come off the purchases themselves (migration 0023); the
    // fallback only matters for rows logged before that column existed.
    const derived = statsFromPurchases(log, (name) => categorizeSync(name));
    const rows = Object.values(derived)
      .filter((s) => !known.has(s.key))
      .map((s) => ({
        household_id: householdId,
        item_key: s.key,
        name: s.key,
        display_name: s.display,
        category: s.category,
        last_purchased_at: new Date(s.lastPurchasedAt).toISOString(),
        avg_purchase_interval_days: s.intervalDays,
        sample_count: s.sampleCount,
      }));
    if (rows.length === 0) return;

    const { error: seedError } = await supabase.from('pantry_items').insert(rows);
    reportWriteFailure('pantry_items.seed', seedError);
  } catch {
    // See above: never fatal.
  }
}

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

  /**
   * How far back this account may look, held in a ref rather than read directly.
   *
   * The server computes it as `now() - interval`, so the value moves every time
   * it is asked. Putting it in a dependency array would make fetchPurchases a
   * new function on every foreground refresh, which would tear down and
   * re-open the realtime channel each time for a number that has changed by a
   * few hundred milliseconds. The ref keeps the callback stable; `loaded` below
   * is what actually triggers the one refetch that matters.
   */
  const { historyCutoff, loaded: entitlementLoaded } = useEntitlement();
  const cutoffRef = useRef<number | null>(null);
  cutoffRef.current = historyCutoff;

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
        'item_key, name, display_name, category, last_purchased_at, avg_purchase_interval_days, sample_count, snooze_until, keep_stocked, cadence_days, archived_at, home_list_id',
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
   * been shopping — and, since the window is now also the paid boundary, so the
   * rows a free account may not see are never sent to the device in the first
   * place. Hiding them after they arrive would leave them sitting in the
   * AsyncStorage mirror.
   */
  const fetchPurchases = useCallback(async () => {
    const since = new Date(cutoffRef.current ?? Date.now() - PURCHASE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('price_entries')
      .select('id, item_key, item_name, store, price_cents, quantity, packs, unit, category, bio, recorded_at')
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
    if (!appActive) return () => { alive = false; };

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
  }, [householdId, cacheKey, fetchStats, scheduleRefetch, appActive]);

  /**
   * The money log, hydrated and fetched separately from the pantry above.
   *
   * Separate because it waits for something the pantry does not: `loaded` from
   * the entitlement provider. The pantry is free for everyone, so it starts the
   * moment the screen mounts. The purchase log is windowed by what the account
   * has paid for, and reading the cache — or fetching — before that answer
   * arrives would show a free account its full year for one frame and then
   * snatch it back, which is a worse experience than the log appearing a beat
   * late on a tab nobody launches into.
   *
   * `entitlementLoaded` flips false→true exactly once per sign-in, so this runs
   * twice at most per cold start and never re-opens the realtime channel above.
   *
   * price_entries is deliberately unpublished (migration 0013), so there is no
   * socket here: refreshed on open and on returning to the foreground. A
   * member's purchase landing mid-session changes no decision on screen.
   */
  useEffect(() => {
    if (!entitlementLoaded) return;
    let alive = true;
    AsyncStorage.getItem(purchaseCacheKey)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw);
        // Trimmed against the CURRENT window, not the one in force when it was
        // written. Without this, an account that lapses keeps seeing its full
        // year straight from the device cache — the one path where the server
        // window cannot help, because no request is made.
        if (Array.isArray(parsed)) {
          setPurchases(trimPurchases(parsed as Purchase[], Date.now(), cutoffRef.current));
        }
      })
      .catch(() => {});
    if (!appActive) return () => { alive = false; };

    void fetchPurchases().then(() => {
      if (alive) void migrateLocalPurchases(householdId, applyPurchases, fetchStats);
    });
    return () => { alive = false; };
  }, [
    householdId,
    purchaseCacheKey,
    entitlementLoaded,
    fetchPurchases,
    applyPurchases,
    fetchStats,
    appActive,
  ]);

  const value = useMemo<PantryIntelContext>(() => {
    const upsert = (keys: string[], map: StatMap) => {
      const rows = keys.map((k) => map[k]).filter(Boolean).map((s) => toRow(householdId, s));
      if (rows.length === 0) return;
      supabase
        .from('pantry_items')
        .upsert(rows, { onConflict: 'household_id,item_key' })
        .then(({ error }) => {
          reportWriteFailure('pantry_items.upsert', error);
          if (error) scheduleRefetch();
        });
    };

    return {
      stats,
      purchases,
      logPurchase: (name, category, detail) => {
        const next = recordPurchase(statsRef.current, name, category, detail?.at ?? Date.now());
        apply(next);
        upsert([normalizeKey(name)], next);

        const entry = toPurchase(name, category, detail, Date.now());
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
          bio: entry.bio,
          quantity: entry.quantity,
          packs: entry.packs,
          unit: entry.unit,
          category: entry.category,
          brand: entry.brand ?? null,
          // Stamped on the AMENDMENT too, not only on inserts: a row this
          // receipt corrected was read from this receipt, and without it the
          // ledger could not say where the price came from.
          receipt_id: detail?.receiptId ?? null,
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
          // purchase that only this device believes in — and report it, because
          // that resync is silent and a lost purchase is a hole in the spend
          // history nobody will ever notice from the inside.
          reportWriteFailure(open ? 'price_entries.update' : 'price_entries.insert', error);
          if (error) void fetchPurchases();
        });
      },
      unlogRecent: (name) => {
        const key = normalizeKey(name);
        const doomed = undoableRecordFor(purchasesRef.current, key, Date.now(), MISTAKE_WINDOW_MS);
        if (!doomed) return;
        const remaining = purchasesRef.current.filter((p) => p.id !== doomed.id);
        applyPurchases(remaining);

        // The tick moved the burn rate as well as writing the transaction, so
        // undoing it has to undo both — otherwise the item sits in the pantry
        // insisting it was bought today, on a list, and running low, all at
        // once.
        const reverted = revertPurchase(statsRef.current, key, remaining, categorizeSync);
        apply(reverted);
        if (reverted[key]) {
          upsert([key], reverted);
        } else {
          // Its only purchase — the pantry row was created by the mistake, so
          // it goes with it.
          void supabase
            .from('pantry_items')
            .delete()
            .eq('household_id', householdId)
            .eq('item_key', key)
            .then(({ error }) => reportWriteFailure('pantry_items.delete', error));
        }

        supabase
          .from('price_entries')
          .delete()
          .eq('id', doomed.id)
          .then(({ error }) => {
            reportWriteFailure('price_entries.delete', error);
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
      setStopped: (key, stopped, options) => {
        const next = applyStopped(statsRef.current, key, stopped, Date.now(), options);
        apply(next);
        upsert([key], next);
      },
      forgetItem: (key) => {
        // Local state first, both halves, so the row leaves the Pantry and the
        // Insights figures drop it on the same frame. Neither read waits on the
        // network; a failed delete is surfaced by the refetch below putting the
        // rows back, which is the honest outcome rather than a row that looks
        // gone until the next launch.
        const next = { ...statsRef.current };
        delete next[key];
        apply(next);

        const doomed = purchasesRef.current.filter((p) => p.key === key);
        applyPurchases(purchasesRef.current.filter((p) => p.key !== key));

        void supabase
          .from('pantry_items')
          .delete()
          .eq('household_id', householdId)
          .eq('item_key', key)
          .then(({ error }) => reportWriteFailure('pantry_items.delete', error));

        // By key, which reaches rows older than the 52-week window the client
        // never loaded — the point of this action is that nothing is left.
        void supabase
          .from('price_entries')
          .delete()
          .eq('household_id', householdId)
          .eq('item_key', key)
          .then(({ error }) => {
            reportWriteFailure('price_entries.delete', error);
            if (error) void fetchPurchases();
          });

        // And by id for what IS loaded, because item_key is nullable: rows
        // written before 0013 were backfilled with `lower(btrim(name))`, which
        // does not collapse internal whitespace the way normalizeKey does. Such
        // a row answers to a key the delete above never asks for, and would
        // reappear on the next fetch as an item the user had just deleted.
        const ids = doomed.map((p) => p.id);
        if (ids.length > 0) {
          void supabase
            .from('price_entries')
            .delete()
            .eq('household_id', householdId)
            .in('id', ids)
            .then(({ error }) => {
              reportWriteFailure('price_entries.delete', error);
              if (error) void fetchPurchases();
            });
        }
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

/**
 * The Pantry's own headline numbers, for callers that are not the Pantry.
 *
 * The dashboard needs these to say something true when the Vibe Check deck is
 * empty: an empty deck means "nothing left to decide", which is NOT the same as
 * "nothing is running low" — everything low may simply be on a list already.
 * Reading the counts from here rather than re-deriving them is what keeps the
 * two screens telling the same story.
 */
export function usePantryStatus(): { tracked: number; low: number } {
  const { stats } = usePantryIntel();
  const { lists } = useGroceries();
  return useMemo(
    () => pantryCounts(stats, queuedKeys(lists), Date.now()),
    [stats, lists],
  );
}

export type { DeckCard, ItemStat };
