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

/**
 * Fixed mid-tone hues that read on both light and dark backgrounds.
 *
 * Two rules, both learned the hard way:
 *
 * **Nothing red.** Protein used to be #C0553D, a terracotta red, and it was the
 * only red in the entire app — the theme's strongest warning colour is amber.
 * So the one saturated red on screen sat in a chart that is explicitly not a
 * judgement ("a rough guide by item — not a nutrition tracker"), and read as
 * one: a quarter of your basket flagged. A food group is not an error.
 *
 * **No two adjacent in hue.** These appear as touching slices of a single bar
 * with no gap between them, so two similar colours do not read as two groups,
 * they read as one wide slice with a seam. Carbs and fats were #C79A3A and
 * #D8B24A — twelve degrees and a little lightness apart — which at bar height
 * and 10px legend dots is the same colour twice.
 *
 * The set below is one cool hue among four warm ones, spread around the wheel
 * and separated by value as well as hue, so each slice survives being next to
 * any other:
 *
 *   produce  leaf green    ~116°  the brand's own accent family
 *   protein  slate blue    ~197°  the odd one out on purpose — furthest from
 *                                 the greens, and carries no alarm
 *   carbs    wheat gold     ~42°  bread, pasta, rice
 *   fats     warm brown     ~28°  near carbs in hue, but much darker and less
 *                                 saturated, which is what separates them
 *   other    neutral        ~96°  deliberately dull; it is the leftovers bin
 */
export const GROUP_COLORS: Record<DisplayGroup, string> = {
  produce: '#5FA85A',
  protein: '#4E8FA8',
  carbs: '#D6A93F',
  fats: '#A2703F',
  other: '#8A9284',
};

/** Deterministic fallback from our 10 categories to a food group. */
const CATEGORY_GROUP: Record<ItemCategory, FoodGroup> = {
  fruit_veg: 'produce',
  dairy_eggs: 'protein',
  meat_fish: 'protein',
  bakery: 'carbs',
  /*
   * `other`, not `carbs`, and this was wrong for a long time.
   *
   * `pantry` is not a food group, it is the dry-goods drawer: pasta and rice
   * live there, but so do salt, pepper, oregano, vinegar, stock cubes, tinned
   * tomatoes and olive oil. Mapping the whole drawer to carbs meant every one
   * of those was counted and LABELLED as a carb — a basket detail page showed
   * "kosher salt", "oregano" and "Olio extravergine d'oliva" under Carbs · 21%,
   * which is both a wrong number and a visibly silly list.
   *
   * The real carbs in that drawer are named by the keyword map below, so they
   * still land in carbs. What falls through is the genuinely mixed remainder,
   * and `other` is what that bin is for. Being uncounted-but-honest beats being
   * counted-and-wrong on a chart whose own caption calls it a rough guide.
   */
  pantry: 'other',
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
/*
 * Two rules for adding to this map, both learned from the same bug:
 *
 *   1. PLURALS ARE SEPARATE WORDS. Matching is whole-word, so `olive` does not
 *      catch "green olives" — that one shipped, and put olives under Carbs.
 *   2. Only add a word the CATEGORY gets wrong. "black pepper" is `pantry` and
 *      "red pepper" is `fruit_veg`, so the category already separates them and
 *      a `pepper` entry here could only make one of the two worse. Same for
 *      salt, oregano, vinegar and every other seasoning: `pantry → other` is
 *      already right for them, so they are deliberately absent.
 */
const GROUP_KEYWORDS: Record<string, FoodGroup> = {
  // fats
  oil: 'fats', oils: 'fats', olive: 'fats', olives: 'fats', butter: 'fats',
  margarine: 'fats', ghee: 'fats', lard: 'fats', mayonnaise: 'fats', mayo: 'fats',
  nuts: 'fats', nut: 'fats',
  almond: 'fats', almonds: 'fats', peanut: 'fats', peanuts: 'fats', cashew: 'fats',
  cashews: 'fats', walnut: 'fats', walnuts: 'fats', hazelnut: 'fats', hazelnuts: 'fats',
  pistachio: 'fats', pistachios: 'fats',
  avocado: 'fats', avocados: 'fats', seeds: 'fats', tahini: 'fats',
  // protein
  chicken: 'protein', beef: 'protein', pork: 'protein', turkey: 'protein', lamb: 'protein',
  fish: 'protein', salmon: 'protein', tuna: 'protein', shrimp: 'protein', ham: 'protein', bacon: 'protein', sausage: 'protein',
  egg: 'protein', eggs: 'protein', tofu: 'protein', tempeh: 'protein', bean: 'protein', beans: 'protein',
  lentil: 'protein', lentils: 'protein', chickpea: 'protein', chickpeas: 'protein', hummus: 'protein',
  yogurt: 'protein', yoghurt: 'protein', cheese: 'protein', milk: 'protein',
  // carbs — the pasta shapes matter now that `pantry` no longer defaults here:
  // "rigatoni" is a carb and nothing else in the chain knows that.
  bread: 'carbs', rice: 'carbs', pasta: 'carbs', noodles: 'carbs', cereal: 'carbs',
  oats: 'carbs', oat: 'carbs', muesli: 'carbs', granola: 'carbs',
  flour: 'carbs', sugar: 'carbs', potato: 'carbs', potatoes: 'carbs',
  tortilla: 'carbs', tortillas: 'carbs', wrap: 'carbs', wraps: 'carbs',
  spaghetti: 'carbs', penne: 'carbs', rigatoni: 'carbs', macaroni: 'carbs',
  fusilli: 'carbs', farfalle: 'carbs', tagliatelle: 'carbs', lasagne: 'carbs',
  lasagna: 'carbs', gnocchi: 'carbs', couscous: 'carbs', quinoa: 'carbs',
  bulgur: 'carbs', barley: 'carbs', bagel: 'carbs', bagels: 'carbs',
  croissant: 'carbs', croissants: 'carbs', baguette: 'carbs',
  cracker: 'carbs', crackers: 'carbs',
  // produce
  apple: 'produce', apples: 'produce', banana: 'produce', bananas: 'produce',
  tomato: 'produce', tomatoes: 'produce',
  onion: 'produce', onions: 'produce', carrot: 'produce', carrots: 'produce',
  lettuce: 'produce', spinach: 'produce', cucumber: 'produce', cucumbers: 'produce',
  broccoli: 'produce', mushroom: 'produce', mushrooms: 'produce',
  garlic: 'produce', lemon: 'produce', lemons: 'produce', lime: 'produce',
  limes: 'produce', orange: 'produce', oranges: 'produce',
  strawberry: 'produce', strawberries: 'produce', grape: 'produce', grapes: 'produce',
  cabbage: 'produce', kale: 'produce', celery: 'produce', leek: 'produce',
  leeks: 'produce', courgette: 'produce', zucchini: 'produce', aubergine: 'produce',
  eggplant: 'produce',
};

const norm = (name: string) => name.trim().toLowerCase();

function keywordGroup(name: string): FoodGroup | null {
  for (const word of norm(name).split(/\s+/)) {
    if (GROUP_KEYWORDS[word]) return GROUP_KEYWORDS[word];
  }
  return null;
}

/**
 * The shared lexicon's answer for a term, injected rather than imported.
 *
 * Same arrangement as item-emoji's, for the same reason: the lexicon cache
 * needs AsyncStorage and Supabase, and this module is called from render on
 * three screens. `lib/item-lexicon` also imports nothing from here, and this
 * keeps it that way.
 */
type GroupResolver = (name: string) => FoodGroup | null | undefined;
let lexiconGroupResolver: GroupResolver = () => undefined;

export function setGroupLexicon(resolver: GroupResolver): void {
  lexiconGroupResolver = resolver;
}

function lexiconGroup(name: string): FoodGroup | null {
  return lexiconGroupResolver(name) ?? null;
}

/**
 * An item's display food group, or null when it's non-food (excluded).
 *
 * Three sources, most trusted first:
 *
 *   1. the curated keyword map above — few, hand-checked, and the place a
 *      deliberate correction goes;
 *   2. the shared lexicon, which is the model's own answer to the very call
 *      that classified this item. It was being discarded until migration 0032
 *      gave it a column, and it is the only one of the three that works in the
 *      six languages this app ships besides English — "Olio extravergine
 *      d'oliva" is a fat here and was a carbohydrate before;
 *   3. the item's category, which is a drawer rather than a food group and is
 *      therefore the last resort rather than the second.
 *
 * Still deterministic, which was always the point: the lexicon is shared and
 * published, so every member of a household resolves a term the same way. What
 * changed is that the shared answer now reaches this function instead of being
 * re-guessed locally from an English word list.
 */
export function foodGroupOf(name: string, category: ItemCategory): DisplayGroup | null {
  const g = keywordGroup(name) ?? lexiconGroup(name) ?? CATEGORY_GROUP[category];
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
