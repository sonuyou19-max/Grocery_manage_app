import type { ItemCategory } from '@korb/shared';

import { reportWriteFailure } from '@/lib/monitoring';
import { normalizeKey } from '@/lib/pantry-intel';
import type { ReceiptPurchase, ScannedReceipt } from '@/lib/receipt';
import type { Decisions } from '@/lib/receipt-review';
import { supabase } from '@/lib/supabase';

/**
 * A scanned receipt, kept so it can be opened again.
 *
 * ---------------------------------------------------------------------------
 * What could not be recovered without this
 * ---------------------------------------------------------------------------
 *
 * Before this file, importing a receipt wrote purchases and threw the reading
 * away. `price_entries` is not a record of the receipt — it is a record of the
 * lines that were IMPORTED, filed under the shopper's own words. Everything a
 * correction needs is in the gap between those two things:
 *
 *   - lines that were left out, which is the half somebody reopens a receipt to
 *     put back;
 *   - lines the matcher could not place, which never became a purchase at all;
 *   - the printed text of every line, which is the only evidence of what the
 *     till actually said and the only thing a person can check a correction
 *     against;
 *   - deposits and discounts, which are deliberately not purchases;
 *   - and which convention the paper wrote its decimals in, without which a
 *     price typed into the reopened sheet would be read in the phone's
 *     convention rather than the receipt's.
 *
 * ---------------------------------------------------------------------------
 * A saved decision points at an ITEM, never at a list row
 * ---------------------------------------------------------------------------
 *
 * This is the one thing that had to be got right at the schema, because it
 * cannot be fixed afterwards.
 *
 * During a live review, "matched" means a row on the shopping list — that is
 * what the shopper is looking at and what gets ticked. Storing that id would
 * make every saved receipt rot: the sweep deletes checked rows once the shop is
 * over (see lib/list-sweep), so within days the saved match would point at
 * nothing, and a receipt reopened a fortnight later would show every line as
 * unmatched with no way to tell a real skip from a dangling pointer.
 *
 * So what is persisted is the OUTCOME — the item key, the spelling and the
 * category the line was actually filed under. Those are what the purchase log
 * is keyed on, they are stable for as long as the household keeps buying the
 * thing, and they are the only answer that still means something in a month.
 * It also decides what re-matching offers on a reopened receipt: the pantry,
 * not a shopping list that no longer exists.
 */

/**
 * The document's own version.
 *
 * Inside the blob rather than in a column because it describes the DOCUMENT,
 * and a receipt written by an older build has to be readable by a newer one
 * without a migration that would have to understand every past shape. `unpack`
 * refuses anything it does not recognise and the screen says "this one cannot
 * be reopened", which is a worse outcome than reading it and a much better one
 * than a crash on a screen about somebody's money.
 */
export const SCAN_VERSION = 1;

export interface SavedDecision {
  /** The purchase this is about, keyed within the scan. */
  key: string;
  include: boolean;
  /** The total across every pack, in cents — the same figure Decision holds. */
  priceCents: number;
  packs: number;
  quantity: number | null;
  unit: string | null;
  /**
   * The pantry item this line was filed under, normalised. Null when the line
   * was left out of the import.
   */
  itemKey: string | null;
  /** The spelling it was filed under — the list's word, or the product name. */
  name: string | null;
  category: ItemCategory | null;
}

export interface SavedScan {
  version: number;
  receipt: ScannedReceipt;
  purchases: ReceiptPurchase[];
  decisions: SavedDecision[];
}

/** One receipt in the household's history. */
export interface ReceiptSummary {
  id: string;
  store: string | null;
  storeId: string | null;
  purchasedAt: number | null;
  scannedAt: number;
  editedAt: number | null;
  totalCents: number | null;
  currency: string;
  reconciled: boolean;
  /** False for receipts imported before the scan was kept — see SCAN_VERSION. */
  reopenable: boolean;
}

/* ------------------------------------------------------------------ pack -- */

/**
 * The document to store, from the state the review screen is holding.
 *
 * `filed` carries what each included line was actually written to the log as,
 * which the review screen does not itself know — planCommit resolves it, from
 * the list row when there was one and from the product name when there was not.
 * Passing it in rather than recomputing it here is deliberate: two places
 * deciding what a line is called is exactly how a saved receipt comes to
 * disagree with the purchases it wrote.
 */
export function packScan(
  receipt: ScannedReceipt,
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
  filed: readonly { key: string; name: string; category: ItemCategory }[],
): SavedScan {
  const byKey = new Map(filed.map((f) => [f.key, f]));
  const saved: SavedDecision[] = [];

  for (const p of purchases) {
    const d = decisions.get(p.key);
    if (!d) continue;
    const f = byKey.get(p.key);
    saved.push({
      key: p.key,
      include: d.include,
      priceCents: d.priceCents,
      packs: d.packs,
      quantity: d.quantity,
      unit: d.unit,
      // Only an INCLUDED line has been filed anywhere. An excluded one has no
      // item, and inventing one from the name it would have had would make a
      // reopened receipt show a match the log has no row for.
      itemKey: f ? normalizeKey(f.name) : null,
      name: f?.name ?? null,
      category: f?.category ?? null,
    });
  }

  return { version: SCAN_VERSION, receipt, purchases: [...purchases], decisions: saved };
}

/* ---------------------------------------------------------------- unpack -- */

/*
 * Hand-written validation, and the shape of it is the point.
 *
 * Everything below asks "is this the type I need" and answers null rather than
 * throwing, because the value comes out of a database column that a previous
 * build wrote and a future one will have to read. The failure that matters is
 * not a corrupt row — it is a shape that changed — and the correct response to
 * both is the same: this receipt cannot be reopened, say so, leave the imported
 * purchases exactly as they are.
 */
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function unpackDecision(v: unknown): SavedDecision | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const key = str(o.key);
  const priceCents = num(o.priceCents);
  if (key == null || priceCents == null) return null;
  return {
    key,
    include: bool(o.include),
    priceCents,
    // A pack count of zero or less would divide into the unit price. One is the
    // only safe reading of a number that should not have survived a write.
    packs: Math.max(1, Math.round(num(o.packs) ?? 1)),
    quantity: num(o.quantity),
    unit: str(o.unit),
    itemKey: str(o.itemKey),
    name: str(o.name),
    category: (str(o.category) as ItemCategory | null) ?? null,
  };
}

/**
 * Read a stored scan back, or null when it cannot be trusted.
 *
 * The three refusals are all versions of the same one: without purchases there
 * is nothing to draw, without a receipt there is no header, no total and no
 * decimal convention, and an unrecognised version means the fields below are
 * being read against a shape they were not written in.
 */
export function unpackScan(value: unknown): SavedScan | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (num(o.version) !== SCAN_VERSION) return null;

  const receipt = o.receipt;
  if (!receipt || typeof receipt !== 'object') return null;
  const purchases = arr(o.purchases);
  if (purchases.length === 0) return null;

  const decisions = arr(o.decisions)
    .map(unpackDecision)
    .filter((d): d is SavedDecision => d != null);

  return {
    version: SCAN_VERSION,
    // Trusted by shape as a whole, because it was written by this app's own
    // packScan and every field on it is already optional-tolerant at the point
    // of use. The three above are the ones the screen cannot open without.
    receipt: receipt as ScannedReceipt,
    purchases: purchases as ReceiptPurchase[],
    decisions,
  };
}

/* ------------------------------------------------------------- the store -- */

const toMs = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * This household's receipts, newest shopping first.
 *
 * Ordered by `purchased_at` rather than `scanned_at`: the list answers "what
 * did we buy and when", and a stack of old receipts caught up on one evening
 * would otherwise arrive in the order somebody happened to photograph them.
 * Nulls last, because a receipt whose date could not be read still has to
 * appear somewhere and the top of the list is the wrong place for it.
 */
export async function listReceipts(
  householdId: string,
  limit = 50,
): Promise<ReceiptSummary[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select(
      'id, store, store_id, purchased_at, scanned_at, edited_at, total_cents, currency, reconciled, scan',
    )
    .eq('household_id', householdId)
    .order('purchased_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    store: str(r.store),
    storeId: str(r.store_id),
    purchasedAt: toMs(r.purchased_at),
    scannedAt: toMs(r.scanned_at) ?? 0,
    editedAt: toMs(r.edited_at),
    totalCents: num(r.total_cents),
    currency: str(r.currency) ?? 'EUR',
    reconciled: bool(r.reconciled),
    // Asked of the column here rather than by unpacking every blob in the
    // list: this runs for fifty receipts to draw one screen, and the full
    // validation happens when one is actually opened.
    reopenable: r.scan != null,
  }));
}

/** One receipt's stored scan, or null when it is missing or unreadable. */
export async function loadScan(receiptId: string): Promise<SavedScan | null> {
  const { data, error } = await supabase
    .from('receipts')
    .select('scan')
    .eq('id', receiptId)
    .maybeSingle();

  if (error || !data) return null;
  return unpackScan((data as { scan: unknown }).scan);
}

/**
 * Write the scan onto its receipt.
 *
 * Separate from `claimReceipt` rather than part of the insert, and the reason
 * is worth stating: the insert is the DEDUPLICATION — it is the statement that
 * this household has now imported this piece of paper, and it must not grow a
 * second way to fail. A blob that is too large or a column that does not exist
 * yet on a stale device would otherwise turn a successful import into a
 * duplicate error on the retry.
 *
 * So this is best-effort and its failure is survivable: the purchases are
 * already written, the receipt is already claimed, and what is lost is only the
 * ability to reopen it. Reported rather than swallowed, because "nobody can
 * edit their receipts" is precisely the kind of silent degradation that gets
 * noticed months later.
 */
export async function saveScan(
  receiptId: string,
  scan: SavedScan,
  edited: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('receipts')
    .update({
      scan,
      // Only on a correction. Stamping it on the first import would make every
      // receipt look edited, and the list draws the difference.
      ...(edited ? { edited_at: new Date().toISOString() } : {}),
    })
    .eq('id', receiptId);

  reportWriteFailure('receipts.scan', error);
}

/**
 * The receipt-level figures, rewritten after a correction.
 *
 * Only the ones a correction can move. The fingerprint, the store and the
 * printed total are properties of the PAPER — they do not change because
 * somebody fixed a price, and a correction that could rewrite the fingerprint
 * could smuggle a second import of the same receipt past the unique index.
 */
export async function saveReconciled(
  receiptId: string,
  reconciled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('receipts')
    .update({ reconciled })
    .eq('id', receiptId);
  reportWriteFailure('receipts.reconciled', error);
}
