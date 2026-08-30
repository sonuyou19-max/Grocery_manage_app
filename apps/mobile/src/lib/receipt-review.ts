import type { DecimalMark } from '@/i18n/regions';
import { normaliseNumber } from '@/lib/money';
import type { ListCandidate, MatchOutcome, ReceiptPurchase } from '@/lib/receipt';

/**
 * What the shopper decided about a scanned receipt.
 *
 * ---------------------------------------------------------------------------
 * Separate from the screen, because the screen is not where this can be checked
 * ---------------------------------------------------------------------------
 *
 * Every rule in here is a rule about money landing on the right row of somebody
 * else's data, and every one of them fails silently. A price on the wrong item
 * looks exactly like a price on the right item. So the rules live in functions
 * that can be broken on purpose and shown to complain, rather than in a
 * component where the only test available is looking at it.
 *
 * The state is a Map keyed by purchase, rebuilt on every change rather than
 * mutated. That is not ceremony: `assign` has to reach into ANOTHER entry to
 * release a claim, and doing that in place while React holds the same object is
 * how a screen ends up showing one thing and importing another.
 */

export interface Decision {
  /** Import this line, or leave it out entirely. */
  include: boolean;
  /**
   * What was paid, in cents, across every pack of it.
   *
   * THE TOTAL, and it stays the total even though the screen now offers a
   * per-pack price to edit. The printed total is the part the receipt is
   * actually evidence of, and it is the only figure that can be added up
   * without drift: €2.09 over three packs is 69.67 cents each, and three
   * seventy-cent packs are €2.10. Storing the unit price would make the import
   * a penny out for reasons no one could see.
   *
   * So the unit price is derived for display and for editing — see unitPriceOf
   * and setUnitPrice — and this is what the footer, the reconciliation and the
   * import all read.
   */
  priceCents: number;
  /**
   * How many packs, and editable now: the scan reads it off the multiplier and
   * a till that prints "3" for four bottles is exactly the kind of thing the
   * review screen exists to catch.
   */
  packs: number;
  /** The size of ONE pack, as printed. Null when the line carried no size. */
  quantity: number | null;
  /**
   * That size's unit, in the RECEIPT's vocabulary — g, kg, ml, l, cl, pcs.
   *
   * Not the list's five. The chip shows what the shopper typed or what the till
   * printed, and listAmount converts at the commit boundary, which is the one
   * place that has to satisfy the database's constraint.
   */
  unit: string | null;
  /**
   * The list row this is, or null for "not on the list".
   *
   * Null is an ordinary answer, not a missing one — most of a real shop is not
   * on the list. It means: import it as its own thing, don't tick anything off.
   */
  itemId: string | null;
}

export type Decisions = ReadonlyMap<string, Decision>;

/**
 * The decisions a saved receipt was last imported with.
 *
 * The mirror of `packScan`, and the asymmetry between them is the interesting
 * part. What is persisted is an ITEM KEY — the pantry identity a line was filed
 * under — because a list row id would be a dangling pointer within days of the
 * shop (the sweep deletes checked rows). What this screen's `Decision` holds is
 * an `itemId`, whichever id the CANDIDATE LIST uses. On a reopened receipt the
 * candidates are pantry items keyed by exactly that item key, so the two line
 * up with nothing to translate.
 *
 * A purchase the saved scan has no decision for is included at its printed
 * price and matched to nothing. That is the same starting point a fresh scan
 * gives an unmatched line, and it is the honest reading of a line the last
 * review did not record an opinion about.
 */
export function restoreDecisions(scan: {
  purchases: readonly ReceiptPurchase[];
  decisions: readonly {
    key: string;
    include: boolean;
    priceCents: number;
    packs: number;
    quantity: number | null;
    unit: string | null;
    itemKey: string | null;
  }[];
}): Map<string, Decision> {
  const byKey = new Map(scan.decisions.map((d) => [d.key, d]));
  const out = new Map<string, Decision>();
  for (const p of scan.purchases) {
    const d = byKey.get(p.key);
    out.set(p.key, {
      include: d?.include ?? true,
      priceCents: d?.priceCents ?? p.priceCents,
      packs: d?.packs ?? p.packs,
      quantity: d?.quantity ?? p.quantity,
      unit: d?.unit ?? p.unit,
      itemId: d?.itemKey ?? null,
    });
  }
  return out;
}

/**
 * The starting point: everything in, prices as printed, matches as found.
 *
 * `ambiguous` deliberately starts UNASSIGNED. It is the matcher saying two list
 * rows are equally plausible, and picking one to pre-fill would convert a
 * question into an answer that nobody was asked — the shopper would have to
 * notice a decision had been made for them in order to disagree with it.
 */
export function initialDecisions(
  purchases: readonly ReceiptPurchase[],
  matches: ReadonlyMap<string, MatchOutcome>,
): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const p of purchases) {
    const m = matches.get(p.key);
    out.set(p.key, {
      include: true,
      priceCents: p.priceCents,
      packs: p.packs,
      quantity: p.quantity,
      unit: p.unit,
      itemId: m?.kind === 'matched' ? m.itemId : null,
    });
  }
  return out;
}

/**
 * Fold in matches that arrived after the sheet was already on screen.
 *
 * The AI matcher is a second round trip and the shopper used to wait through it
 * before seeing anything. It runs beside the review now, so its answers land on
 * a sheet somebody may already be working in — which makes "do not undo what
 * they just did" the entire specification.
 *
 * Two rules, and both are refusals:
 *
 *   A purchase that already has an itemId is left alone. Either the matcher
 *   settled it offline before the sheet opened, or the shopper assigned it by
 *   hand; in both cases a late answer is stale by definition, since it was
 *   composed from a question asked before that happened.
 *
 *   A list row already spoken for is not handed out twice. `assign` moves a
 *   claim rather than duplicating it, so an unchecked late answer could silently
 *   take a row off the line the shopper had just put it on — the one edit they
 *   would be most sure they had made.
 *
 * Everything else is a blank being filled, which is all this was ever for.
 */
export function mergeLateMatches(
  d: Decisions,
  matches: ReadonlyMap<string, MatchOutcome>,
): Map<string, Decision> {
  const out = new Map(d);
  const taken = new Set<string>();
  for (const [, decision] of out) {
    if (decision.itemId != null) taken.add(decision.itemId);
  }
  for (const [key, m] of matches) {
    if (m.kind !== 'matched') continue;
    const current = out.get(key);
    if (!current || current.itemId != null) continue;
    if (taken.has(m.itemId)) continue;
    out.set(key, { ...current, itemId: m.itemId });
    taken.add(m.itemId);
  }
  return out;
}

export function setInclude(d: Decisions, key: string, include: boolean): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, include });
  return out;
}

export function setPrice(d: Decisions, key: string, priceCents: number): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, priceCents });
  return out;
}

/**
 * The price of ONE pack, derived rather than stored.
 *
 * Rounded to the nearest cent because that is what a price chip can show, and
 * the rounding is exactly why this is not the stored value: three packs at
 * €2.09 are 69.67 cents each, the chip says €0.70, and three times seventy is
 * €2.10. The total is what gets imported, so the penny stays where the receipt
 * put it.
 */
export function unitPriceOf(d: Decision): number {
  return d.packs > 1 ? Math.round(d.priceCents / d.packs) : d.priceCents;
}

/**
 * Set the per-pack price: the total becomes that price times the packs.
 *
 * This direction is a real edit — the shopper is saying the shelf price was
 * wrong — so the total follows it. The opposite direction (setPacks) does not
 * touch the total, because correcting a miscounted pack does not change what
 * the till charged.
 */
export function setUnitPrice(d: Decisions, key: string, unitCents: number): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, priceCents: unitCents * Math.max(1, current.packs) });
  return out;
}

/**
 * Correct the pack count, keeping the money.
 *
 * "It was four bottles, not three" is a statement about the count and not about
 * the price: the till charged what it charged. So the total is untouched and
 * the per-pack chip re-derives from it — which is the visible effect, and the
 * right one.
 *
 * At least one, always. Zero packs would make unitPriceOf divide by nothing and
 * would mean a purchase of no items, which is what excluding a line is for.
 */
export function setPacks(d: Decisions, key: string, packs: number): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, packs: Math.max(1, Math.round(packs)) });
  return out;
}

/** Set the size of one pack, or clear it back to unknown. */
export function setAmount(
  d: Decisions,
  key: string,
  quantity: number | null,
  unit: string | null,
): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (current) out.set(key, { ...current, quantity, unit });
  return out;
}

/**
 * The units a size chip accepts, in the receipt's own vocabulary.
 *
 * Wider than the list's five on purpose: a shopper copying "33CL" off the
 * bottle in front of them should not have to convert it in their head, and
 * listAmount already turns centilitres into millilitres at the commit boundary.
 */
const TYPED_UNITS = ['g', 'kg', 'ml', 'l', 'cl', 'pcs'] as const;

/**
 * What somebody typed into a size chip.
 *
 * "750g", "1 L", "33cl", "6 pcs" — the shapes printed on packaging, because
 * that is what people are copying from. Returns null for anything it cannot
 * read, which the caller treats as "leave it as it was" rather than as a clear.
 *
 * An empty string is a real answer and a different one: it clears the size,
 * which is how a wrong reading gets removed rather than replaced.
 */
export function parseAmount(
  text: string,
  decimal: DecimalMark,
): { quantity: number | null; unit: string | null } | null {
  const clean = text.trim().toLowerCase();
  if (clean === '') return { quantity: null, unit: null };

  // Marks are validated by normaliseNumber, so this only has to find where
  // the number ends and the unit begins.
  const m = clean.match(/^([\d.,\s]+?)\s*([a-z]*)$/);
  if (!m) return null;

  /*
   * The RECEIPT's convention, through the same normaliser the price field uses.
   *
   * This read both marks as a decimal point, which is right in Belgium and
   * wrong in Britain, where "1,500g" means fifteen hundred grams and was read
   * as one and a half. Sharing normaliseNumber means the size chip and the
   * price chip can never disagree about what a comma is on the same receipt.
   */
  const cleaned = normaliseNumber(m[1]!, decimal);
  if (cleaned == null) return null;
  const quantity = Number(cleaned);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const raw = m[2] ?? '';
  // A bare number keeps whatever unit the row already had; the caller supplies
  // it, so an empty unit here means "unchanged", not "none".
  if (raw === '') return { quantity, unit: null };

  const unit = (TYPED_UNITS as readonly string[]).includes(raw) ? raw : null;
  // A unit nobody recognises is a typo, not an instruction. Refusing the whole
  // edit leaves the old value on screen, which is the honest failure.
  return unit ? { quantity, unit } : null;
}

/**
 * The till's printed lines, with repeats folded together.
 *
 * Four cartons of milk print four identical rows, and the review sheet showed
 * all four — sixty pixels of height to say one thing, on the screen where
 * height is what lets you compare a row against the paper in your hand.
 *
 * The printing itself is never dropped. It is the only thing on the row that is
 * not an interpretation, so it stays visible and checkable; what goes is the
 * repetition. Consecutive runs are NOT what is counted — a till can print the
 * same line twice with something else between — so this counts occurrences and
 * keeps first appearance order.
 */
export function collapseRaw(raw: readonly string[]): { text: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const line of raw) {
    if (!counts.has(line)) order.push(line);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return order.map((text) => ({ text, count: counts.get(text) ?? 1 }));
}

/**
 * Point a receipt line at a list row — and take it off whatever line held it.
 *
 * ---------------------------------------------------------------------------
 * The move, and why it is not an add
 * ---------------------------------------------------------------------------
 *
 * One list row can be claimed once. The matcher enforces that; so does the
 * function; and it has to hold here too, where a PERSON is doing the assigning
 * and the obvious implementation — set this line's itemId — quietly breaks it.
 *
 * Picture the correction that actually happens. The scan put `CAR EIREN X30` on
 * "Eggs" and the shopper knows the eggs are really the line below it. They tap
 * the line below and choose Eggs. If that only sets a field, the receipt now
 * says two different lines are both the eggs, and the import ticks one item off
 * twice with two different prices — from a gesture that meant "not that one,
 * this one".
 *
 * So choosing an already-claimed row MOVES it. The line that had it is left
 * unassigned, which is visible in the sheet as a row that has become "not on
 * your list" and can be corrected in turn. Nothing is lost and nothing is
 * duplicated.
 */
export function assign(d: Decisions, key: string, itemId: string | null): Map<string, Decision> {
  const out = new Map(d);
  const current = out.get(key);
  if (!current) return out;

  if (itemId != null) {
    for (const [otherKey, other] of out) {
      if (otherKey !== key && other.itemId === itemId) {
        out.set(otherKey, { ...other, itemId: null });
      }
    }
  }

  out.set(key, { ...current, itemId });
  return out;
}

/* ----------------------------------------------------------- the groups -- */

export interface ReviewGroups {
  /** Receipt lines pointed at a list row. */
  matched: ReceiptPurchase[];
  /** Receipt lines that are not on the list — most of a real shop. */
  extra: ReceiptPurchase[];
}

export function groupPurchases(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): ReviewGroups {
  const matched: ReceiptPurchase[] = [];
  const extra: ReceiptPurchase[] = [];
  for (const p of purchases) {
    // Excluded lines stay in their group rather than vanishing. A row that
    // disappears when you untick it takes its own untick button with it, and
    // the only way back is to remember what it said.
    if (decisions.get(p.key)?.itemId != null) matched.push(p);
    else extra.push(p);
  }
  return { matched, extra };
}

/**
 * List rows nothing on the receipt claimed.
 *
 * Two quite different things wearing one face — something you did not buy, and
 * something you bought that the scan failed to recognise — and the sheet cannot
 * tell them apart, so it does not try. It shows them and lets the shopper point
 * a line at one.
 */
export function unclaimed(
  list: readonly ListCandidate[],
  decisions: Decisions,
): ListCandidate[] {
  const taken = new Set<string>();
  for (const d of decisions.values()) {
    if (d.itemId != null) taken.add(d.itemId);
  }
  return list.filter((l) => !taken.has(l.id));
}

/**
 * What the import will actually add up to.
 *
 * Only the included lines, because that is the question the footer is
 * answering. It is deliberately NOT compared against the receipt's total to
 * produce a warning: excluding a line is a legitimate thing to do and would
 * trip any such check immediately. The reconciliation warning is about whether
 * the SCAN agrees with the receipt, which is a different claim and has its own
 * banner.
 */
export function includedTotal(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): number {
  let total = 0;
  for (const p of purchases) {
    const d = decisions.get(p.key);
    if (d?.include) total += d.priceCents;
  }
  return total;
}

export function includedCount(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
): number {
  let n = 0;
  for (const p of purchases) if (decisions.get(p.key)?.include) n += 1;
  return n;
}

/** A list row as the picker offers it, and who has it already. */
export interface PickerOption extends ListCandidate {
  /**
   * The OTHER receipt line holding this row, or null when it is free or ours.
   *
   * A key rather than a boolean because the picker names the line: "already on
   * DLZ VOLLE MELK" tells the shopper what their tap is about to move, and
   * "already taken" does not.
   */
  takenBy: string | null;
}

/**
 * The rows this line may be pointed at — which is all of them.
 *
 * ---------------------------------------------------------------------------
 * Why claimed rows are offered too
 * ---------------------------------------------------------------------------
 *
 * This used to return free rows plus the one the line already held, and hiding
 * the rest was the wrong lesson drawn from a real rule. One list row can be
 * claimed once, and that rule holds — but it is `assign` that holds it, by
 * MOVING a row rather than copying it. Leaving the claimed rows out of the
 * picker did not protect anything; it just removed the correction the shopper
 * most needs to make.
 *
 * That correction is the common one. The scan puts the eggs on the line above
 * where they belong, the shopper opens the right line, and Eggs is not there —
 * because the wrong line has it. The only route through was to open the wrong
 * line first, set it to "not on your list", then come back: two corrections to
 * express one intention, and no sign anywhere that this was what to do.
 *
 * So every row is offered, and each says whether another line holds it. Tapping
 * one moves it, `assign` unassigns the line that had it, and that line shows up
 * as "not on your list" to be corrected in turn. Nothing is duplicated, and
 * nothing has to be undone first.
 */
export function pickerOptions(
  candidates: readonly ListCandidate[],
  decisions: Decisions,
  key: string | null,
): PickerOption[] {
  /*
   * Built from the decisions rather than from `unclaimed`, because the picker
   * needs to know WHICH line holds a row and not merely that one does.
   *
   * Include state is deliberately not consulted, exactly as `unclaimed` does not
   * consult it: what a line IS and whether to import it are separate questions,
   * and an unticked line still holds its row.
   */
  const holder = new Map<string, string>();
  for (const [k, d] of decisions) {
    if (d.itemId != null && !holder.has(d.itemId)) holder.set(d.itemId, k);
  }

  return candidates.map((c) => {
    const by = holder.get(c.id) ?? null;
    // Ours is not "taken" — a line holding its own row must read as the current
    // choice, not as a row it would have to steal from itself.
    return { ...c, takenBy: by === null || by === key ? null : by };
  });
}

/**
 * Does the import add up to what the paper says was paid?
 *
 * ---------------------------------------------------------------------------
 * The hole this closes
 * ---------------------------------------------------------------------------
 *
 * The server reconciles the model's lines against the model's own reading of
 * the printed total — which is a real check right up until the model gets both
 * wrong in the same direction. A Delhaize receipt came back with every price
 * from the seventh line onward shifted onto the product above it: every amount
 * genuinely appeared on the paper, the arithmetic was internally consistent,
 * and nothing flagged it. €45.49 was offered for a €48.02 shop.
 *
 * So the last comparison happens here, against the number in front of the
 * shopper, using the amounts they can actually see.
 *
 * It is deliberately silent unless EVERY line is included. Unticking one is a
 * normal thing to do and would trip this on the first tap, which is exactly the
 * reasoning that kept the footer from comparing anything at all until now. The
 * fix is not to compare less; it is to compare only when the comparison means
 * something.
 */
export function offBy(
  purchases: readonly ReceiptPurchase[],
  decisions: Decisions,
  paidCents: number | null,
  depositCents: number,
  discountCents: number,
): number | null {
  if (paidCents == null) return null;
  // Anything left out makes the sums legitimately differ.
  if (includedCount(purchases, decisions) !== purchases.length) return null;

  /*
   * Deposits and discounts are money on the receipt and never purchases, so
   * they are added back before the comparison. Leaving them out would report a
   * gap on every receipt that carried a bottle deposit — a false alarm on a
   * warning whose whole value is that it is rare.
   */
  const expected = paidCents - depositCents - discountCents;
  const diff = includedTotal(purchases, decisions) - expected;
  // A cent or two is rounding on a weighed line, not a misread row.
  return Math.abs(diff) <= 2 ? null : diff;
}
