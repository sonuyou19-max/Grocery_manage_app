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
 * The contract for AI quick-add: the model's raw output is validated against
 * this schema before anything is written to the database. Never trust
 * unvalidated LLM output for writes.
 */
export const parsedItemSchema = z.object({
  name: z.string().min(1).max(120),
  category: itemCategorySchema.catch('other'),
  quantity: z.number().positive().nullable().default(null),
  unit: z.enum(['g', 'kg', 'ml', 'L', 'pcs']).nullable().default(null),
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
export const foodGroupSchema = z.enum(['protein', 'carbs', 'produce', 'fats', 'other', 'nonfood']);
export type FoodGroup = z.infer<typeof foodGroupSchema>;

/** Single-item categorization: request + response for the categorize function. */
export const categorizeRequestSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CategorizeRequest = z.infer<typeof categorizeRequestSchema>;

export const categorizeResultSchema = z.object({
  category: itemCategorySchema.catch('other'),
  /** Optional: added alongside category so the balance insight is ~free. */
  group: foodGroupSchema.nullable().catch(null).optional(),
});
export type CategorizeResult = z.infer<typeof categorizeResultSchema>;
