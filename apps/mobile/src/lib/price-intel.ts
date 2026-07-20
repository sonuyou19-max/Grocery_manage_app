import { normalizeKey } from '@/lib/pantry-intel';

/**
 * Price/store intelligence derived from the prices you log on list items — no
 * new data is tracked, it's pure payoff on the priceCents + store fields items
 * already carry. (Trends across weeks come later with the purchase-log; this
 * reads whatever items exist right now.)
 */

/** Minimal shape needed — any list Item satisfies it structurally. */
export interface PricedItem {
  name: string;
  priceCents: number | null;
  store: string | null;
}

export interface StoreSpend {
  /** Store id, or null for items priced without a store set. */
  store: string | null;
  cents: number;
}

export interface CheaperHint {
  name: string;
  cheapStore: string;
  cheapCents: number;
  dearStore: string;
  dearCents: number;
}

/** Total logged spend grouped by store, biggest first. */
export function spendByStore(items: PricedItem[]): StoreSpend[] {
  const totals = new Map<string | null, number>();
  for (const it of items) {
    if (it.priceCents == null) continue;
    const key = it.store ?? null;
    totals.set(key, (totals.get(key) ?? 0) + it.priceCents);
  }
  return [...totals.entries()]
    .map(([store, cents]) => ({ store, cents }))
    .sort((a, b) => b.cents - a.cents);
}

/**
 * "You usually pay less for milk at Aldi" — for any item priced at two or more
 * distinct stores, the cheapest vs the dearest. Uses the lowest price seen at
 * each store, groups by the shared normalized name, and orders by the biggest
 * saving. Empty until the same item has prices from more than one store.
 */
export function cheaperStoreHints(items: PricedItem[]): CheaperHint[] {
  const byName = new Map<string, { display: string; stores: Map<string, number> }>();
  for (const it of items) {
    if (it.priceCents == null || it.store == null) continue;
    const display = it.name.trim();
    if (!display) continue;
    const key = normalizeKey(display);
    let entry = byName.get(key);
    if (!entry) {
      entry = { display, stores: new Map() };
      byName.set(key, entry);
    }
    const prev = entry.stores.get(it.store);
    if (prev == null || it.priceCents < prev) entry.stores.set(it.store, it.priceCents);
  }

  const hints: CheaperHint[] = [];
  for (const { display, stores } of byName.values()) {
    if (stores.size < 2) continue;
    let cheapStore = '';
    let cheapCents = Infinity;
    let dearStore = '';
    let dearCents = -Infinity;
    for (const [store, cents] of stores) {
      if (cents < cheapCents) {
        cheapCents = cents;
        cheapStore = store;
      }
      if (cents > dearCents) {
        dearCents = cents;
        dearStore = store;
      }
    }
    if (cheapCents < dearCents) {
      hints.push({ name: display, cheapStore, cheapCents, dearStore, dearCents });
    }
  }
  return hints.sort((a, b) => b.dearCents - b.cheapCents - (a.dearCents - a.cheapCents));
}
