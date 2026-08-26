import { normalizeKey } from '@/lib/pantry-intel';
import { comparisonBucket, unitPrice } from '@/lib/purchase-log';

/**
 * Price/store intelligence derived from the prices you log on list items — no
 * new data is tracked, it's pure payoff on the priceCents + store fields items
 * already carry.
 */

/** Minimal shape needed — any purchase satisfies it structurally. */
export interface PricedItem {
  name: string;
  priceCents: number | null;
  store: string | null;
  /**
   * How much was bought, when the user said. Null is common and fine — it
   * means "one of these", and such entries are only ever compared with other
   * entries that also lack a quantity. See cheaperStoreHints.
   */
  quantity: number | null;
  unit: string | null;
  /**
   * How many packs — the half of the size that kept getting dropped.
   *
   * `quantity` is ONE pack's size, so a four-pack of litre bottles is
   * `quantity: 1, packs: 4` and the litres bought are the product of the two.
   * Optional because most callers legitimately have no count, and `unitPrice`
   * reads an absent one as 1 — which is right for a single bottle and silently
   * wrong for anything else.
   *
   * It was missing from this shape while `quantity` was present, which is worse
   * than both being missing: the type looked like it carried the size, the
   * arithmetic looked like it divided by the size, and a four-pack of milk at
   * €3.56 was read as €3.56 a litre. The card then named the OTHER shop as the
   * bargain — with a precise figure beside it — when this one was four times
   * cheaper per litre.
   *
   * That is the same failure the note on cheaperStoreHints describes, one level
   * further up the pipe. The first time, quantity never reached the helper. The
   * second time it did, and the pack count did not.
   */
  packs?: number | null;
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
  /**
   * The unit the two figures are PER, or null when they are whole prices.
   *
   * The card must say this. "€1.00 vs €1.20" is a different claim from
   * "€1.00/L vs €1.20/L", and a reader who logged a 2 L bottle needs to know
   * which one they are looking at before they trust it.
   */
  perUnit: string | null;
}

/**
 * Total logged spend grouped by store, biggest first.
 *
 * Quantity is deliberately ignored here, and that is NOT the same oversight as
 * the one fixed below: what you spent at Lidl is what you spent at Lidl,
 * whether it went on one big bottle or four small ones. Normalising by quantity
 * would answer a question nobody asked.
 */
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
 * "You usually pay less for milk at Aldi" — the same item, cheapest shop
 * against dearest.
 *
 * ---------------------------------------------------------------------------
 * Why this compares per unit
 * ---------------------------------------------------------------------------
 *
 * It used to compare raw prices, and quantity never even reached it: the
 * Insights screen mapped the purchase log down to name/price/store and dropped
 * the rest on the way. So one litre at €1.20 beat two litres at €2.00, and the
 * card confidently recommended the shop that was 20% MORE expensive per litre —
 * with a precise-looking figure beside it, which is worse than saying nothing.
 *
 * Every price is now divided by its quantity where there is one, using the same
 * `unitPrice` the price-moves card uses, so the two cards cannot disagree about
 * what a comparison means.
 *
 * ---------------------------------------------------------------------------
 * Buckets, and why an item may be skipped rather than guessed at
 * ---------------------------------------------------------------------------
 *
 * `comparisonBucket` keeps litres away from kilos and — the case that caused
 * the bug — keeps entries WITH a quantity away from entries without one. A bare
 * €2.00 might have been for two litres or for one; there is no way to know, so
 * it is only ever set against other bare prices.
 *
 * That means an item logged both ways can end up with a single shop in each
 * bucket and produce no hint at all. That is the right outcome. The alternative
 * is inventing a quantity for the entry that lacks one, which is exactly how
 * the wrong shop got recommended in the first place.
 *
 * Where an item does have two comparable buckets, each is judged on its own and
 * the bigger saving wins — one hint per item, never two rows about milk.
 */
export function cheaperStoreHints(items: PricedItem[]): CheaperHint[] {
  /**
   * One entry per (item, bucket) → the cheapest seen at each shop.
   *
   * `itemKey` is carried in the value rather than parsed back out of the map
   * key. The bucket contains a `|` of its own, so splitting the composite key
   * on the last one recovered "milk|L" instead of "milk" — and an item logged
   * both with and without a quantity produced two rows about milk.
   */
  const groups = new Map<
    string,
    { itemKey: string; display: string; perUnit: string | null; stores: Map<string, number> }
  >();

  for (const it of items) {
    if (it.priceCents == null || it.store == null) continue;
    const display = it.name.trim();
    if (!display) continue;

    // Per-unit where a quantity was given, the whole price where it wasn't.
    // The bucket below guarantees the two kinds never meet.
    const perUnitCents = unitPrice(it);
    // A quantity that is present but unusable — zero, or negative — is
    // malformed rather than absent. Falling back to the whole price would slip
    // it into the per-unit bucket and compare "€1.20 for zero litres" against
    // real per-litre figures, so it is dropped instead.
    if (it.quantity != null && perUnitCents == null) continue;

    const price = perUnitCents ?? it.priceCents;
    if (!(price > 0)) continue;

    const itemKey = normalizeKey(display);
    const key = `${itemKey}|${comparisonBucket(it)}`;
    let entry = groups.get(key);
    if (!entry) {
      // Label the figures with a unit only when they really are per-unit.
      entry = { itemKey, display, perUnit: it.quantity != null ? it.unit : null, stores: new Map() };
      groups.set(key, entry);
    }
    const prev = entry.stores.get(it.store);
    if (prev == null || price < prev) entry.stores.set(it.store, price);
  }

  /** Best hint per item, keyed on the item rather than on the bucket. */
  const best = new Map<string, CheaperHint>();

  for (const { itemKey, display, perUnit, stores } of groups.values()) {
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
    if (cheapCents >= dearCents) continue;

    const hint: CheaperHint = {
      name: display,
      cheapStore,
      // Rounded only at the edge. Dividing by quantity yields fractions of a
      // cent, and rounding before the comparison could make two genuinely
      // different prices look equal.
      cheapCents: Math.round(cheapCents),
      dearStore,
      dearCents: Math.round(dearCents),
      perUnit,
    };

    const existing = best.get(itemKey);
    if (!existing || hint.dearCents - hint.cheapCents > existing.dearCents - existing.cheapCents) {
      best.set(itemKey, hint);
    }
  }

  return [...best.values()].sort(
    (a, b) => b.dearCents - b.cheapCents - (a.dearCents - a.cheapCents),
  );
}
