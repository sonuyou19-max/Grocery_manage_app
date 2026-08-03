import type { ItemCategory, ItemUnit } from '@korb/shared';

import { LOW_THRESHOLD, lifeRemaining, normalizeKey, type ItemStat } from '@/lib/pantry-intel';

/**
 * Recipe import: the maths and the judgements, with no network and no React.
 *
 * The edge function does the fetching and the parsing. Everything a user
 * actually argues with — how a quantity scales, what "already in the pantry"
 * means, what the list ends up called — is decided here, where it can be run in
 * Node and proved.
 */

/** One ingredient as the parser hands it over. */
export interface RecipeItem {
  name: string;
  /** Null is the common case: "salt", "a handful of coriander". */
  quantity: number | null;
  unit: ItemUnit | null;
}

export interface ParsedRecipe {
  name: string;
  /** Null when the source never said. The scaler does not render without it. */
  servings: number | null;
  items: RecipeItem[];
}

/* ------------------------------------------------------------- the title */

/**
 * Recipe pages are titled for search engines, not for shopping lists.
 *
 * "Best Ever Thai Green Curry Recipe | Jenny's Kitchen" is a perfectly ordinary
 * <title>, and saving a list under it would be absurd. This cuts at the
 * separators publishers use for their own name and drops a trailing "recipe",
 * which is the word doing the SEO work.
 *
 * Deliberately conservative. A plain hyphen is NOT a separator here, because
 * real dish names contain them — "Slow-cooked lamb" must survive. The user can
 * still edit the result; this only has to stop the obvious embarrassment.
 */
export function cleanRecipeName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();

  // Publisher suffixes: pipe, en/em dash, or a bullet with spaces around it.
  const cut = name.search(/\s[|•]\s|\s[–—]\s/);
  if (cut > 0) name = name.slice(0, cut).trim();

  // A trailing "recipe" adds nothing to a shopping list's name.
  name = name.replace(/\s+recipes?$/i, '').trim();

  // Bounded so a parser that returns a paragraph cannot become a list title.
  return name.slice(0, 60).trim();
}

/* ---------------------------------------------------------- the scaler */

/**
 * Rounding, per unit, so a scaled recipe reads like something a person wrote.
 *
 * Doubling 3 eggs gives 6; halving them gives 1.5, and "1.5 eggs" on a shopping
 * list is the kind of detail that makes an app feel like a spreadsheet. Whole
 * things round UP — being short of an egg is worse than having a spare — and
 * weights round to a step somebody would actually ask for at a counter.
 *
 * The alternative, showing the raw product, is not neutral: it presents a
 * precision the source recipe never had.
 */
export function scaleQuantity(
  quantity: number,
  unit: string | null,
  factor: number,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return quantity;
  if (!Number.isFinite(factor) || factor <= 0) return quantity;

  const scaled = quantity * factor;

  // Countable things: whole numbers, never zero.
  if (unit == null || unit === 'pcs') return Math.max(1, Math.ceil(scaled - 0.001));

  if (unit === 'g' || unit === 'ml') {
    // Below 100 a 5-unit step is fine detail; above it, 10. Never below 1.
    const step = scaled < 100 ? 5 : 10;
    return Math.max(1, Math.round(scaled / step) * step);
  }

  // kg and L are small numbers where the decimals carry the meaning.
  return Math.round(scaled * 100) / 100;
}

/* --------------------------------------------------- the pantry check */

/**
 * What the pantry knows about an ingredient.
 *
 *   missing  not tracked at all — you need it
 *   stocked  tracked, and Korb thinks you still have some
 *   low      tracked, but due to run out
 *
 * Three states rather than two, and the third is the one that earns its keep.
 * "Do you have garlic" is the wrong question; "will you have enough garlic on
 * Thursday" is the right one, and Korb already models the difference. Defaulting
 * a nearly-empty jar to unchecked sends somebody home without garlic and makes
 * the feature look careless in exactly the way that stops people using it.
 */
export type PantryState = 'missing' | 'stocked' | 'low';

export interface ReviewRow {
  /** Normalized name — the identity used against the pantry and the list. */
  key: string;
  name: string;
  quantity: number | null;
  unit: ItemUnit | null;
  state: PantryState;
  /** Whether it will be added. Seeded from `state`, then the user's to change. */
  checked: boolean;
}

/**
 * Spellings that should find the same pantry item.
 *
 * `normalizeKey` is IDENTITY, not matching: it is what the purchase log, the
 * pantry and the home-list memory key every row on, so it lowercases and
 * collapses whitespace and stops there. Making it singularise would re-key
 * every household's existing history, which is not a trade worth making for
 * one screen.
 *
 * Matching is the looser question, and it is this screen's alone. Recipes say
 * "Onions" and "Tomatoes"; a pantry says whatever the shopper typed when they
 * last checked one off. Without this the feature quietly fails for exactly the
 * ingredients recipes are most likely to list in the plural, and the failure
 * looks like Korb not knowing you own onions.
 *
 * English plurals only. The seven languages Korb ships pluralise in ways a
 * regex cannot follow, and a wrong stem would match the wrong item — a silent
 * error worse than the miss it replaces. The exact key is always tried first,
 * so nothing here can break a match that already worked.
 */
function matchCandidates(key: string): string[] {
  const out = [key];
  if (key.endsWith('ies') && key.length > 4) out.push(`${key.slice(0, -3)}y`);
  if (key.endsWith('es') && key.length > 3) out.push(key.slice(0, -2));
  if (key.endsWith('s') && key.length > 2) out.push(key.slice(0, -1));
  else {
    // The other direction: recipe says "Onion", pantry holds "onions".
    out.push(`${key}s`, `${key}es`);
  }
  return out;
}

/**
 * Match the parsed ingredients against the pantry.
 *
 * Resting items are treated as missing: the user retired them from prediction,
 * so Korb has no current opinion on whether they are in the cupboard.
 */
export function reviewRows(
  items: RecipeItem[],
  stats: Record<string, ItemStat>,
  now: number,
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const name = item.name.trim();
    const key = normalizeKey(name);
    if (!key) continue;
    // A recipe listing "olive oil" twice (for the sauce, for the pan) should
    // produce one row, or the list gains a duplicate nobody typed.
    if (seen.has(key)) continue;
    seen.add(key);

    let stat: ItemStat | undefined;
    for (const candidate of matchCandidates(key)) {
      const found = stats[candidate];
      if (found && !found.archivedAt) {
        stat = found;
        break;
      }
    }

    const state: PantryState = !stat
      ? 'missing'
      : lifeRemaining(stat, now) < LOW_THRESHOLD
        ? 'low'
        : 'stocked';

    rows.push({
      key,
      name,
      quantity: item.quantity,
      unit: item.unit,
      state,
      // Everything except a comfortably stocked item starts checked.
      checked: state !== 'stocked',
    });
  }

  return rows;
}

/** How many rows will actually be added — the number on the button. */
export const checkedCount = (rows: ReviewRow[]): number =>
  rows.filter((r) => r.checked).length;

/** How many the pantry already covers — the number in the summary line. */
export const inPantryCount = (rows: ReviewRow[]): number =>
  rows.filter((r) => r.state !== 'missing').length;

/**
 * Is this text a link rather than a recipe?
 *
 * One input field serves both, and the user should not have to say which —
 * making somebody classify their own paste is asking them to do the computer's
 * job. Anything that parses as http(s) with a host is a URL; everything else is
 * treated as the recipe itself.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Category is resolved on the client at add time, so this stays a pure lib. */
export type Categorize = (name: string) => ItemCategory;
