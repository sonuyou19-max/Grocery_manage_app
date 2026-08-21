import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  asCarbonTier,
  asFoodGroup,
  asUnit,
  type FoodGroup,
  type ItemCategory,
  type ItemUnit,
} from '@korb/shared';

import { categoryFromTables } from '@/lib/item-category';
import { fold } from '@/lib/item-emoji';
import { learnLexiconEntry, lexiconLookup } from '@/lib/item-lexicon';
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
 *
 * ---------------------------------------------------------------------------
 * Why v2: the cache outlived the bug it recorded
 * ---------------------------------------------------------------------------
 *
 * Between the lexicon shipping and fe4d3ba, the categorize prompt's example
 * object named only two of the five keys the handler reads, so the model
 * answered with those two and `emoji` came back missing on every single call.
 * That commit fixed the prompt — but it could not undo what this cache had
 * already written.
 *
 * The two caches are not symmetrical, and that asymmetry is the whole problem.
 * A call in that window taught the CATEGORY cache the item's aisle and taught
 * the LEXICON nothing, because there was no emoji to teach it. From then on
 * `isKnown` answers true, `resolveIfUnknown` returns before it asks, and the
 * one call that could ever supply the glyph never runs again on that device.
 * The item is stuck on its category fallback permanently — which is exactly
 * what a paneer showing the dairy milk glass was.
 *
 * So the entries have to go, once. Bumping the key drops them and the next add
 * re-asks against the fixed prompt. The cost is a handful of re-resolutions for
 * items the curated table doesn't cover — cheap, one-off, and bounded by how
 * many such items one household actually types. The alternative, leaving them,
 * is a device that can never recover on its own.
 */
const CACHE_KEY = 'korb.categoryCache.v2';
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

/**
 * The shared dictionary's answer for a name, or null.
 *
 * ---------------------------------------------------------------------------
 * Why this tier had to exist
 * ---------------------------------------------------------------------------
 *
 * item_lexicon is where the AI's answers accumulate, and item-emoji.ts has
 * always read it — so the GLYPH for "salad mix" came from the lexicon while the
 * CATEGORY came from the two functions below, which had never heard of it. One
 * item, two sources of truth, and they disagreed: the same product showed 🥗 on
 * a list, 🥬 after a quick-add and 🛒 in the Pantry, because those routes differ
 * in whether an AI call ever happened and nothing consulted the answer already
 * on the device.
 *
 * It also asked the model for things it already knew. `isKnown` gates the
 * background upgrade, so a term sitting in the lexicon still counted as unknown
 * and still cost a categorize call — every time, on every device.
 *
 * ---------------------------------------------------------------------------
 * Why it sits AFTER the curated tables
 * ---------------------------------------------------------------------------
 *
 * The curated tables are deterministic and cover all seven languages, and this
 * app's standing promise is that the same item lands in the same place in every
 * language on every device. The lexicon is a model's answer, published once
 * three unrelated households have typed the term. So the order is: what this
 * device has confirmed, then what the tables know for certain, then what the
 * dictionary has learned, then 'other'.
 *
 * The practical effect is that this can only ever turn an 'other' into a real
 * category. It cannot change an answer that already works, which is what makes
 * it safe to add underneath four different entry points at once.
 *
 * A known nuance, left deliberate: item-emoji.ts puts the lexicon ABOVE its
 * word-by-word scan but below its whole-name matches, so a lexicon entry there
 * can beat a lucky word hit ("chocolate milk" finding `milk`). `keywordMatch`
 * folds whole-name and word-scan into one call, so replicating that split here
 * would mean restructuring it. Not worth it for a case that is hypothetical
 * today — but it is the reason these two precedences are not identical.
 *
 * Hydration timing is the same tolerance the emoji path already lives with: the
 * lexicon loads from storage a moment after launch, so an item added in that
 * window misses this tier and falls through exactly as it did before.
 */
function lexiconCategory(name: string): ItemCategory | null {
  return lexiconLookup(fold(name))?.category ?? null;
}

/**
 * True when we can categorize without asking the AI.
 *
 * The lexicon counts. That is the whole point of paying for an answer once.
 */
export function isKnown(name: string): boolean {
  return (
    Boolean(learned[norm(name)]) || keywordMatch(name) != null || lexiconCategory(name) != null
  );
}

/**
 * Instant, synchronous best guess: learned cache first, then keywords, then the
 * shared lexicon, else 'other'. Unknown items show under 'Other' immediately
 * while the AI resolves the real category in the background.
 */
export function categorizeSync(name: string): ItemCategory {
  return learned[norm(name)] ?? keywordMatch(name) ?? lexiconCategory(name) ?? 'other';
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
      carbon?: string | null;
    };
    if (!data.category) return null;
    // A function deployed before units existed simply omits the field, which
    // lands as null — "not established" — and the caller falls through to the
    // curated table. No version negotiation needed.
    const unit = asUnit(data.unit);
    // The group the model already answered. Seeded into the local cache on the
    // spot rather than waited for: publication needs three distinct askers
    // (migration 0019), so without this the person who asked FIRST would see
    // their own item mis-grouped until two strangers happened to type it too.
    const group = asFoodGroup(data.group);
    // The climate band the same call already answered and this function used to
    // throw away — it passed a hardcoded null below while the response carried a
    // real tier. The band therefore reached the device only once the term had
    // been published to the shared lexicon, which needs three unrelated
    // households to type it (migration 0019); until then the person who paid for
    // the answer was scored off lib/eco's food-group default instead of the one
    // they had just bought. Same reasoning as `group` above, one field over.
    const carbon = asCarbonTier(data.carbon);
    // Structural sanity only. The allowlist check that actually matters ran
    // server-side before this value was allowed anywhere near the shared table
    // (functions/_shared/emoji-allowlist.ts); re-listing 200 glyphs here would
    // just be a second copy to drift out of step. This guards against a
    // malformed response, not against a hostile one.
    if (typeof data.emoji === 'string' && data.emoji.length > 0 && data.emoji.length <= 8) {
      learnLexiconEntry(fold(name), data.emoji, data.category, unit, carbon, group);
    }
    return { category: data.category, group, unit };
  } catch {
    return null;
  }
}
