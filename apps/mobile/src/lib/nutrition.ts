import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FoodGroup, ItemCategory } from '@korb/shared';

/**
 * "Basket balance" — a rough, honest read of a cart or pantry's food-group mix.
 * It's a directional guide by item, NOT a nutrition tracker: we don't have
 * weights, so each food item counts once toward its group. Household /
 * personal-care items are excluded (nonfood).
 *
 * Groups come from three sources, cheapest first: a small keyword map, then the
 * item's category, then the AI food group cached alongside its category (so the
 * refinement costs no extra calls — it rides on the categorize request).
 */

/** Groups we actually display (nonfood items are dropped from the mix). */
export const FOOD_GROUPS = ['produce', 'protein', 'carbs', 'fats', 'other'] as const;
export type DisplayGroup = (typeof FOOD_GROUPS)[number];

export const GROUP_LABELS: Record<DisplayGroup, string> = {
  produce: 'Produce',
  protein: 'Protein',
  carbs: 'Carbs',
  fats: 'Fats',
  other: 'Other',
};

// Fixed mid-tone hues that read on both light and dark backgrounds.
export const GROUP_COLORS: Record<DisplayGroup, string> = {
  produce: '#5FA85A',
  protein: '#C0553D',
  carbs: '#C79A3A',
  fats: '#D8B24A',
  other: '#8A9284',
};

/** Deterministic fallback from our 10 categories to a food group. */
const CATEGORY_GROUP: Record<ItemCategory, FoodGroup> = {
  fruit_veg: 'produce',
  dairy_eggs: 'protein',
  meat_fish: 'protein',
  bakery: 'carbs',
  pantry: 'carbs',
  frozen: 'other',
  drinks: 'other',
  household: 'nonfood',
  personal_care: 'nonfood',
  other: 'other',
};

// Cheap, free corrections for common items the category map gets wrong
// (e.g. oil is "pantry" but nutritionally a fat).
const GROUP_KEYWORDS: Record<string, FoodGroup> = {
  oil: 'fats', olive: 'fats', butter: 'fats', nuts: 'fats', nut: 'fats',
  almond: 'fats', almonds: 'fats', peanut: 'fats', avocado: 'fats', seeds: 'fats',
  beans: 'protein', bean: 'protein', lentil: 'protein', lentils: 'protein',
  chickpea: 'protein', chickpeas: 'protein', tofu: 'protein', hummus: 'protein',
};

const norm = (name: string) => name.trim().toLowerCase();

// AI-refined groups keyed by normalized name, hydrated at startup.
const CACHE_KEY = 'korb.foodGroupCache.v1';
let learned: Record<string, FoodGroup> = {};

export async function hydrateGroupCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) learned = JSON.parse(raw);
  } catch {
    // ignore corrupt cache
  }
}

export async function learnGroup(name: string, group: FoodGroup): Promise<void> {
  learned[norm(name)] = group;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(learned));
  } catch {
    // best-effort persistence
  }
}

function keywordGroup(name: string): FoodGroup | null {
  for (const word of norm(name).split(/\s+/)) {
    if (GROUP_KEYWORDS[word]) return GROUP_KEYWORDS[word];
  }
  return null;
}

/** An item's display food group, or null when it's non-food (excluded). */
export function foodGroupOf(name: string, category: ItemCategory): DisplayGroup | null {
  const g = learned[norm(name)] ?? keywordGroup(name) ?? CATEGORY_GROUP[category];
  return g === 'nonfood' ? null : g;
}

export interface BalanceSlice {
  group: DisplayGroup;
  count: number;
  fraction: number; // 0..1 of the food items
}

/** Tally a cart/pantry into food-group slices (food items only). */
export function basketBalance(
  items: Array<{ name: string; category: ItemCategory }>,
): { slices: BalanceSlice[]; total: number } {
  const tally: Partial<Record<DisplayGroup, number>> = {};
  let total = 0;
  for (const it of items) {
    const g = foodGroupOf(it.name, it.category);
    if (!g) continue;
    tally[g] = (tally[g] ?? 0) + 1;
    total += 1;
  }
  const slices = FOOD_GROUPS.map((group) => ({
    group,
    count: tally[group] ?? 0,
    fraction: total ? (tally[group] ?? 0) / total : 0,
  }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  return { slices, total };
}
