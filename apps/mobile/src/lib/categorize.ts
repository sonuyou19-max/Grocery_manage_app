import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ItemCategory } from '@korb/shared';

import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

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

const norm = (name: string) => name.trim().toLowerCase();

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

function keywordMatch(name: string): ItemCategory | null {
  for (const word of norm(name).split(/\s+/)) {
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
 * Ask the categorize edge function to classify an unknown item. Returns null
 * when the backend isn't configured yet (scaffold phase) or on any error, so
 * the caller simply leaves the item under 'Other'.
 */
export async function resolveCategoryAsync(name: string): Promise<ItemCategory | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { category?: ItemCategory };
    return data.category ?? null;
  } catch {
    return null;
  }
}
