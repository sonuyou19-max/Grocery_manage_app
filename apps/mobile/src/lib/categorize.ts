import AsyncStorage from '@react-native-async-storage/async-storage';

import { asUnit, type FoodGroup, type ItemCategory, type ItemUnit } from '@korb/shared';

import { categoryFromTables } from '@/lib/item-category';
import { fold } from '@/lib/item-emoji';
import { learnLexiconEntry } from '@/lib/item-lexicon';
import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

/** Display labels + store-aisle ordering for categories. */
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  fruit_veg: 'Fruit & Veg',
  dairy_eggs: 'Dairy & Eggs',
  meat_fish: 'Meat & Fish',
  bakery: 'Bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  drinks: 'Drinks',
  household: 'Household',
  personal_care: 'Personal Care',
  other: 'Other',
};

/** Localized category label. CATEGORY_LABELS above stays as the English source
 * (and dev fallback); screens render via this with the active translator. */
export function categoryLabel(
  cat: ItemCategory,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return t(`category.${cat}`);
}

/** Order items appear in — roughly a supermarket walk. */
export const CATEGORY_ORDER: ItemCategory[] = [
  'fruit_veg',
  'bakery',
  'dairy_eggs',
  'meat_fish',
  'frozen',
  'pantry',
  'drinks',
  'household',
  'personal_care',
  'other',
];

/**
 * English-only supplements to the curated table.
 *
 * This used to BE the category map, all 55 words of it, while ITEM_EMOJI and
 * ITEM_UNIT carried 646 and 189 terms across seven languages. That mismatch is
 * why "crème" showed up under Other with the right emoji and the right unit
 * beside it — see lib/item-category.ts.
 *
 * What is left here is the handful of concepts the emoji table has no glyph
 * for, plus a few English words whose aisle differs from what their glyph would
 * suggest. Anything with an emoji gets its category from that; add new words to
 * ITEM_EMOJI instead of here, and every language benefits at once.
 */
const KEYWORDS: Record<string, ItemCategory> = {
  milk: 'dairy_eggs',
  cheese: 'dairy_eggs',
  butter: 'dairy_eggs',
  egg: 'dairy_eggs',
  eggs: 'dairy_eggs',
  yogurt: 'dairy_eggs',
  yoghurt: 'dairy_eggs',
  cream: 'dairy_eggs',
  gouda: 'dairy_eggs',
  apple: 'fruit_veg',
  apples: 'fruit_veg',
  banana: 'fruit_veg',
  tomato: 'fruit_veg',
  tomatoes: 'fruit_veg',
  potato: 'fruit_veg',
  potatoes: 'fruit_veg',
  onion: 'fruit_veg',
  lettuce: 'fruit_veg',
  carrot: 'fruit_veg',
  basil: 'fruit_veg',
  spinach: 'fruit_veg',
  cucumber: 'fruit_veg',
  chicken: 'meat_fish',
  beef: 'meat_fish',
  pork: 'meat_fish',
  fish: 'meat_fish',
  salmon: 'meat_fish',
  meat: 'meat_fish',
  ham: 'meat_fish',
  bread: 'bakery',
  sourdough: 'bakery',
  baguette: 'bakery',
  croissant: 'bakery',
  bun: 'bakery',
  pasta: 'pantry',
  rice: 'pantry',
  flour: 'pantry',
  oil: 'pantry',
  coffee: 'pantry',
  tea: 'pantry',
  sugar: 'pantry',
  cereal: 'pantry',
  beans: 'pantry',
  water: 'drinks',
  juice: 'drinks',
  wine: 'drinks',
  beer: 'drinks',
  soda: 'drinks',
  toilet: 'household',
  paper: 'household',
  detergent: 'household',
  dish: 'household',
  soap: 'personal_care',
  shampoo: 'personal_care',
  toothpaste: 'personal_care',
};

/**
 * Learned categories — words the AI (or the user) has already resolved. This
 * cache is why we don't re-ask the model for the same item and burn tokens.
 * Hydrated from AsyncStorage at startup, kept in memory for sync lookups.
 */
const CACHE_KEY = 'korb.categoryCache.v1';
let learned: Record<string, ItemCategory> = {};

/**
 * The cache key. `fold`, not `toLowerCase` — it strips accents and ligatures,
 * so "Crème", "creme" and "CRÈME" are one entry rather than three, and a
 * learned answer is actually found again by somebody who types the accent.
 */
const norm = (name: string) => fold(name);

export async function hydrateCategoryCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) learned = JSON.parse(raw);
  } catch {
    // ignore corrupt cache
  }
}

/** Remember a resolved category so future adds skip both keywords and AI. */
export async function learnCategory(name: string, category: ItemCategory): Promise<void> {
  learned[norm(name)] = category;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(learned));
  } catch {
    // best-effort persistence
  }
}

/**
 * The curated answer for a name, or null.
 *
 * Multilingual table first — it covers every term the app has an emoji for, in
 * all seven languages — then the English supplements above. Whole name before
 * word-by-word in both, so a compound never loses to one of its parts.
 */
function keywordMatch(name: string): ItemCategory | null {
  const fromTables = categoryFromTables(name);
  if (fromTables) return fromTables;

  const folded = norm(name);
  if (KEYWORDS[folded]) return KEYWORDS[folded];
  for (const word of folded.split(/[\s,./-]+/)) {
    if (KEYWORDS[word]) return KEYWORDS[word];
  }
  return null;
}

/** True when we can categorize without asking the AI. */
export function isKnown(name: string): boolean {
  return Boolean(learned[norm(name)]) || keywordMatch(name) != null;
}

/**
 * Instant, synchronous best guess: learned cache first, then keywords,
 * else 'other'. Unknown items show under 'Other' immediately while the AI
 * resolves the real category in the background.
 */
export function categorizeSync(name: string): ItemCategory {
  return learned[norm(name)] ?? keywordMatch(name) ?? 'other';
}

/**
 * Ask the categorize edge function to classify an unknown item. Returns the
 * category plus a coarse food group (for the basket-balance insight) in one
 * call, or null when the backend isn't reachable so the caller leaves the item
 * under 'Other'. Older deployments return only a category — group and emoji are
 * both optional, so a client that has been updated ahead of the function keeps
 * working exactly as it did.
 *
 * The same response also carries an emoji and a unit, which are filed into the
 * on-device lexicon here rather than by every caller. The server may not
 * publish that term to other customers for a while — it waits for three
 * independent sightings — but the person who paid for this call should never
 * pay twice.
 */
export async function resolveCategoryAsync(
  name: string,
): Promise<{ category: ItemCategory; group: FoodGroup | null; unit: ItemUnit | null } | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/categorize`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      category?: ItemCategory;
      group?: FoodGroup | null;
      emoji?: string | null;
      unit?: string | null;
    };
    if (!data.category) return null;
    // A function deployed before units existed simply omits the field, which
    // lands as null — "not established" — and the caller falls through to the
    // curated table. No version negotiation needed.
    const unit = asUnit(data.unit);
    // Structural sanity only. The allowlist check that actually matters ran
    // server-side before this value was allowed anywhere near the shared table
    // (functions/_shared/emoji-allowlist.ts); re-listing 200 glyphs here would
    // just be a second copy to drift out of step. This guards against a
    // malformed response, not against a hostile one.
    if (typeof data.emoji === 'string' && data.emoji.length > 0 && data.emoji.length <= 8) {
      learnLexiconEntry(fold(name), data.emoji, data.category, unit);
    }
    return { category: data.category, group: data.group ?? null, unit };
  } catch {
    return null;
  }
}
