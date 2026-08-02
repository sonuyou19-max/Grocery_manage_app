import type { ItemCategory } from '@korb/shared';

/**
 * An emoji for a grocery item, so a list reads at a glance instead of as a wall
 * of text.
 *
 * Two rules shape this file:
 *
 * 1. **There is always an answer.** Every category has an emoji, so an
 *    unrecognised item still gets a sensible icon rather than a blank gap that
 *    makes the list ragged. Nothing here can return null.
 *
 * 2. **It has to work in seven languages.** People type "Milch", "lait",
 *    "mleko" — matching English only would give German users a shelf of generic
 *    category icons and quietly make the feature look broken outside the UK.
 *    So the lookup table is keyed by word in every language the app ships, and
 *    names are folded (lowercased, accents stripped) before lookup so "œufs",
 *    "pêche" and "jalapeño" match the same way their unaccented spellings do.
 *
 * This is deliberately a lookup table and not an AI call: it renders on every
 * row of every list, it must be instant and offline, and being occasionally
 * generic is much cheaper than being occasionally slow.
 */

/** Always-available fallback — one per category, so every item gets something. */
export const CATEGORY_EMOJI: Record<ItemCategory, string> = {
  fruit_veg: '🥬',
  dairy_eggs: '🥛',
  meat_fish: '🍗',
  bakery: '🍞',
  pantry: '🥫',
  frozen: '🧊',
  drinks: '🥤',
  household: '🧻',
  personal_care: '🧴',
  other: '🛒',
};

/**
 * Word → emoji, across en / de / fr / nl / es / it / pl.
 *
 * Keys are already folded (lowercase, no accents) — see `fold` below. Grouped
 * by concept rather than by language so a missing translation is easy to spot.
 */
const ITEM_EMOJI: Record<string, string> = {
  // --- dairy & eggs ---------------------------------------------------------
  milk: '🥛', milch: '🥛', lait: '🥛', melk: '🥛', leche: '🥛', latte: '🥛', mleko: '🥛',
  cheese: '🧀', kase: '🧀', fromage: '🧀', kaas: '🧀', queso: '🧀', formaggio: '🧀', ser: '🧀',
  gouda: '🧀', cheddar: '🧀', mozzarella: '🧀', parmesan: '🧀', feta: '🧀',
  butter: '🧈', beurre: '🧈', boter: '🧈', mantequilla: '🧈', burro: '🧈', maslo: '🧈',
  egg: '🥚', eggs: '🥚', ei: '🥚', eier: '🥚', oeuf: '🥚', oeufs: '🥚', eieren: '🥚',
  huevo: '🥚', huevos: '🥚', uovo: '🥚', uova: '🥚', jajka: '🥚', jajko: '🥚',
  yogurt: '🥣', yoghurt: '🥣', joghurt: '🥣', yaourt: '🥣', jogurt: '🥣',
  cream: '🥛', sahne: '🥛', creme: '🥛', room: '🥛', nata: '🥛', panna: '🥛', smietana: '🥛',

  // --- fruit ---------------------------------------------------------------
  apple: '🍎', apples: '🍎', apfel: '🍎', apfeln: '🍎', pomme: '🍎', pommes: '🍎',
  appel: '🍎', appels: '🍎', manzana: '🍎', manzanas: '🍎', mela: '🍎', mele: '🍎', jablka: '🍎', jablko: '🍎',
  banana: '🍌', bananas: '🍌', banane: '🍌', bananen: '🍌', platano: '🍌', banany: '🍌', banan: '🍌',
  orange: '🍊', oranges: '🍊', orangen: '🍊', sinaasappel: '🍊', naranja: '🍊', arancia: '🍊', pomarancze: '🍊',
  lemon: '🍋', zitrone: '🍋', citron: '🍋', citroen: '🍋', limon: '🍋', limone: '🍋', cytryna: '🍋',
  strawberry: '🍓', strawberries: '🍓', erdbeeren: '🍓', fraises: '🍓', aardbeien: '🍓',
  fresas: '🍓', fragole: '🍓', truskawki: '🍓',
  grapes: '🍇', trauben: '🍇', raisins: '🍇', druiven: '🍇', uvas: '🍇', uva: '🍇', winogrona: '🍇',
  watermelon: '🍉', wassermelone: '🍉', pasteque: '🍉', watermeloen: '🍉', sandia: '🍉',
  anguria: '🍉', arbuz: '🍉',
  peach: '🍑', pfirsich: '🍑', peche: '🍑', perzik: '🍑', melocoton: '🍑', pesca: '🍑', brzoskwinia: '🍑',
  pear: '🍐', birne: '🍐', poire: '🍐', peer: '🍐', pera: '🍐', gruszka: '🍐',
  cherry: '🍒', cherries: '🍒', kirschen: '🍒', cerises: '🍒', kersen: '🍒', cerezas: '🍒',
  ciliegie: '🍒', wisnie: '🍒', czeresnie: '🍒',
  pineapple: '🍍', ananas: '🍍', pina: '🍍',
  kiwi: '🥝', mango: '🥭', avocado: '🥑', avocat: '🥑', aguacate: '🥑', awokado: '🥑',
  blueberries: '🫐', heidelbeeren: '🫐', myrtilles: '🫐', bosbessen: '🫐', arandanos: '🫐',
  mirtilli: '🫐', borowki: '🫐',
  coconut: '🥥', kokosnuss: '🥥', noix: '🌰', kokos: '🥥',

  // --- vegetables ----------------------------------------------------------
  tomato: '🍅', tomatoes: '🍅', tomate: '🍅', tomaten: '🍅', tomates: '🍅',
  pomodoro: '🍅', pomodori: '🍅', pomidory: '🍅', pomidor: '🍅',
  potato: '🥔', potatoes: '🥔', kartoffel: '🥔', kartoffeln: '🥔', aardappel: '🥔',
  aardappels: '🥔', patata: '🥔', patatas: '🥔', patate: '🥔', ziemniaki: '🥔',
  onion: '🧅', onions: '🧅', zwiebel: '🧅', zwiebeln: '🧅', oignon: '🧅', oignons: '🧅',
  ui: '🧅', uien: '🧅', cebolla: '🧅', cipolla: '🧅', cebula: '🧅',
  garlic: '🧄', knoblauch: '🧄', ail: '🧄', knoflook: '🧄', ajo: '🧄', aglio: '🧄', czosnek: '🧄',
  carrot: '🥕', carrots: '🥕', karotte: '🥕', karotten: '🥕', mohren: '🥕', carotte: '🥕',
  carottes: '🥕', wortel: '🥕', wortels: '🥕', zanahoria: '🥕', carota: '🥕', carote: '🥕', marchew: '🥕',
  lettuce: '🥬', salat: '🥬', salade: '🥬', sla: '🥬', lechuga: '🥬', lattuga: '🥬', salata: '🥬',
  spinach: '🥬', spinat: '🥬', epinards: '🥬', spinazie: '🥬', espinacas: '🥬', spinaci: '🥬', szpinak: '🥬',
  broccoli: '🥦', brokkoli: '🥦', brocoli: '🥦', brokuly: '🥦',
  cucumber: '🥒', gurke: '🥒', concombre: '🥒', komkommer: '🥒', pepino: '🥒',
  cetriolo: '🥒', ogorek: '🥒', ogorki: '🥒',
  pepper: '🫑', peppers: '🫑', paprika: '🫑', poivron: '🫑', pimiento: '🫑', peperone: '🫑', papryka: '🫑',
  chili: '🌶️', chilli: '🌶️', piment: '🌶️', peperoncino: '🌶️', papryczka: '🌶️',
  corn: '🌽', mais: '🌽', maiz: '🌽', kukurydza: '🌽',
  mushroom: '🍄', mushrooms: '🍄', pilze: '🍄', champignons: '🍄', setas: '🍄',
  funghi: '🍄', pieczarki: '🍄', grzyby: '🍄',
  aubergine: '🍆', eggplant: '🍆', berenjena: '🍆', melanzana: '🍆', baklazan: '🍆',
  basil: '🌿', basilikum: '🌿', basilic: '🌿', basilicum: '🌿', albahaca: '🌿',
  basilico: '🌿', bazylia: '🌿', herbs: '🌿', krauter: '🌿', herbes: '🌿', kruiden: '🌿',
  olive: '🫒', olives: '🫒', oliven: '🫒', aceitunas: '🫒', oliwki: '🫒',

  // --- meat & fish ---------------------------------------------------------
  chicken: '🍗', hahnchen: '🍗', huhn: '🍗', poulet: '🍗', kip: '🍗', pollo: '🍗', kurczak: '🍗',
  beef: '🥩', steak: '🥩', rindfleisch: '🥩', boeuf: '🥩', rundvlees: '🥩', ternera: '🥩',
  manzo: '🥩', wolowina: '🥩',
  pork: '🥓', schwein: '🥓', schweinefleisch: '🥓', porc: '🥓', varkensvlees: '🥓',
  cerdo: '🥓', maiale: '🥓', wieprzowina: '🥓',
  bacon: '🥓', speck: '🥓', spek: '🥓', tocino: '🥓', pancetta: '🥓', boczek: '🥓',
  ham: '🍖', schinken: '🍖', jambon: '🍖', hesp: '🍖', jamon: '🍖', prosciutto: '🍖', szynka: '🍖',
  sausage: '🌭', sausages: '🌭', wurst: '🌭', saucisse: '🌭', worst: '🌭',
  salchicha: '🌭', salsiccia: '🌭', kielbasa: '🌭', parowki: '🌭',
  fish: '🐟', fisch: '🐟', poisson: '🐟', vis: '🐟', pescado: '🐟', pesce: '🐟', ryba: '🐟',
  salmon: '🐟', lachs: '🐟', saumon: '🐟', zalm: '🐟', salmone: '🐟', losos: '🐟',
  tuna: '🐟', thunfisch: '🐟', thon: '🐟', tonijn: '🐟', atun: '🐟', tonno: '🐟', tunczyk: '🐟',
  shrimp: '🦐', garnelen: '🦐', crevettes: '🦐', garnalen: '🦐', gambas: '🦐',
  gamberi: '🦐', krewetki: '🦐',
  meat: '🥩', fleisch: '🥩', viande: '🥩', vlees: '🥩', carne: '🥩', mieso: '🥩',

  // --- bakery ---------------------------------------------------------------
  bread: '🍞', brot: '🍞', pain: '🍞', brood: '🍞', pan: '🍞', pane: '🍞', chleb: '🍞',
  sourdough: '🍞', baguette: '🥖', stokbrood: '🥖', bagietka: '🥖',
  croissant: '🥐', hoornje: '🥐', rogalik: '🥐',
  bun: '🥯', buns: '🥯', brotchen: '🥯', broodje: '🥯', bollo: '🥯', panino: '🥯', bulka: '🥯',
  cake: '🍰', kuchen: '🍰', gateau: '🍰', taart: '🍰', tarta: '🍰', torta: '🍰', ciasto: '🍰',
  cookies: '🍪', kekse: '🍪', biscuits: '🍪', koekjes: '🍪', galletas: '🍪',
  biscotti: '🍪', ciastka: '🍪',
  pancakes: '🥞', pfannkuchen: '🥞', crepes: '🥞', pannenkoeken: '🥞', nalesniki: '🥞',

  // --- pantry ---------------------------------------------------------------
  pasta: '🍝', nudeln: '🍝', pates: '🍝', makaron: '🍝',
  spaghetti: '🍝', penne: '🍝', noodles: '🍜',
  rice: '🍚', reis: '🍚', riz: '🍚', rijst: '🍚', arroz: '🍚', riso: '🍚', ryz: '🍚',
  flour: '🌾', mehl: '🌾', farine: '🌾', bloem: '🌾', harina: '🌾', farina: '🌾', maka: '🌾',
  oil: '🫒', ol: '🫒', huile: '🫒', olie: '🫒', aceite: '🫒', olio: '🫒', olej: '🫒', oliwa: '🫒',
  sugar: '🍬', zucker: '🍬', sucre: '🍬', suiker: '🍬', azucar: '🍬', zucchero: '🍬', cukier: '🍬',
  salt: '🧂', salz: '🧂', sel: '🧂', zout: '🧂', sal: '🧂', sale: '🧂', sol: '🧂',
  coffee: '☕', kaffee: '☕', cafe: '☕', koffie: '☕', caffe: '☕', kawa: '☕',
  tea: '🍵', tee: '🍵', the: '🍵', thee: '🍵', te: '🍵', herbata: '🍵',
  cereal: '🥣', cornflakes: '🥣', muesli: '🥣', granola: '🥣', platki: '🥣',
  honey: '🍯', honig: '🍯', miel: '🍯', honing: '🍯', miele: '🍯', miod: '🍯',
  jam: '🍓', marmelade: '🍓', confiture: '🍓', mermelada: '🍓',
  marmellata: '🍓', dzem: '🍓',
  peanut: '🥜', nuts: '🥜', nusse: '🥜', noten: '🥜', nueces: '🥜', noci: '🥜', orzechy: '🥜',
  chocolate: '🍫', schokolade: '🍫', chocolat: '🍫', chocolade: '🍫', cioccolato: '🍫', czekolada: '🍫',
  beans: '🫘', bohnen: '🫘', haricots: '🫘', bonen: '🫘', frijoles: '🫘', fagioli: '🫘', fasola: '🫘',
  soup: '🥫', suppe: '🥫', soupe: '🥫', soep: '🥫', sopa: '🥫', zuppa: '🥫', zupa: '🥫',
  sauce: '🥫', sos: '🥫', salsa: '🥫', saus: '🥫',
  ketchup: '🍅', mayonnaise: '🥫', mayo: '🥫', mosterd: '🥫', mustard: '🥫',
  senf: '🥫', moutarde: '🥫', musztarda: '🥫',
  vinegar: '🧴', essig: '🧴', vinaigre: '🧴', azijn: '🧴', vinagre: '🧴', aceto: '🧴', ocet: '🧴',

  // --- drinks ---------------------------------------------------------------
  water: '💧', wasser: '💧', eau: '💧', agua: '💧', acqua: '💧', woda: '💧',
  juice: '🧃', saft: '🧃', jus: '🧃', sap: '🧃', zumo: '🧃', succo: '🧃', sok: '🧃',
  wine: '🍷', wein: '🍷', vin: '🍷', wijn: '🍷', vino: '🍷', wino: '🍷',
  beer: '🍺', bier: '🍺', biere: '🍺', cerveza: '🍺', birra: '🍺', piwo: '🍺',
  soda: '🥤', limonade: '🥤', frisdrank: '🥤', refresco: '🥤', bibita: '🥤', napoje: '🥤',
  cola: '🥤', lemonade: '🍋',

  // --- frozen ---------------------------------------------------------------
  pizza: '🍕',
  icecream: '🍨', eis: '🍨', glace: '🍨', ijs: '🍨', helado: '🍨', gelato: '🍨', lody: '🍨',
  ice: '🧊', ijsblokjes: '🧊',
  fries: '🍟', frites: '🍟', frieten: '🍟', patatine: '🍟', frytki: '🍟',

  // --- household ------------------------------------------------------------
  toilet: '🧻', klopapier: '🧻', papier: '🧻', wc: '🧻', papel: '🧻', carta: '🧻',
  'papier toaletowy': '🧻', 'toilet paper': '🧻', 'papier toilette': '🧻', 'toiletpapier': '🧻',
  detergent: '🧼', waschmittel: '🧼', lessive: '🧼', wasmiddel: '🧼', detergente: '🧼', proszek: '🧼',
  soap: '🧼', seife: '🧼', savon: '🧼', zeep: '🧼', jabon: '🧼', sapone: '🧼', mydlo: '🧼',
  sponge: '🧽', schwamm: '🧽', eponge: '🧽', spons: '🧽', esponja: '🧽', spugna: '🧽', gabka: '🧽',
  bin: '🗑️', mullbeutel: '🗑️', poubelle: '🗑️', vuilniszakken: '🗑️', basura: '🗑️', worki: '🗑️',
  candle: '🕯️', kerze: '🕯️', bougie: '🕯️', kaars: '🕯️', vela: '🕯️', candela: '🕯️', swieczka: '🕯️',
  batteries: '🔋', batterien: '🔋', piles: '🔋', batterijen: '🔋', pilas: '🔋',
  batterie: '🔋', baterie: '🔋',

  // --- personal care --------------------------------------------------------
  shampoo: '🧴', champu: '🧴', szampon: '🧴',
  toothpaste: '🪥', zahnpasta: '🪥', dentifrice: '🪥', tandpasta: '🪥', dentifricio: '🪥',
  'pasta de dientes': '🪥', 'pasta do zebow': '🪥',
  toothbrush: '🪥', zahnburste: '🪥', tandenborstel: '🪥',
  deodorant: '🧴', deodorante: '🧴', dezodorant: '🧴',
  razor: '🪒', rasierer: '🪒', rasoir: '🪒', scheermes: '🪒', maquinilla: '🪒',
  rasoio: '🪒', maszynka: '🪒',
  medicine: '💊', medikamente: '💊', medicament: '💊', medicijnen: '💊',
  medicina: '💊', leki: '💊',

  // --- misc -----------------------------------------------------------------
  flowers: '💐', blumen: '💐', fleurs: '💐', bloemen: '💐', flores: '💐', fiori: '💐', kwiaty: '💐',
  cat: '🐱', dog: '🐶', katzenfutter: '🐱', hundefutter: '🐶', kattenvoer: '🐱', hondenvoer: '🐶',
};

/**
 * Letters that Unicode normalization will not take apart.
 *
 * NFD splits "é" into "e" + a combining accent, which the range below then
 * drops — but ł, ø, œ and ß have no canonical decomposition, so they survive
 * NFD untouched and "Masło" never matches "maslo". Missing these is the exact
 * shape of a bug that looks fine in English and silently gives Polish, Danish
 * and French users a generic icon, so they're mapped explicitly.
 */
const LIGATURES: Record<string, string> = {
  ł: 'l', ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', đ: 'd', ð: 'd', þ: 'th', ı: 'i',
};

/**
 * Lowercase and strip accents, so "Pêche" and "peche" are the same key.
 *
 * The combining-marks range is spelled out with escapes rather than using
 * \p{Diacritic}, which needs Unicode property escapes — supported on Hermes
 * today, but this runs on every row and the explicit range has no engine
 * caveats.
 */
export const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[łøœæßđðþı]/g, (c) => LIGATURES[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The shared lexicon (migration 0019), injected rather than imported.
 *
 * This module is pure on purpose — no storage, no network, no React — so it can
 * be exercised standalone by check-item-emoji.mjs and called freely during
 * render. The lexicon cache needs AsyncStorage and Supabase, and importing it
 * here would drag both onto a hot pure path and break that check script.
 *
 * So the app wires the resolver in at startup (see _layout.tsx). Unwired — in
 * tests, or before hydration finishes — it returns undefined and every lookup
 * falls through to exactly the behaviour that existed before it.
 */
type LexiconResolver = (foldedTerm: string) => string | undefined;
let lexicon: LexiconResolver = () => undefined;

export function setEmojiLexicon(resolver: LexiconResolver): void {
  lexicon = resolver;
}

/**
 * Very light plural/inflection trimming, tried only after the exact word misses.
 *
 * This is not morphology — it's the handful of endings that would otherwise
 * make "Bananen", "tomates" and "jablka" fall through to a category icon when
 * their singular is right there in the table. Anything cleverer belongs in the
 * table itself, where it can be seen and corrected.
 */
const STEM_SUFFIXES = ['en', 'es', 's', 'i', 'e', 'y', 'a'];

function lookupWord(word: string): string | undefined {
  if (!word) return undefined;
  const direct = ITEM_EMOJI[word];
  if (direct) return direct;
  for (const suffix of STEM_SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (ITEM_EMOJI[stem]) return ITEM_EMOJI[stem];
    }
  }
  return undefined;
}

/**
 * The emoji for an item. Never empty.
 *
 * Order matters: the whole name first (so "olive oil" beats "oil", and
 * "ice cream" doesn't become an ice cube), then each word left to right, then
 * the category. Passing the category is what guarantees a sensible answer for
 * everything the table has never heard of.
 */
export function emojiFor(name: string, category: ItemCategory = 'other'): string {
  const folded = fold(name);
  if (!folded) return CATEGORY_EMOJI[category] ?? CATEGORY_EMOJI.other;

  // 1. Curated table, whole name — "ice cream" / "icecream" both spellings.
  const whole = lookupWord(folded) ?? lookupWord(folded.replace(/\s+/g, ''));
  if (whole) return whole;

  // 2. Shared lexicon, whole term. Ordered above the word scan deliberately:
  //    an exact match on the full string is more specific than a partial match
  //    on one of its words, whichever source it came from. "Coconut water"
  //    known in full beats matching "coconut" and calling it a 🥥.
  const learned = lexicon(folded);
  if (learned) return learned;

  // 3. Curated table, word by word.
  for (const word of folded.split(/[\s,./-]+/)) {
    const hit = lookupWord(word);
    if (hit) return hit;
  }

  // 4. The category, which always has an answer.
  return CATEGORY_EMOJI[category] ?? CATEGORY_EMOJI.other;
}

/**
 * The curated table, exposed.
 *
 * Read by lib/item-category.ts, which derives an aisle for every term here
 * rather than keeping a second list of the same 646 words in seven languages.
 * One table names the concepts; the other says which aisle each concept's
 * emoji belongs to. Adding a word in a new language gets it an emoji, a unit
 * AND a category, with no second edit to remember.
 */
export const __ITEM_EMOJI = ITEM_EMOJI;
