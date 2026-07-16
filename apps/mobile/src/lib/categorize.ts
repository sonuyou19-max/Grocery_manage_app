import type { ItemCategory } from '@korb/shared';

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
 * Naive keyword categorization for manually-typed items. This is the
 * placeholder for the AI quick-add parser — same output shape, so the screen
 * doesn't change when the real model lands.
 */
export function categorize(name: string): ItemCategory {
  const words = name.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (KEYWORDS[word]) return KEYWORDS[word];
  }
  return 'other';
}
