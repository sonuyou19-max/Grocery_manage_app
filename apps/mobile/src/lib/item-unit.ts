import { type ItemCategory, type ItemUnit } from '@korb/shared';

import { fold } from '@/lib/item-emoji';

/**
 * What unit an item is normally bought in.
 *
 * Milk is litres, potatoes are kilos, bread is pieces. Making the user set that
 * every time is asking them to repeat something the app could already know, so
 * the unit is suggested on add and left fully editable — the picker in the item
 * sheet is unchanged and every unit stays one tap away.
 *
 * ---------------------------------------------------------------------------
 * Silence is a real answer
 * ---------------------------------------------------------------------------
 *
 * The important design decision here is that this returns `null` far more often
 * than it could. Cheese is grams, milk is litres, and both are dairy — so
 * "dairy" as a whole has no honest default. Guessing anyway would put a wrong
 * unit on the item, and a wrong prefill is worse than an empty one: an empty
 * field asks a question, a filled one makes a claim the user now has to notice
 * and undo. So a category only gets a default when essentially everything in it
 * shares a unit, and the rest fall through to null and the user's own choice —
 * which is exactly the "if the AI isn't confident, leave it to the user" rule,
 * applied to the offline table as well as to the model.
 *
 * ---------------------------------------------------------------------------
 * Four tiers, cheapest first
 * ---------------------------------------------------------------------------
 *
 *   1. What YOU last used for this item (item-memory.ts) — handled by the
 *      caller, and it outranks everything below. If you buy milk by the bottle,
 *      no table gets to overrule that.
 *   2. The curated table here. Instant, offline, no call, covers the everyday
 *      vocabulary in seven languages.
 *   3. The shared lexicon (migration 0019/0021) — what the model answered for
 *      this exact term, for anyone, once three people had asked.
 *   4. The category default, for the categories that have an honest one.
 *
 * Only a miss at every tier costs an AI call, and that call's answer is written
 * back into tier 3 for everybody. See lib/categorize.ts.
 */

/**
 * Categories where one unit is right for nearly everything in them.
 *
 * Deliberately short. `dairy_eggs` (litres vs grams vs pieces), `pantry`
 * (a bag of rice vs a jar of honey vs a bottle of oil), `frozen` and `other`
 * are all genuinely mixed, so they are absent and resolve to null.
 */
export const CATEGORY_UNIT: Partial<Record<ItemCategory, ItemUnit>> = {
  // Weighed at the counter or sold by the bag, essentially without exception.
  fruit_veg: 'kg',
  meat_fish: 'kg',
  // Bottles and cartons. Litres covers everything from water to wine.
  drinks: 'L',
  // A loaf, a pack of rolls, a cake. Nobody buys 400g of croissant.
  bakery: 'pcs',
  // Bottles, packs and rolls — counted, not weighed.
  household: 'pcs',
  personal_care: 'pcs',
};

/**
 * Everyday items whose unit isn't what their category would suggest, plus the
 * common words in the seven shipping languages.
 *
 * Keys are folded (see fold() in item-emoji.ts): lowercase, accents stripped,
 * ligatures mapped. A key with an underscore or an accent can never be produced
 * by fold() and would be dead weight — check-item-unit.mjs re-derives every key
 * through fold() and fails the build on any that can't be reached.
 *
 * Entries earn their place by *disagreeing* with the category default, or by
 * belonging to a category that has none. "apple" is not here: fruit_veg already
 * says kg.
 */
const ITEM_UNIT: Record<string, ItemUnit> = {
  // ---- Liquids sold by volume, mostly inside dairy (which has no default) ---
  milk: 'L', melk: 'L', milch: 'L', lait: 'L', leche: 'L', latte: 'L', mleko: 'L',
  buttermilk: 'L', karnemelk: 'L',
  cream: 'ml', room: 'ml', sahne: 'ml', creme: 'ml', crema: 'ml', panna: 'ml',
  smietana: 'ml', nata: 'ml',
  yogurt: 'g', yoghurt: 'g', joghurt: 'g', yaourt: 'g', yogur: 'g', jogurt: 'g',
  kefir: 'ml',

  // ---- Dairy sold by weight -------------------------------------------------
  cheese: 'g', kaas: 'g', kase: 'g', fromage: 'g', queso: 'g', formaggio: 'g',
  ser: 'g', gouda: 'g', mozzarella: 'g', parmesan: 'g', feta: 'g',
  butter: 'g', boter: 'g', beurre: 'g', mantequilla: 'g', burro: 'g', maslo: 'g',

  // ---- Counted, not weighed -------------------------------------------------
  egg: 'pcs', eggs: 'pcs', ei: 'pcs', eieren: 'pcs', eier: 'pcs', oeuf: 'pcs',
  huevo: 'pcs', uovo: 'pcs', jajko: 'pcs', jajka: 'pcs',
  lettuce: 'pcs', sla: 'pcs', salat: 'pcs', laitue: 'pcs', lechuga: 'pcs',
  lattuga: 'pcs', salata: 'pcs',
  cucumber: 'pcs', komkommer: 'pcs', gurke: 'pcs', concombre: 'pcs',
  pepino: 'pcs', cetriolo: 'pcs', ogorek: 'pcs',
  avocado: 'pcs', aguacate: 'pcs', avocat: 'pcs',
  pineapple: 'pcs', ananas: 'pcs', pina: 'pcs',
  melon: 'pcs', watermelon: 'pcs', wassermelone: 'pcs', arbuz: 'pcs',
  cauliflower: 'pcs', bloemkool: 'pcs', blumenkohl: 'pcs', kalafior: 'pcs',
  coliflor: 'pcs', chouxfleur: 'pcs',
  cabbage: 'pcs', kool: 'pcs', kohl: 'pcs', chou: 'pcs', col: 'pcs',
  kapusta: 'pcs', cavolo: 'pcs',

  // ---- Pantry: no category default, so the staples are spelled out ----------
  rice: 'kg', rijst: 'kg', reis: 'kg', riz: 'kg', arroz: 'kg', riso: 'kg', ryz: 'kg',
  pasta: 'g', nudeln: 'g', pates: 'g', makaron: 'g', spaghetti: 'g',
  flour: 'kg', bloem: 'kg', mehl: 'kg', farine: 'kg', harina: 'kg',
  farina: 'kg', maka: 'kg',
  sugar: 'kg', suiker: 'kg', zucker: 'kg', sucre: 'kg', azucar: 'kg',
  zucchero: 'kg', cukier: 'kg',
  salt: 'g', zout: 'g', salz: 'g', sel: 'g', sal: 'g', sale: 'g', sol: 'g',
  oil: 'ml', olie: 'ml', ol: 'ml', huile: 'ml', aceite: 'ml', olio: 'ml', olej: 'ml',
  'olive oil': 'ml', olijfolie: 'ml', olivenol: 'ml', 'huile olive': 'ml',
  vinegar: 'ml', azijn: 'ml', essig: 'ml', vinaigre: 'ml', vinagre: 'ml',
  aceto: 'ml', ocet: 'ml',
  coffee: 'g', koffie: 'g', kaffee: 'g', cafe: 'g', caffe: 'g', kawa: 'g',
  tea: 'g', thee: 'g', tee: 'g', the: 'g', te: 'g', herbata: 'g',
  honey: 'g', honing: 'g', honig: 'g', miel: 'g', miele: 'g', miod: 'g',
  nuts: 'g', noten: 'g', nusse: 'g', noix: 'g', nueces: 'g', noci: 'g', orzechy: 'g',
  cereal: 'g', muesli: 'g', granola: 'g', cornflakes: 'g', platki: 'g',
  chocolate: 'g', chocolade: 'g', schokolade: 'g', chocolat: 'g',
  cioccolato: 'g', czekolada: 'g',

  // ---- Bakery that is weighed rather than counted --------------------------
  // (bakery defaults to pcs, and these are the exceptions)

  // ---- Frozen: no category default -----------------------------------------
  'ice cream': 'ml', ijs: 'ml', eis: 'ml', glace: 'ml', helado: 'ml',
  gelato: 'ml', lody: 'ml',
  'frozen peas': 'g',

  // ---- Drinks that are not sold by the litre -------------------------------
  // Cans and small bottles are counted; the category default of L would be
  // wrong for a six-pack.
  beer: 'pcs', bier: 'pcs', biere: 'pcs', cerveza: 'pcs', birra: 'pcs', piwo: 'pcs',
};

/**
 * The shared lexicon (migration 0019 + 0021), injected rather than imported —
 * same reasoning as item-emoji.ts: this module must stay pure so the check
 * script can exercise it without AsyncStorage or Supabase. Unwired it returns
 * undefined and every lookup falls through to the offline behaviour.
 */
type UnitResolver = (foldedTerm: string) => ItemUnit | null | undefined;
let lexicon: UnitResolver = () => undefined;

export function setUnitLexicon(resolver: UnitResolver): void {
  lexicon = resolver;
}

/**
 * The unit to prefill for an item, or null to leave the picker empty.
 *
 * Mirrors emojiFor's tier order — whole name, then lexicon, then word scan,
 * then category — because the two answer the same shape of question about the
 * same string, and having them disagree about which source wins would be a
 * bug nobody could explain. The one difference is the ending: emojiFor always
 * has an answer to fall back on, and this is allowed to have none.
 */
export function unitFor(name: string, category: ItemCategory = 'other'): ItemUnit | null {
  const folded = fold(name);
  if (!folded) return null;

  // 1. Curated table, whole name — so "olive oil" is ml before "oil" is asked,
  //    and "ice cream" doesn't get read as "cream".
  const whole = ITEM_UNIT[folded];
  if (whole) return whole;

  // 2. Shared lexicon on the whole term. An exact match on the full string
  //    beats a partial match on one of its words, whichever source it came
  //    from. Note `!== undefined`: the lexicon storing an explicit null means
  //    "the model looked and wasn't sure", which is an answer, and re-deriving
  //    a guess from the category would throw it away.
  const learned = lexicon(folded);
  if (learned !== undefined) return learned;

  // 3. Curated table, word by word.
  for (const word of folded.split(/[\s,./-]+/)) {
    if (ITEM_UNIT[word]) return ITEM_UNIT[word];
  }

  // 4. The category — which for half of them is honestly nothing.
  return CATEGORY_UNIT[category] ?? null;
}

/** Test seam: the check script needs the table to assert against. */
export const __ITEM_UNIT = ITEM_UNIT;
