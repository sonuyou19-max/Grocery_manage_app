import type { FoodGroup, ItemCategory } from '@korb/shared';

/**
 * "Basket balance" — a rough, honest read of a cart or pantry's food-group mix.
 * It's a directional guide by item, NOT a nutrition tracker: we don't have
 * weights, so each food item counts once toward its group. Household /
 * personal-care items are excluded (nonfood).
 *
 * Classification is deterministic (a shared keyword map, then the item's shared
 * category) so every member of a household computes the exact same mix.
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

/** Localized food-group label (GROUP_LABELS above is the English source). */
export function groupLabel(
  group: DisplayGroup,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return t(`group.${group}`);
}

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

// Keyword overrides so the mix is accurate AND identical on every device (the
// category is already shared; this map is the same code everywhere). Refines
// the cases the category map alone gets wrong — oil is "pantry" but a fat, a
// potato is a carb, etc. Kept deterministic on purpose: a per-device AI cache
// would make the same household show different mixes.
const GROUP_KEYWORDS: Record<string, FoodGroup> = {
  // fats
  oil: 'fats', olive: 'fats', butter: 'fats', margarine: 'fats', nuts: 'fats', nut: 'fats',
  almond: 'fats', almonds: 'fats', peanut: 'fats', cashew: 'fats', avocado: 'fats', seeds: 'fats', tahini: 'fats',
  // protein
  chicken: 'protein', beef: 'protein', pork: 'protein', turkey: 'protein', lamb: 'protein',
  fish: 'protein', salmon: 'protein', tuna: 'protein', shrimp: 'protein', ham: 'protein', bacon: 'protein', sausage: 'protein',
  egg: 'protein', eggs: 'protein', tofu: 'protein', tempeh: 'protein', bean: 'protein', beans: 'protein',
  lentil: 'protein', lentils: 'protein', chickpea: 'protein', chickpeas: 'protein', hummus: 'protein',
  yogurt: 'protein', yoghurt: 'protein', cheese: 'protein', milk: 'protein',
  // carbs
  bread: 'carbs', rice: 'carbs', pasta: 'carbs', noodles: 'carbs', cereal: 'carbs', oats: 'carbs',
  flour: 'carbs', sugar: 'carbs', potato: 'carbs', potatoes: 'carbs', tortilla: 'carbs',
  // produce
  apple: 'produce', apples: 'produce', banana: 'produce', bananas: 'produce', tomato: 'produce',
  onion: 'produce', carrot: 'produce', lettuce: 'produce', spinach: 'produce', cucumber: 'produce', broccoli: 'produce',
};

const norm = (name: string) => name.trim().toLowerCase();

function keywordGroup(name: string): FoodGroup | null {
  for (const word of norm(name).split(/\s+/)) {
    if (GROUP_KEYWORDS[word]) return GROUP_KEYWORDS[word];
  }
  return null;
}

/**
 * An item's display food group, or null when it's non-food (excluded).
 * Deterministic (keyword → shared category), so every household member's app
 * computes the identical mix.
 */
export function foodGroupOf(name: string, category: ItemCategory): DisplayGroup | null {
  const g = keywordGroup(name) ?? CATEGORY_GROUP[category];
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
