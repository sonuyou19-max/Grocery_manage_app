import { z } from 'zod';

/** Categories must match the item_category enum in the SQL schema. */
export const itemCategorySchema = z.enum([
  'fruit_veg',
  'dairy_eggs',
  'meat_fish',
  'bakery',
  'pantry',
  'frozen',
  'drinks',
  'household',
  'personal_care',
  'other',
]);

/**
 * The units an item can be measured in. Metric only — this ships in the EU.
 *
 * The single source for all of them: the item sheet's picker, the quick-add
 * parser, the unit-suggestion table, and the SQL check constraint on
 * item_lexicon.unit all read this list. It used to be written out separately in
 * each place, which is fine right up until one of them gains a unit and the
 * others silently reject it.
 */
export const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'] as const;
export type ItemUnit = (typeof UNITS)[number];

export const itemUnitSchema = z.enum(UNITS);

/** Narrow an arbitrary string to a known unit, or null. */
export const asUnit = (value: unknown): ItemUnit | null =>
  typeof value === 'string' && (UNITS as readonly string[]).includes(value)
    ? (value as ItemUnit)
    : null;

/**
 * The contract for AI quick-add: the model's raw output is validated against
 * this schema before anything is written to the database. Never trust
 * unvalidated LLM output for writes.
 */
export const parsedItemSchema = z.object({
  name: z.string().min(1).max(120),
  category: itemCategorySchema.catch('other'),
  quantity: z.number().positive().nullable().default(null),
  unit: itemUnitSchema.nullable().default(null),
});

export const quickAddResultSchema = z.object({
  items: z.array(parsedItemSchema).min(1).max(30),
  /** Original language detected in the user's utterance, BCP 47 (e.g. "de", "nl"). */
  language: z.string().min(2).max(12).catch('en'),
});

export type ParsedItem = z.infer<typeof parsedItemSchema>;
export type QuickAddResult = z.infer<typeof quickAddResultSchema>;

export const quickAddRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  list_id: z.string().uuid(),
});
export type QuickAddRequest = z.infer<typeof quickAddRequestSchema>;

/**
 * Coarse nutritional food group for the "basket balance" insight. `nonfood`
 * covers household/personal-care items so they're excluded from the mix.
 */
export const FOOD_GROUP_VALUES = [
  'protein',
  'carbs',
  'produce',
  'fats',
  'other',
  'nonfood',
] as const;
export const foodGroupSchema = z.enum(FOOD_GROUP_VALUES);
export type FoodGroup = z.infer<typeof foodGroupSchema>;

/**
 * Narrow an arbitrary string to a known food group, or null.
 *
 * Same job as asCarbonTier below and for the same reason: item_lexicon.food_group
 * is plain text with a CHECK (migration 0032), and a client running against an
 * older or hand-edited database must not be able to put an unknown group into
 * the basket mix.
 */
export const asFoodGroup = (value: unknown): FoodGroup | null =>
  typeof value === 'string' && (FOOD_GROUP_VALUES as readonly string[]).includes(value)
    ? (value as FoodGroup)
    : null;

/**
 * How heavy an item's climate footprint is, as three coarse bands.
 *
 * Three, not a number. Per-kilo emissions for food are well established at the
 * PRODUCT level — beef around 60 kg CO2e/kg, chicken 6, vegetables under 1 —
 * but Korb knows an item's name and usually not its weight, so any figure it
 * printed would be a number with no denominator. Bands say the true part (beef
 * is in a different league from lentils) without implying the false part (that
 * we know how much beef).
 *
 * Mirrored as a CHECK on item_lexicon.carbon (migration 0027) and as a copy in
 * the categorize function, which cannot import from the workspace. The CHECK is
 * what stops the three drifting.
 */
export const CARBON_TIERS = ['low', 'medium', 'high'] as const;
export const carbonTierSchema = z.enum(CARBON_TIERS);
export type CarbonTier = z.infer<typeof carbonTierSchema>;

/** Narrow an arbitrary string to a known carbon tier, or null. */
export const asCarbonTier = (value: unknown): CarbonTier | null =>
  typeof value === 'string' && (CARBON_TIERS as readonly string[]).includes(value)
    ? (value as CarbonTier)
    : null;

/** Single-item categorization: request + response for the categorize function. */
export const categorizeRequestSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CategorizeRequest = z.infer<typeof categorizeRequestSchema>;

export const categorizeResultSchema = z.object({
  category: itemCategorySchema.catch('other'),
  /** Optional: added alongside category so the balance insight is ~free. */
  group: foodGroupSchema.nullable().catch(null).optional(),
  /** Optional: the climate band, on the same call, for the same reason. */
  carbon: carbonTierSchema.nullable().catch(null).optional(),
});
export type CategorizeResult = z.infer<typeof categorizeResultSchema>;
