import type { ItemCategory } from '@korb/shared';

import { emojiFor } from '@/lib/item-emoji';

/**
 * How to keep an item well.
 *
 * ---------------------------------------------------------------------------
 * Keyed on the GLYPH, which is already a concept in seven languages
 * ---------------------------------------------------------------------------
 *
 * The obvious table would map a word to a sentence, and it would work in
 * English and nowhere else. item-emoji already maps 646 words across seven
 * languages onto a much smaller set of concepts, so `spinazie`, `Spinat`,
 * `épinards` and `spinach` all arrive at 🥬 before this file is even asked.
 * Keying on the glyph borrows all of that for nothing.
 *
 * It also lands the advice at the right GRAIN. Storage is a property of the
 * kind of thing, not of the product: every leafy green keeps the same way,
 * every hard cheese keeps the same way, and a table with a row per product
 * would be a table of the same twenty sentences written four hundred times.
 *
 * ---------------------------------------------------------------------------
 * Why a fallback glyph is allowed here and refused in matching
 * ---------------------------------------------------------------------------
 *
 * `emojiFor` returns the CATEGORY's own glyph when it does not recognise a
 * word, and lib/receipt.ts is careful to treat that as no answer — a fallback
 * says which aisle, not which item, and matching needs the item.
 *
 * This is the opposite case. 🥬 for an unrecognised vegetable means "some leafy
 * thing from the produce aisle", and that is precisely the grain storage advice
 * wants. So fallbacks are welcome, and the sentences behind the three glyphs
 * that are also category defaults are written to be true of the whole aisle
 * rather than of one plant. That is why 🥬 says "most greens" and not "spinach".
 *
 * Two category defaults are deliberately ABSENT for the same reason: 🥛 covers
 * milk, cheese, yoghurt and eggs, which keep in four different ways, and 🥫
 * covers the whole dry-goods aisle. There is no sentence true of either, so
 * they get none.
 *
 * ---------------------------------------------------------------------------
 * Storage only
 * ---------------------------------------------------------------------------
 *
 * Not one of these says anything about nutrition or health. That is the same
 * rule the shared dictionary enforces on AI-written tips (isShareableTip in
 * functions/_shared/lexicon.ts), and it is enforced on this table too, by
 * check-item-tip. "High in iron" is a regulated claim under EU 1924/2006; where
 * to keep a bag of leaves is not.
 */
const TIP_BY_GLYPH: Record<string, string> = {
  /* --- produce ------------------------------------------------------------ */
  // Also the fruit_veg fallback, so this has to be true of any vegetable.
  '🥬': 'tips.greens',
  '🍅': 'tips.tomato',
  '🥔': 'tips.potato',
  '🧅': 'tips.onion',
  '🍄': 'tips.mushroom',
  '🥑': 'tips.avocado',
  '🍌': 'tips.banana',
  '🌿': 'tips.herbs',
  '🥕': 'tips.carrot',
  '🍋': 'tips.citrus',
  '🍓': 'tips.berries',
  '🍎': 'tips.apple',

  /* --- bakery ------------------------------------------------------------- */
  // Also the bakery fallback, and true of anything from that aisle.
  '🍞': 'tips.bread',
  '🥖': 'tips.bread',

  /* --- dairy -------------------------------------------------------------- */
  '🧀': 'tips.cheese',
  '🧈': 'tips.butter',
  '🥚': 'tips.eggs',

  /* --- pantry ------------------------------------------------------------- */
  '☕': 'tips.coffee',
  '🍫': 'tips.chocolate',
  '🍯': 'tips.honey',
  '🫒': 'tips.oil',

  /* --- protein ------------------------------------------------------------ */
  '🐟': 'tips.fish',
};

/**
 * The i18n key for this item's storage tip, or null when there is nothing
 * specific worth saying.
 *
 * A key rather than a sentence, because the sentence has to come from the
 * reader's own locale file and this module has no business knowing which one
 * that is. Null is the common answer and always renders nothing: most of a
 * pantry keeps perfectly well in a cupboard, and "store in a cool dry place" on
 * forty rows is noise a reader learns to scroll past.
 */
export function tipKeyFor(name: string, category: ItemCategory): string | null {
  if (!name.trim()) return null;
  return TIP_BY_GLYPH[emojiFor(name, category)] ?? null;
}

/** The table, exposed so check-item-tip can hold every sentence to the rules. */
export const TIP_KEYS: readonly string[] = [...new Set(Object.values(TIP_BY_GLYPH))];
