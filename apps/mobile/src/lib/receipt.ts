import type { ItemCategory } from '@korb/shared';

import { canonicalize, emojiFor, fold, CATEGORY_EMOJI } from '@/lib/item-emoji';
import { samePlural } from '@/lib/item-plural';
import { normalizeKey } from '@/lib/pantry-intel';
import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

/**
 * What a scanned receipt turns into, before anybody looks at it.
 *
 * Two jobs live here, and they are separate on purpose:
 *
 *   GROUPING  turns printed LINES into purchases. A till prints what it prints
 *             — Aldi lists two avocados as two rows, Carrefour prints one row
 *             saying ×2 — and the same shopping must reach the pantry the same
 *             way whichever shop it came from.
 *
 *   MATCHING  decides which purchase is which row of the user's list. Free
 *             where it can be, and honest about the rest: a residue goes to a
 *             model, and the residue shrinks on its own as the shared lexicon
 *             learns what tills call things.
 *
 * Both are pure functions over data, tested directly in check-receipt-match.
 * The network call at the bottom is the only part that is not.
 */

/* -------------------------------------------------------------- the wire -- */

export type LineKind = 'item' | 'deposit' | 'discount' | 'rounding' | 'other';

/** One printed line, as receipt-scan returns it. */
export interface ScannedLine {
  raw: string;
  kind: LineKind;
  name: string | null;
  expanded: string | null;
  translated: string | null;
  brand: string | null;
  section: string | null;
  multiplier: number | null;
  multiplierDp: number | null;
  unit: string | null;
  packSize: number | null;
  packUnit: string | null;
  unitPriceCents: number | null;
  unitPriceDp: number | null;
  totalCents: number;
  emoji: string | null;
  category: ItemCategory | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ScannedReceipt {
  store: string | null;
  purchasedAt: string | null;
  currency: string;
  language: string | null;
  fingerprint: string;
  model: string;
  /** Did the parse agree with the totals the receipt prints about itself? */
  reconciled: boolean;
  problems: string[];
  badLines: number[];
  goodsCents: number;
  depositCents: number;
  discountCents: number;
  paidCents: number;
  articleCount: number | null;
  lines: ScannedLine[];
}

/* ------------------------------------------------------------- grouping -- */

/** One thing bought, however many lines the till spent printing it. */
export interface ReceiptPurchase {
  /** Stable within one scan, for React keys and the match map. */
  key: string;
  /** Every printed line this came from. Shown in the review, always. */
  raw: string[];
  name: string;
  expanded: string | null;
  translated: string | null;
  brand: string | null;
  section: string | null;
  packs: number;
  quantity: number | null;
  unit: string | null;
  /** Summed across the grouped lines. What was actually paid for them. */
  priceCents: number;
  emoji: string | null;
  category: ItemCategory | null;
  confidence: 'high' | 'medium' | 'low';
}

const isMeasure = (l: ScannedLine): boolean =>
  l.unit != null || (l.multiplier != null && !Number.isInteger(l.multiplier));

/**
 * Printed lines → purchases.
 *
 * ---------------------------------------------------------------------------
 * Why grouping happens HERE and not in the extractor
 * ---------------------------------------------------------------------------
 *
 * The model is told to transcribe every printing exactly once, and to merge
 * only what two overlapping photographs show twice. That is deliberate: two
 * `trs turmeric powder 100gr` lines on one receipt are two real purchases, and
 * the same line seen in two photos is one — and the article count can only
 * check the transcription if the transcription is literal.
 *
 * So merging happens after the arithmetic has passed, where it is reversible
 * and where being wrong costs a row in a review sheet rather than a failed
 * reconciliation nobody can explain.
 *
 * ---------------------------------------------------------------------------
 * Grouped on the RAW line, exactly
 * ---------------------------------------------------------------------------
 *
 * Not on the expansion, and not on any of the fuzzy keys used for matching. A
 * till prints one string per product, so exact equality is precisely right
 * here.
 *
 * The keys used for matching are lossy in exactly the way that would be wrong.
 * canonicalize strips store-tier words — basic, extra, premium — because for
 * MATCHING they are noise between a receipt line and a shopping list. For
 * GROUPING they are the whole difference: `EVERYDAY melk basic` and `EVERYDAY
 * melk extra` are two products at two prices, and merging them would invent a
 * unit price neither was sold at. Same for samePlural, which exists to collapse
 * a distinction the till never makes within one receipt.
 */
export function groupLines(lines: ScannedLine[]): ReceiptPurchase[] {
  const byKey = new Map<string, ReceiptPurchase>();
  const order: string[] = [];

  lines.forEach((line, i) => {
    // Deposits, discounts and rounding are money, not shopping. They belong to
    // the receipt row, never to the pantry.
    if (line.kind !== 'item') return;

    const measure = isMeasure(line);
    /*
     * The kind is part of the key, so a weighed line and a counted one never
     * merge even if a till somehow printed them identically. Summing a weight
     * into a pack count would produce a purchase of "1.9 packs".
     */
    const key = `${normalizeKey(line.raw)}|${measure ? 'm' : 'c'}`;
    const existing = byKey.get(key);

    if (!existing) {
      order.push(key);
      byKey.set(key, {
        key: `${key}#${i}`,
        raw: [line.raw],
        name: line.name ?? line.raw,
        expanded: line.expanded,
        translated: line.translated,
        brand: line.brand,
        section: line.section,
        packs: measure ? 1 : Math.max(1, Math.round(line.multiplier ?? 1)),
        quantity: measure ? line.multiplier : line.packSize,
        unit: measure ? line.unit : line.packUnit,
        priceCents: line.totalCents,
        emoji: line.emoji,
        category: line.category,
        confidence: line.confidence,
      });
      return;
    }

    existing.raw.push(line.raw);
    existing.priceCents += line.totalCents;
    if (measure) {
      // Two weighed rows of the same thing are one heavier purchase.
      existing.quantity = (existing.quantity ?? 0) + (line.multiplier ?? 0);
    } else {
      existing.packs += Math.max(1, Math.round(line.multiplier ?? 1));
    }
    // The least certain line decides: a purchase is only as trustworthy as the
    // worst row it was assembled from.
    if (line.confidence === 'low') existing.confidence = 'low';
    else if (line.confidence === 'medium' && existing.confidence === 'high') {
      existing.confidence = 'medium';
    }
  });

  return order.map((k) => byKey.get(k)!);
}

/* ------------------------------------------------------------- matching -- */

export interface ListCandidate {
  id: string;
  name: string;
  category: ItemCategory;
}

export type MatchOutcome =
  | { kind: 'matched'; itemId: string; how: string }
  /** More than one list row is equally plausible. A question, not an answer. */
  | { kind: 'ambiguous'; itemIds: string[] }
  | { kind: 'unmatched' };

/** Resolved glyph, or null when the name only reached its category fallback. */
function glyph(name: string, category: ItemCategory = 'other'): string | null {
  const e = emojiFor(name, category);
  return e === CATEGORY_EMOJI[category] ? null : e;
}

/**
 * Which list row is this purchase, if any.
 *
 * ---------------------------------------------------------------------------
 * Four free rungs, then a paid one somewhere else
 * ---------------------------------------------------------------------------
 *
 * Measured against twenty-four real lines from five receipts and a plausible
 * English list, these four settle a little over half. The rest go to the model,
 * and that share shrinks by itself: every high-confidence line the extractor
 * reads teaches the shared lexicon what the till calls things, so `CAR EIREN
 * X30` resolves to 🥚 offline once three households have scanned a Carrefour
 * receipt, and rung four then matches it for nothing.
 *
 * Each rung is tried against the raw line, the expansion AND the translation,
 * because they fail differently: `komkommer` is in the curated table and
 * `CAR EIREN` is not, while an expansion reaches an English list a raw Dutch
 * line never would.
 *
 * ---------------------------------------------------------------------------
 * Why the glyph rung refuses to guess
 * ---------------------------------------------------------------------------
 *
 * The curated table maps a word to an EMOJI, not to a concept. It knows
 * `komkommer` and `cucumber` are both 🥒; it does not know that `spinach` and
 * `lettuce` are different things that share 🥬. Against a whole vocabulary that
 * would be far too loose — but the candidate set here is one shopping list, a
 * dozen rows, and within that a shared glyph is strong evidence.
 *
 * Strong, not conclusive. Two list rows sharing a glyph — `Paneer` and
 * `Cheese`, both 🧀 — is a question, so it returns `ambiguous` and lets the
 * model decide rather than picking whichever sorted first.
 */
export function matchPurchases(
  purchases: ReceiptPurchase[],
  list: ListCandidate[],
): Map<string, MatchOutcome> {
  const out = new Map<string, MatchOutcome>();
  /*
   * One list row can only be claimed once.
   *
   * Two receipt lines that both look like "Eggs" are two purchases, not one
   * matched twice — and letting the second overwrite the first would silently
   * discard a real purchase. First claim wins; the rest fall through to the
   * model, or arrive as new items, which is the honest outcome.
   */
  const claimed = new Set<string>();

  for (const p of purchases) {
    // Widest first: the till's own wording, then what it means, then what it
    // means in the reader's language.
    const names = [p.name, p.expanded, p.translated].filter((n): n is string => !!n);
    const free = list.filter((l) => !claimed.has(l.id));

    let hit: { itemId: string; how: string } | null = null;

    for (const n of names) {
      const exact = free.find((l) => normalizeKey(n) === normalizeKey(l.name));
      if (exact) { hit = { itemId: exact.id, how: 'exact' }; break; }
    }
    if (!hit) {
      for (const n of names) {
        const plural = free.find((l) => samePlural(n, l.name));
        if (plural) { hit = { itemId: plural.id, how: 'plural' }; break; }
      }
    }
    if (!hit) {
      for (const n of names) {
        // canonicalize strips marketing and provenance words — organic, premium,
        // free-range — which is most of what a brand-heavy receipt line is.
        const key = canonicalize(fold(n));
        const canon = free.find((l) => canonicalize(fold(l.name)) === key);
        if (canon) { hit = { itemId: canon.id, how: 'canonical' }; break; }
      }
    }

    if (hit) {
      claimed.add(hit.itemId);
      out.set(p.key, { kind: 'matched', ...hit });
      continue;
    }

    // Rung four. The purchase's own glyph — from the extractor when it offered
    // one, else resolved from its names.
    const g =
      p.emoji ??
      names.map((n) => glyph(n, p.category ?? 'other')).find((x): x is string => x != null) ??
      null;

    if (g) {
      const sharing = free.filter((l) => glyph(l.name, l.category) === g);
      if (sharing.length === 1) {
        claimed.add(sharing[0]!.id);
        out.set(p.key, { kind: 'matched', itemId: sharing[0]!.id, how: `glyph ${g}` });
        continue;
      }
      if (sharing.length > 1) {
        out.set(p.key, { kind: 'ambiguous', itemIds: sharing.map((l) => l.id) });
        continue;
      }
    }

    out.set(p.key, { kind: 'unmatched' });
  }

  return out;
}

/** Everything the model still has to decide, and nothing it does not. */
export function residue(
  purchases: ReceiptPurchase[],
  matches: Map<string, MatchOutcome>,
): ReceiptPurchase[] {
  return purchases.filter((p) => matches.get(p.key)?.kind !== 'matched');
}

/* ------------------------------------------------- the model's answers ---- */

export interface AiMatch {
  key: string;
  itemId: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Fold the model's answers into the offline result.
 *
 * ---------------------------------------------------------------------------
 * Every rule here refuses something, and that is the design
 * ---------------------------------------------------------------------------
 *
 * The function already drops ids it never sent and second claims on ids it did.
 * This does the same again, on the device, and the repetition is deliberate: a
 * mismatched line is invisible. A price on the wrong row of a list looks
 * exactly like a price on the right one, and it goes on poisoning that item's
 * comparisons for as long as the history is kept. An UNMATCHED line, by
 * contrast, is a row in the review sheet somebody corrects in a second.
 *
 * So the asymmetry is priced in: refusing a good match costs one tap, accepting
 * a bad one costs a number nobody will ever question.
 *
 * The offline rungs win outright over the model. They are deterministic, they
 * were free, and — for exact and plural matches — they are not judgement calls
 * at all. A model disagreeing with `normalizeKey` equality is a model that is
 * wrong.
 */
export function applyAiMatches(
  matches: Map<string, MatchOutcome>,
  answers: readonly AiMatch[],
  list: readonly ListCandidate[],
): Map<string, MatchOutcome> {
  const out = new Map(matches);
  const known = new Set(list.map((l) => l.id));
  // Seeded with whatever the offline rungs already took, so the model cannot
  // hand a second line an item that is spoken for.
  const claimed = new Set(
    [...matches.values()].flatMap((m) => (m.kind === 'matched' ? [m.itemId] : [])),
  );

  for (const a of answers) {
    const current = out.get(a.key);
    if (!current) continue;
    if (current.kind === 'matched') continue;
    if (a.itemId == null) continue;
    if (!known.has(a.itemId)) continue;
    if (claimed.has(a.itemId)) continue;

    claimed.add(a.itemId);
    out.set(a.key, { kind: 'matched', itemId: a.itemId, how: `ai ${a.confidence}` });
  }

  return out;
}

/* ---------------------------------------------------------------- wire ---- */

/**
 * Send the photographs and get the receipt back.
 *
 * Returns null on anything at all — an unreachable function, a refusal from the
 * rate cap, a receipt the model could not read. The caller shows one message
 * for all of them, because the difference is not actionable at a till: the
 * answer is always to try a clearer photograph or to type it in.
 */
export async function scanReceipt(
  images: { media: string; data: string }[],
  language: string,
): Promise<ScannedReceipt | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/receipt-scan`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({ images, language }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ScannedReceipt;
  } catch {
    return null;
  }
}

/**
 * Ask the model about whatever the free rungs could not settle.
 *
 * Returns an empty list on any failure, so a matcher that is down or refused by
 * the rate cap leaves every line unmatched rather than failing the import. The
 * review sheet shows them as new items and the shopper fixes the two that
 * matter.
 */
export async function matchResidue(
  purchases: readonly ReceiptPurchase[],
  list: readonly ListCandidate[],
  claimed: ReadonlySet<string>,
  language: string,
): Promise<AiMatch[]> {
  // Nothing to ask about, or nothing to choose from. Both are ordinary — a
  // receipt where every line matched, or a list already fully spoken for.
  const free = list.filter((l) => !claimed.has(l.id));
  if (purchases.length === 0 || free.length === 0) return [];

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/receipt-match`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({
        language,
        // Only what the matcher needs. The prices are not sent: they are
        // nothing to do with which item a line is, and a payload carrying a
        // household's spending to answer a naming question is a worse trade
        // than a slightly less informed model.
        lines: purchases.map((p) => ({
          key: p.key,
          raw: p.raw[0] ?? p.name,
          expanded: p.expanded,
          translated: p.translated,
          brand: p.brand,
          section: p.section,
        })),
        candidates: free.map((l) => ({ id: l.id, name: l.name })),
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches?: AiMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

/** The list rows the offline rungs have already taken. */
export function claimedIds(matches: Map<string, MatchOutcome>): Set<string> {
  return new Set([...matches.values()].flatMap((m) => (m.kind === 'matched' ? [m.itemId] : [])));
}
