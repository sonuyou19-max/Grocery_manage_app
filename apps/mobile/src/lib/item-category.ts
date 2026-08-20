import type { ItemCategory } from '@korb/shared';

import { fold, __ITEM_EMOJI } from '@/lib/item-emoji';

/**
 * Which aisle an item belongs to, in every language Korb ships.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to fix
 * ---------------------------------------------------------------------------
 *
 * Three tables answered three questions about the same word, and only two of
 * them had ever been translated:
 *
 *   ITEM_EMOJI  646 terms, 7 languages   creme -> 🥛
 *   ITEM_UNIT   189 terms, 7 languages   creme -> ml
 *   KEYWORDS     55 terms, English only  creme -> (nothing)
 *
 * So a French shopper typing "crème" got the right emoji, the right unit, and
 * "Autre". 619 terms the device could already recognise had no aisle without
 * asking the AI — every `milch`, `lait`, `leche`, `mleko`, `fromage`, `kaas`.
 * Each one cost a network round trip and a fraction of a cent to learn
 * something already sitting in the bundle, and showed the wrong aisle for the
 * seconds that took. Offline, it never resolved at all.
 *
 * ---------------------------------------------------------------------------
 * Derived, not duplicated
 * ---------------------------------------------------------------------------
 *
 * The obvious fix — write out 646 more entries — would create a third list to
 * keep in step with the other two, and the drift above is exactly what happens
 * to lists that must be edited in parallel.
 *
 * Instead this maps the 86 distinct EMOJI to aisles, and every term inherits
 * from its emoji. The emoji already IS the concept: everything the curated
 * table marks 🧀 is cheese in some language, and cheese is dairy wherever you
 * shop. Adding "kaas" to the emoji table now yields an emoji, a unit and a
 * category from one edit.
 *
 * 86 lines instead of 646, and a check that fails the build if a new emoji
 * appears without an aisle.
 */

/**
 * Aisle per curated emoji.
 *
 * Ordered as the emoji table is: dairy, produce, meat, bakery, pantry, drinks,
 * frozen, household, personal care.
 */
const EMOJI_CATEGORY: Record<string, ItemCategory> = {
  // Dairy & eggs
  '🥛': 'dairy_eggs', // milk, cream, and their translations
  '🧀': 'dairy_eggs',
  '🧈': 'dairy_eggs',
  '🥚': 'dairy_eggs',
  '🥣': 'dairy_eggs', // yogurt — breakfast cereal borrows it, see TERM_CATEGORY

  // Fruit & veg
  '🍎': 'fruit_veg',
  '🍌': 'fruit_veg',
  '🍊': 'fruit_veg',
  '🍋': 'fruit_veg', // lemon — but "lemonade" is a drink
  '🍓': 'fruit_veg', // strawberry — but jam is pantry
  '🍇': 'fruit_veg',
  '🍉': 'fruit_veg',
  '🍑': 'fruit_veg',
  '🍐': 'fruit_veg',
  '🍒': 'fruit_veg',
  '🍍': 'fruit_veg',
  '🥝': 'fruit_veg',
  '🥭': 'fruit_veg',
  '🥑': 'fruit_veg',
  '🫐': 'fruit_veg',
  '🥥': 'fruit_veg',
  '🍅': 'fruit_veg', // tomato — but ketchup is pantry
  '🥔': 'fruit_veg',
  '🧅': 'fruit_veg',
  '🧄': 'fruit_veg',
  '🥕': 'fruit_veg',
  '🥬': 'fruit_veg',
  '🥦': 'fruit_veg',
  '🥒': 'fruit_veg',
  '🫑': 'fruit_veg',
  '🌶️': 'fruit_veg',
  '🌽': 'fruit_veg',
  '🍄': 'fruit_veg',
  '🍆': 'fruit_veg',
  '🌿': 'fruit_veg', // fresh herbs live with the produce

  // Meat & fish
  '🍗': 'meat_fish',
  '🥩': 'meat_fish',
  '🥓': 'meat_fish',
  '🍖': 'meat_fish',
  '🌭': 'meat_fish',
  '🐟': 'meat_fish',
  '🦐': 'meat_fish',

  // Bakery
  '🍞': 'bakery',
  '🥖': 'bakery',
  '🥐': 'bakery',
  '🥯': 'bakery',
  '🍰': 'bakery',
  '🍪': 'bakery',
  '🥞': 'bakery',

  // Pantry
  '🍝': 'pantry',
  '🍜': 'pantry',
  '🍚': 'pantry',
  '🌾': 'pantry',
  '🍬': 'pantry',
  '🧂': 'pantry',
  '☕': 'pantry',
  '🍵': 'pantry',
  '🍯': 'pantry',
  '🥜': 'pantry',
  '🌰': 'pantry',
  '🍫': 'pantry',
  '🫘': 'pantry',
  '🥫': 'pantry', // tinned soup, sauces, condiments
  '🫒': 'pantry', // olives and cooking oil share this one; both are pantry

  // Drinks
  '💧': 'drinks',
  '🧃': 'drinks',
  '🍷': 'drinks',
  '🍺': 'drinks',
  '🥤': 'drinks',

  // Frozen
  '🍕': 'frozen',
  '🍨': 'frozen',
  '🧊': 'frozen',
  '🍟': 'frozen',

  // Household
  '🧻': 'household',
  '🧼': 'household', // detergent — but hand soap is personal care
  '🧽': 'household',
  '🗑️': 'household',
  '🕯️': 'household',
  '🔋': 'household',
  '💐': 'household',
  '🐱': 'household',
  '🐶': 'household',

  // Personal care
  '🧴': 'personal_care', // shampoo, deodorant — but vinegar shares the bottle
  '🪥': 'personal_care',
  '🪒': 'personal_care',
  '💊': 'personal_care',
};

/**
 * The handful of terms whose emoji points at the wrong aisle.
 *
 * Six groups, all of them cases where the curated table reasonably reuses one
 * glyph for two different things. Listed per term rather than resolved by
 * splitting the emoji table, because the emoji really is right in each case —
 * jam does look like a strawberry, and there is no better glyph for it.
 */
const TERM_CATEGORY: Record<string, ItemCategory> = {
  // 🥣 is yogurt's glyph; breakfast cereal borrows it.
  cereal: 'pantry',
  cornflakes: 'pantry',
  muesli: 'pantry',
  granola: 'pantry',
  platki: 'pantry',

  // 🍓 is strawberry; jam borrows it in six languages.
  jam: 'pantry',
  marmelade: 'pantry',
  confiture: 'pantry',
  mermelada: 'pantry',
  marmellata: 'pantry',
  dzem: 'pantry',

  // 🍅 is tomato; ketchup is not produce.
  ketchup: 'pantry',

  // 🍋 is lemon; lemonade is a drink.
  lemonade: 'drinks',

  // 🧴 is the lotion bottle, shared with vinegar.
  vinegar: 'pantry',
  essig: 'pantry',
  vinaigre: 'pantry',
  azijn: 'pantry',
  vinagre: 'pantry',
  aceto: 'pantry',
  ocet: 'pantry',

  // 🧼 is the detergent bar; hand soap is personal care, as it was before.
  soap: 'personal_care',
  seife: 'personal_care',
  savon: 'personal_care',
  zeep: 'personal_care',
  jabon: 'personal_care',
  sapone: 'personal_care',
  mydlo: 'personal_care',
};

/**
 * Every curated term with its aisle. Built once at module load.
 *
 * Terms whose emoji has no entry above are simply absent, which reads as "we
 * don't know" and falls through to the AI exactly as before — a missing aisle
 * degrades, it never guesses wrong. The check makes that state fail the build
 * anyway.
 */
const ITEM_CATEGORY: Record<string, ItemCategory> = (() => {
  const out: Record<string, ItemCategory> = {};
  for (const [term, emoji] of Object.entries(__ITEM_EMOJI)) {
    const category = TERM_CATEGORY[term] ?? EMOJI_CATEGORY[emoji];
    if (category) out[term] = category;
  }
  return out;
})();

/**
 * The aisle for a name, from the curated tables alone. Null when unknown.
 *
 * Same resolution order as emojiFor: the whole name first so "olive oil" is
 * pantry before "olive" is consulted, then word by word. Accent-folded
 * throughout — a French shopper types "crème", not "creme", and the table is
 * keyed on the folded form.
 */
/*
 * Words that mean "this is not the food that word usually names".
 *
 * The word-by-word scan below is what makes this table work at all — "organic
 * beef mince" finds beef — and it is also how "water colour" became a drink.
 * The scan has no idea that `colour` changes what `water` refers to.
 *
 * This is the fourth item of the same shape after butter beans (a legume read as
 * dairy), beef stock cubes (a flavouring read as a joint) and cocoa powder. What
 * they share is a qualifier that outranks the noun, so it is checked BEFORE the
 * scan and wins outright.
 *
 * Deliberately narrow: only words whose presence makes a food reading wrong in
 * every context I can think of. "Paint" is never a drink; "cleaner" is never a
 * food. A word that is merely usually non-food does not belong here — this rule
 * is strong enough to be worth being sure about.
 */
const NON_FOOD_QUALIFIERS = new Set<string>([
  // en
  'colour', 'color', 'paint', 'paints', 'crayon', 'crayons', 'brush',
  'cleaner', 'detergent', 'bleach', 'polish', 'varnish', 'glue',
  /*
   * de / nl. The compounds are spelled out because German and Dutch write them
   * as ONE word — "Wasserfarben" contains no separate `farben` for a word scan
   * to find, so the qualifier never fires unless the compound is itself a key.
   * Same reason rindfleisch and kakaopulver are listed elsewhere in the app.
   */
  'farbe', 'farben', 'malfarbe', 'malfarben', 'wasserfarbe', 'wasserfarben',
  'pinsel', 'reiniger', 'waschmittel', 'putzmittel', 'spulmittel',
  'verf', 'waterverf', 'kwast', 'schoonmaak', 'wasmiddel', 'afwasmiddel',
  // fr
  'peinture', 'peintures', 'pinceau', 'nettoyant', 'lessive',
  // es / it
  'pintura', 'pinturas', 'pincel', 'limpiador', 'detergente',
  'pittura', 'pennello', 'detersivo',
  // pl
  'farba', 'farby', 'pedzel', 'plyn', 'proszek',
]);

export function categoryFromTables(name: string): ItemCategory | null {
  const folded = fold(name);
  if (!folded) return null;

  const whole = ITEM_CATEGORY[folded] ?? ITEM_CATEGORY[folded.replace(/\s+/g, '')];
  if (whole) return whole;

  const words = folded.split(/[\s,./-]+/);
  // Before the noun scan, never after. See NON_FOOD_QUALIFIERS.
  if (words.some((w) => NON_FOOD_QUALIFIERS.has(w))) return 'household';

  for (const word of words) {
    if (ITEM_CATEGORY[word]) return ITEM_CATEGORY[word];
  }
  return null;
}

/** Test seams: the check script asserts coverage against these. */
export const __EMOJI_CATEGORY = EMOJI_CATEGORY;
export const __TERM_CATEGORY = TERM_CATEGORY;
export const __ITEM_CATEGORY = ITEM_CATEGORY;
