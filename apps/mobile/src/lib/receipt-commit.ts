import type { ItemCategory, ItemUnit } from '@korb/shared';

import {
  displayName,
  productName,
  type ReceiptPurchase,
  type ScannedReceipt,
} from '@/lib/receipt';
import { storeIdFor } from '@/lib/supermarkets';
import { supabase } from '@/lib/supabase';
import type { Decisions } from '@/lib/receipt-review';

/**
 * Turning a reviewed receipt into writes.
 *
 * ---------------------------------------------------------------------------
 * A plan, not a write
 * ---------------------------------------------------------------------------
 *
 * Every decision about WHAT lands in the purchase log is taken here, in a pure
 * function, and the screen only carries it out. The reason is that all of these
 * decisions fail the same way — invisibly, in somebody's price history, months
 * later — and none of them can be checked by looking at a screen:
 *
 *   * which NAME a purchase is filed under (the one thing that decides whether
 *     it joins an existing history or starts a lonely new one);
 *   * WHEN it happened, which decides whether it amends the shop the shopper
 *     already ticked off or duplicates it;
 *   * which lines are money rather than shopping.
 *
 * ---------------------------------------------------------------------------
 * The amendment, and why there is no amendment code
 * ---------------------------------------------------------------------------
 *
 * Ticking items off during the shop already writes purchases. Scanning the
 * receipt afterwards must therefore CORRECT those rows — filling in the price
 * and pack count nobody was going to type at a till — rather than adding a
 * second copy of the same shopping.
 *
 * That rule already exists and is already right: `logPurchase` looks for the
 * item's most recent record within SESSION_WINDOW_MS of the purchase's own
 * timestamp and updates it instead of inserting. So this plan does not
 * re-implement any of it. It supplies the one thing that makes the existing
 * rule work for a receipt: `at`, taken from the RECEIPT's printed time rather
 * than from the clock. Scanning last night's shop this morning then looks for
 * open records around last night, finds the ticks from that trip, and amends
 * them. Anchored on now() it would find nothing and duplicate the lot.
 *
 * Two implementations of an amendment window is exactly the kind of pair that
 * drifts, so there is one.
 */

/** A purchase to write, in the shape `logPurchase` takes. */
export interface PlannedPurchase {
  /** Purchase key from the scan, so the caller can report what failed. */
  key: string;
  name: string;
  category: ItemCategory;
  detail: {
    priceCents: number;
    store: string | null;
    quantity: number | null;
    unit: string | null;
    packs: number;
    brand: string | null;
    /** What the receipt called it — see migration 0039. */
    description: string | null;
    at: number;
  };
}

export interface PlannedReceipt {
  fingerprint: string;
  store: string | null;
  /** Matched to the chain catalogue, or null for a shop we do not know. */
  storeId: string | null;
  purchasedAt: string | null;
  totalCents: number | null;
  currency: string;
  reconciled: boolean;
  depositCents: number;
  discountCents: number;
}

export interface CommitPlan {
  receipt: PlannedReceipt;
  purchases: PlannedPurchase[];
  /** List rows to tick off — matched, included, and not already ticked. */
  tick: string[];
  /**
   * What the receipt taught each matched list row.
   *
   * The import used to write the purchase log and leave the list row exactly as
   * it was, so a shop worth €6,49 imported cleanly and the list still read
   * "€0.00" with an empty quantity — the numbers were in the history and
   * nowhere a person would look for them.
   *
   * The receipt WINS over what was typed. A price entered before shopping is an
   * estimate; the receipt is what the till charged, which is the entire reason
   * for scanning it. `bio` is never touched — that is the shopper's own claim
   * about a product and no receipt knows it.
   */
  patches: { itemId: string; patch: ItemRowPatch }[];
  /**
   * Rows to CREATE, already ticked: receipt lines that matched nothing.
   *
   * Every one of these reached the pantry before and stopped there, which left
   * the two halves of one shop describing different trips — the log knew about
   * the chocolate, the list did not, and the list is what the shopper opens
   * afterwards to see what the import did.
   *
   * Ticked rather than to-buy, obviously: it has been bought. That also means
   * it can never collide, because 0018's unique index covers open rows only.
   */
  adds: NewBoughtRow[];
  /** The instant every purchase is filed under. */
  at: number;
}

/** One row the import creates from scratch. */
export interface NewBoughtRow {
  /** The product name, chosen exactly as a matched purchase's is — see below. */
  name: string;
  category: ItemCategory;
  detail: ItemRowPatch;
}

/**
 * The subset of a list row a receipt is evidence about.
 *
 * ---------------------------------------------------------------------------
 * All five are overwritten, `store` included
 * ---------------------------------------------------------------------------
 *
 * A patch is only ever built for a row the receipt MATCHED — a line the shopper
 * confirmed in the review sheet is this item. At that point the receipt is not
 * a guess about where they shop, it is proof of where this exact thing was
 * bought, and "buy at" showing a different shop is simply out of date.
 *
 * This was briefly the other way round, on the argument that "buy at" is an
 * intention and a receipt is only a record. Recorded here because the argument
 * is not silly and will be made again: what settles it is the MATCH. An
 * unmatched line changes nothing, so the case that worried us — a list quietly
 * changing its mind after one incidental trip — is a case where no patch is
 * written at all.
 *
 * A price typed before shopping is an estimate the till has since corrected;
 * the same is true of a shop chosen before shopping. Both are the shopper's
 * best guess until the receipt says otherwise, and the receipt saying otherwise
 * is the entire reason for scanning it.
 */
export interface ItemRowPatch {
  quantity: number | null;
  /**
   * A LIST unit, not the receipt's own — see listAmount.
   *
   * Typed as ItemUnit rather than string because that is what stopped this
   * being caught: the receipt's units and the list's units are different
   * vocabularies that overlap in four of six places, and a `string` field let
   * one be assigned to the other with nothing to say otherwise.
   */
  unit: ItemUnit | null;
  packs: number;
  priceCents: number;
  /**
   * The chain id, never the printed header — the BUY AT chip tests
   * `item.store === entry.id`, so a header would match no chip and show as a
   * custom shop. Resolved once in planCommit; see the note there.
   */
  store: string | null;
}

/** What the planner needs to know about one row of the list. */
export interface ListRow {
  id: string;
  name: string;
  category: ItemCategory;
  checked: boolean;
}

/**
 * When the shopping happened.
 *
 * The receipt's own printed time, and the clock only when the paper did not
 * give one legibly. Falling back rather than refusing is deliberate: a receipt
 * whose date smudged is still a receipt, and the cost of being a few hours out
 * is that one shop's purchases may be inserted rather than amended — a
 * duplicate row the shopper can see and delete. The cost of refusing is a
 * feature that declines to work for a reason nobody can act on.
 *
 * An unparseable or absurd date is treated as no date at all. A receipt claiming
 * 1970 or 2087 would put a purchase somewhere the history cannot show it, and
 * silently — which is worse than the smudge.
 */
/**
 * The receipt's own measurement, as a list row can store it.
 *
 * ---------------------------------------------------------------------------
 * Two vocabularies that are not the same vocabulary
 * ---------------------------------------------------------------------------
 *
 * A receipt is transcribed in the units tills print: g, kg, ml, l, cl, pcs. A
 * list row is stored in the units the app offers: g, kg, ml, L, pcs. Four of
 * them coincide, which is exactly why nothing noticed the other two.
 *
 * `list_items.unit` has carried a CHECK constraint since migration 0001, so a
 * lowercase "l" is not merely displayed oddly — Postgres rejects the row. And
 * it rejects the whole UPDATE, which is why a litre item lost its PRICE and its
 * PACK COUNT too: quantity, unit, packs and price_cents travel in one statement,
 * and one bad value takes all four down. The optimistic local write then reverts
 * and the row reads exactly as it did before the import.
 *
 * Every symptom follows from that. Spinach in grams imported; the milk in
 * litres did not. The coconut drink, whose line carried no size at all, kept
 * its price and its pack count — a null unit breaks no constraint.
 *
 * The purchase log is untouched by this and must stay so: price_entries.unit is
 * plain text with no constraint, "l" is what the receipt said, and the history
 * card renders "€0.89 / l" from it.
 *
 * ---------------------------------------------------------------------------
 * cl is converted, not dropped
 * ---------------------------------------------------------------------------
 *
 * Centilitres are all over Belgian drinks labelling and the list has no such
 * unit, so 33 cl becomes 330 ml rather than nothing. The quantity scales with
 * the unit or the conversion would silently change the amount — the failure
 * this whole function exists to stop, in a subtler form.
 */
const LIST_UNIT: Record<string, { unit: ItemUnit; scale: number }> = {
  g: { unit: 'g', scale: 1 },
  kg: { unit: 'kg', scale: 1 },
  ml: { unit: 'ml', scale: 1 },
  // The one that broke it: the till prints a lowercase litre, the list stores L.
  l: { unit: 'L', scale: 1 },
  // No centilitre on the list, so it becomes the millilitres it is.
  cl: { unit: 'ml', scale: 10 },
  pcs: { unit: 'pcs', scale: 1 },
};

export function listAmount(
  quantity: number | null,
  unit: string | null,
): { quantity: number | null; unit: ItemUnit | null } {
  // No unit is not a problem to solve. A counted line has none, it breaks no
  // constraint, and its quantity is a pack size that stands on its own.
  if (unit == null) return { quantity, unit: null };

  const known = LIST_UNIT[unit] ?? LIST_UNIT[unit.toLowerCase()];
  /*
   * A unit from neither vocabulary takes the quantity with it. A bare number in
   * the quantity field renders as an amount of nothing, which is a claim, and
   * the honest answer to "how much" here is that we do not know.
   */
  if (!known) return { quantity: null, unit: null };

  return {
    // Rounded because the scale is a multiplication: 33.3 cl times ten is
    // 332.99999999999994 in floating point, and that reaches the screen.
    quantity: quantity == null ? null : Math.round(quantity * known.scale * 1000) / 1000,
    unit: known.unit,
  };
}

export function purchaseInstant(purchasedAt: string | null, now: number): number {
  if (!purchasedAt) return now;
  const parsed = Date.parse(purchasedAt);
  if (!Number.isFinite(parsed)) return now;
  // A year either side. Wide enough for any timezone or clock-skew argument,
  // narrow enough that a misread century cannot land.
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  if (parsed > now + YEAR || parsed < now - YEAR) return now;
  return parsed;
}

export function planCommit(
  receipt: ScannedReceipt,
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
  list: readonly ListRow[],
  now: number,
): CommitPlan {
  const at = purchaseInstant(receipt.purchasedAt, now);
  const byId = new Map(list.map((r) => [r.id, r]));

  /*
   * THE STORE, resolved to a chain id wherever we know one.
   *
   * `receipt.store` is the printed header — "Colruyt Food Retail N.V.",
   * "Carrefour Market Heverlee". Everywhere else in this app a store is either
   * a catalogue id (`colruyt`) or a name the user typed, and the id is what
   * every comparison keys on: the BUY AT chip tests `item.store === entry.id`,
   * and price-intel groups spend and "cheaper elsewhere" by this exact string.
   *
   * So writing the header through would fragment a household's stores the same
   * way a brand inside a name fragments an item — `colruyt` set by hand and
   * `Colruyt Food Retail N.V.` set by a receipt would be two different shops
   * that never compare, in a feature whose entire job is comparing them.
   *
   * The printed text survives on the receipts row, which keeps both: `store`
   * as printed and `store_id` resolved. That is the place for it — it is
   * evidence about one piece of paper, not a key.
   */
  const store = storeIdFor(receipt.store) ?? receipt.store;

  const planned: PlannedPurchase[] = [];
  const tick: string[] = [];
  const patches: { itemId: string; patch: ItemRowPatch }[] = [];
  const adds: NewBoughtRow[] = [];

  for (const p of purchases) {
    const d = decisions.get(p.key);
    if (!d?.include) continue;

    const row = d.itemId != null ? byId.get(d.itemId) : undefined;

    /*
     * THE NAME. This is the single most consequential line in the file.
     *
     * A matched purchase is filed under the LIST's spelling, never the
     * receipt's. The shopper wrote "Eggs"; the till printed "CAR EIREN X30".
     * item_key is the normalised name, and the burn-rate model learns from the
     * gaps between purchases of one key — so filing this under `car eiren x30`
     * would start a second, parallel history that never joins the first, never
     * comes due, and quietly halves the observed frequency of eggs.
     *
     * It also has to survive the store: `CAR EIREN` at Carrefour and `AH EIEREN`
     * at Albert Heijn are the same eggs to a person and two keys to a database.
     * The list's own word is the only spelling stable across both.
     *
     * An unmatched line has no list spelling to borrow, so it uses the model's
     * PRODUCT name — `toast`, not `Provital toast 500 grams`. It is becoming a
     * pantry item, and a pantry item carrying a brand and a pack size matches
     * nothing next month, when the same shopping arrives in a different size
     * from a different shop.
     *
     * Not displayName, which is the full description and belongs in the
     * purchase history; not `p.name`, which is the till's own abbreviated
     * printing including whatever the camera got wrong.
     */
    const name = row?.name ?? productName(p);
    const category = row?.category ?? p.category ?? 'other';
    /*
     * Once, for both the patch and the add, and NOT for the purchase detail
     * below: the log keeps the receipt's own wording ("€0.89 / l") and has no
     * constraint to satisfy, while a list row has both.
     */
    const amount = listAmount(p.quantity, p.unit);

    planned.push({
      key: p.key,
      name,
      category,
      detail: {
        priceCents: d.priceCents,
        store,
        quantity: p.quantity,
        unit: p.unit,
        packs: p.packs,
        brand: p.brand,
        // Only when it differs from the name we are filing under. For an
        // unmatched line those are the same string, and storing it twice would
        // put a description on every row that says nothing.
        // The full description, which is the whole point of keeping it separate
        // from the name: "Douwe Egberts oploskoffie dessert glas 200g" beside a
        // price, under an item called "coffee".
        description: displayName(p) === name ? null : displayName(p),
        at,
      },
    });

    if (row) {
      patches.push({
        itemId: row.id,
        patch: {
          quantity: amount.quantity,
          unit: amount.unit,
          packs: p.packs,
          priceCents: d.priceCents,
          store,
        },
      });
      // Only rows that are not already ticked. `toggleItem` toggles, so calling
      // it on a ticked row would UNtick it — an import that unbuys the shopping.
      if (!row.checked) tick.push(row.id);
    } else {
      /*
       * A line nobody wrote down, going onto the list as already bought.
       *
       * It reached the pantry before this and stopped there, which left the two
       * halves of one shop describing different trips: the log knew about the
       * chocolate, the list did not, and the list is the screen the shopper
       * actually opens afterwards to see what the receipt did. "Added to
       * pantry" said thirteen when fifteen things had been.
       *
       * Same name and same category as the purchase above, from the same two
       * lines, so the row and the pantry item cannot disagree about what was
       * bought. Same detail too — this is where the pack count and the total
       * become visible.
       */
      adds.push({
        name,
        category,
        detail: {
          quantity: amount.quantity,
          unit: amount.unit,
          packs: p.packs,
          priceCents: d.priceCents,
          store,
        },
      });
    }
  }

  return {
    at,
    tick,
    patches,
    adds,
    purchases: planned,
    receipt: {
      fingerprint: receipt.fingerprint,
      store: receipt.store,
      storeId: storeIdFor(receipt.store),
      purchasedAt: receipt.purchasedAt,
      /*
       * What the paper says was paid, kept whether or not the lines agree with
       * it. It is the number the bank saw. Storing the sum of the lines instead
       * would make the mismatch unrecoverable — and the mismatch is the thing
       * worth being able to show.
       */
      totalCents: receipt.paidCents,
      currency: receipt.currency,
      reconciled: receipt.reconciled,
      depositCents: receipt.depositCents,
      discountCents: receipt.discountCents,
    },
  };
}

/* ------------------------------------------------------------- the write -- */

export type CommitOutcome =
  | { kind: 'ok'; receiptId: string }
  /** This household has imported this receipt before. */
  | { kind: 'duplicate' }
  | { kind: 'failed' };

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Claim the receipt, before a single purchase is written.
 *
 * ---------------------------------------------------------------------------
 * Why this goes first, and what that costs
 * ---------------------------------------------------------------------------
 *
 * `unique (household_id, fingerprint)` is what stops the same paper being
 * imported twice, and people DO re-scan — because they are not sure the first
 * one worked, which is precisely the moment a second copy of a week's spending
 * gets written. So the row is inserted first and the purchases only follow if
 * it landed. A conflict means somebody already imported this receipt, and the
 * correct response is to write nothing at all.
 *
 * The cost is real and worth stating: if the app dies between this insert and
 * the last purchase, the receipt is claimed but only partly imported, and a
 * re-scan will be refused. The other order is worse — purchases first would
 * double a household's spending on exactly the retry this exists to survive,
 * and an over-counted price history is invisible, whereas a half-imported
 * receipt is a short list the shopper can see and finish by hand.
 */
export async function claimReceipt(
  householdId: string,
  r: PlannedReceipt,
): Promise<CommitOutcome> {
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      household_id: householdId,
      fingerprint: r.fingerprint,
      store: r.store,
      store_id: r.storeId,
      purchased_at: r.purchasedAt,
      total_cents: r.totalCents,
      currency: r.currency,
      reconciled: r.reconciled,
      deposit_cents: r.depositCents,
      discount_cents: r.discountCents,
    })
    .select('id')
    .single();

  if (error) {
    return error.code === UNIQUE_VIOLATION ? { kind: 'duplicate' } : { kind: 'failed' };
  }
  return { kind: 'ok', receiptId: (data as { id: string }).id };
}
