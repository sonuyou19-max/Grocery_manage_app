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
  // Fresh cheeses. Paneer showed the dairy category's milk glass, which is the
  // fallback for anything this table does not know — it is a cheese, and 🧀 is
  // right there.
  paneer: '🧀', ricotta: '🧀', halloumi: '🧀', quark: '🧀', mascarpone: '🧀',
  brie: '🧀', camembert: '🧀', burrata: '🧀', 'goat cheese': '🧀', chevre: '🧀',
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
  // Tropical fruit Unicode has no glyph for. The mango stands in: it is the
  // table's only tropical fruit and reads as one, which is a great deal closer
  // than the head of lettuce these were getting from the fruit_veg fallback.
  guava: '🥭', guayaba: '🥭', gojave: '🥭', goiaba: '🥭', guawa: '🥭',
  papaya: '🥭', papaja: '🥭', lychee: '🥭', litchi: '🥭', passionfruit: '🥭',
  maracuja: '🥭', granatapfel: '🥭', pomegranate: '🥭', granada: '🥭',
  melograno: '🥭', granat: '🥭',
  blueberries: '🫐', heidelbeeren: '🫐', myrtilles: '🫐', bosbessen: '🫐', arandanos: '🫐',
  mirtilli: '🫐', borowki: '🫐',
  coconut: '🥥', kokosnuss: '🥥', noix: '🌰', kokos: '🥥',

  // --- vegetables ----------------------------------------------------------
  tomato: '🍅', tomatoes: '🍅', tomate: '🍅', tomaten: '🍅', tomates: '🍅',
  pomodoro: '🍅', pomodori: '🍅', pomidory: '🍅', pomidor: '🍅',
  /*
   * Cherry tomatoes are a tomato, and the word scan says otherwise.
   *
   * `cherry` is in this table, comes first, and wins — so the whole phrase came
   * back 🍒. A qualifier that is itself a food beating the noun it qualifies is
   * the same shape as `water colour` and `almond milk`, both fixed above by
   * rules; this one is fixed by naming the phrase, because the head noun sits
   * LAST here and no positional rule that fixes it leaves `olive oil` alone.
   *
   * Whole-name entries are tier one, above both the lexicon and the word scan,
   * so these settle it before `cherry` is ever looked at.
   */
  'cherry tomato': '🍅', 'cherry tomatoes': '🍅', cherrytomaat: '🍅',
  kerstomaat: '🍅', kerstomaten: '🍅', cherrytomaten: '🍅',
  kirschtomate: '🍅', kirschtomaten: '🍅', 'tomate cerise': '🍅',
  'tomates cerises': '🍅', 'tomate cherry': '🍅', 'tomates cherry': '🍅',
  pomodorino: '🍅', pomodorini: '🍅', 'pomidorki koktajlowe': '🍅',
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
  // The individual nuts, which were all landing on the pantry can. Singular and
  // plural both, because this table matches words rather than stems and an
  // English shopper writes "almonds" as often as "almond".
  almond: '🥜', almonds: '🥜', mandel: '🥜', mandeln: '🥜', amande: '🥜',
  amandes: '🥜', amandel: '🥜', amandelen: '🥜', almendra: '🥜', almendras: '🥜',
  mandorla: '🥜', mandorle: '🥜', migdal: '🥜', migdaly: '🥜',
  cashew: '🥜', cashews: '🥜', anacardi: '🥜', anacardos: '🥜', nerkowce: '🥜',
  pistachio: '🥜', pistachios: '🥜', pistazien: '🥜', pistaches: '🥜',
  pistacchi: '🥜', pistacje: '🥜',
  walnut: '🌰', walnuts: '🌰', walnuss: '🌰', walnusse: '🌰', walnoten: '🌰',
  chestnut: '🌰', maroni: '🌰', chataignes: '🌰', castagne: '🌰', kasztany: '🌰',
  hazelnut: '🌰', hazelnuts: '🌰', haselnusse: '🌰', noisettes: '🌰',
  hazelnoten: '🌰', avellanas: '🌰', nocciole: '🌰', 'orzechy laskowe': '🌰',
  chocolate: '🍫', schokolade: '🍫', chocolat: '🍫', chocolade: '🍫', cioccolato: '🍫', czekolada: '🍫',
  beans: '🫘', bohnen: '🫘', haricots: '🫘', bonen: '🫘', frijoles: '🫘', fagioli: '🫘', fasola: '🫘',
  // Whole names, because the word scan finds `butter` first and files a legume
  // under dairy. lib/eco has carried the same three entries since butter beans
  // were first scored as a high-carbon animal product; now that the aisle and
  // the glyph come from one match, listing them here fixes both at once instead
  // of needing a third copy in lib/item-category.
  'butter beans': '🫘', 'butter bean': '🫘', butterbeans: '🫘',
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
  // Art supplies. Added as a CONCEPT rather than as another qualifier rule: the
  // reason "water colour" showed a droplet is that the table had no word for
  // paint at all, so the scan had nothing better to find than `water`.
  paint: '🎨', paints: '🎨', 'water colour': '🎨', 'water color': '🎨',
  watercolour: '🎨', watercolor: '🎨', crayon: '🎨', crayons: '🎨',
  farbe: '🎨', farben: '🎨', malfarbe: '🎨', malfarben: '🎨',
  wasserfarbe: '🎨', wasserfarben: '🎨', buntstifte: '🎨',
  verf: '🎨', waterverf: '🎨', peinture: '🎨', peintures: '🎨',
  pintura: '🎨', pinturas: '🎨', pittura: '🎨', farba: '🎨', farby: '🎨',
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
 * The mirror of supabase/functions/_shared/canonical.ts. See that file for why
 * this exists and which words are — and are NOT — stripped. The two must agree
 * character for character or the device and server swap caches stop lining up;
 * scripts/check-canonical.mjs asserts it.
 *
 * Kept in THIS module rather than its own so the swaps device cache can reach it
 * without a second import, and so the one file the check script already loads to
 * compare folds carries the canonicaliser too.
 */
const CANONICAL_NOISE = new Set<string>([
  'organic', 'bio', 'biologico', 'biologisch', 'ecologico', 'ekologiczny',
  'premium', 'finest', 'deluxe', 'extra', 'value', 'economy', 'basic',
  'free', 'range', 'grass', 'fed', 'farm', 'farmhouse', 'local',
  'freiland', 'weide', 'fermier', 'fattoria', 'granja', 'boerderij', 'wiejski',
  'unsalted', 'salted', 'ungesalzen', 'gesalzen', 'salato', 'salado',
  'niesolony', 'solony', 'ongezouten', 'gezouten',
  'sharp', 'mature', 'mild', 'strong',
  'wurzig', 'gereift', 'affine', 'doux', 'fort', 'stagionato', 'dolce',
  'piccante', 'suave', 'fuerte', 'belegen', 'pittig', 'lagodny', 'ostry',
]);

/** Drop store-tier, provenance, salt and maturity words from a folded name. */
export const canonicalize = (folded: string): string => {
  if (!folded) return folded;
  const kept = folded.split(' ').filter((w) => w && !CANONICAL_NOISE.has(w));
  return kept.length ? kept.join(' ') : folded;
};

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

/**
 * The table KEY a word resolves to, not the emoji it carries.
 *
 * The key is the more useful of the two because the emoji can be recovered from
 * it and the reverse is not true: 🍓 is both strawberry and jam, and lib/
 * item-category has to tell them apart to file one under produce and the other
 * under pantry. Returning the key is what lets a second caller ask a different
 * question about the same match.
 */
function lookupTerm(word: string): string | undefined {
  if (!word) return undefined;
  if (ITEM_EMOJI[word]) return word;
  for (const suffix of STEM_SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (ITEM_EMOJI[stem]) return stem;
    }
  }
  return undefined;
}

/**
 * A nut in a two-word name is usually the FLAVOUR, not the thing.
 *
 * "Almond milk" is a milk. "Alpro almond milk" is a milk. So is "lait
 * d'amande" — and that last one is why this cannot be a rule about word order.
 * English builds these compounds head-last and the Romance languages build
 * them head-first, so "take the last word" would fix German and break French.
 * What the two share is the shape of the pair: one word names a plant, the
 * other names a product made with it, and the product is what went in the
 * trolley.
 *
 * The sets are derived from the table rather than written out again, so a nut
 * added in an eighth language is covered the day it lands and cannot drift
 * from the list it is supposed to mirror. `NUT` is exactly the two nut glyphs.
 * `NUT_YIELDS_TO` is the small set of products a nut is routinely a flavour
 * of — milk and cream (🥛), flour (🌾), oil (🫒), yoghurt and cereal (🥣).
 *
 * Butter is deliberately NOT in that set: peanut butter is a nut product and
 * has always shown 🥜, almond butter is the same kind of thing, and a butter
 * dish for both would be a worse answer than the one this replaces.
 */
const NUT = new Set(['🥜', '🌰']);
const NUT_YIELDS_TO = new Set(['🥛', '🌾', '🫒', '🥣']);

/**
 * Glyphs that win a word scan outright, wherever in the name they appear.
 *
 * "Water colour" is the case. `water` comes first and is a real word for a real
 * product, so no amount of ordering helps — the only thing that separates the
 * two readings is that one of them is not food. A name containing a word for
 * paint is about paint, whatever else it also contains.
 *
 * This is the same judgement lib/item-category's NON_FOOD_QUALIFIERS makes, and
 * it stays a very short list for the same reason: it is strong enough that a
 * word only belongs here when its presence settles the question in every
 * context. Paint qualifies. "Fresh" or "organic" would not.
 */
const SETTLES_IT = new Set(['🎨']);

/**
 * What the curated table matched, and on which term.
 *
 * ---------------------------------------------------------------------------
 * Why this is exported rather than kept inside emojiFor
 * ---------------------------------------------------------------------------
 *
 * lib/item-category used to run its own copy of this resolution — whole name
 * first, then word by word — over a table derived from this one. Two scans over
 * the same words, which is fine right up to the moment one of them learns
 * something the other has not.
 *
 * That moment arrived with the nut rule below. "Almond milk" resolved to 🥛
 * here and to Pantry there, because the aisle scan still stopped at `almond`.
 * The row showed a carton of milk filed under tinned goods, and no amount of
 * care in either file would have caught it — the bug is the duplication, not
 * the code.
 *
 * It is also the fourth of its kind. Butter beans read as dairy, beef stock
 * cubes as a joint, water colour as a drink, almond milk as a nut: every one a
 * word scan stopping on a word that qualifies the item rather than naming it,
 * and every one fixed in whichever file happened to be in front of me. Sharing
 * the resolution is what makes the fifth fix land in both places at once.
 *
 * Two functions rather than one because the tiers are not adjacent: emojiFor
 * puts the learned lexicon BETWEEN them (an exact match on the full string
 * beats a partial match on one word, whichever source it came from), while the
 * category path deliberately consults the lexicon later still, through
 * lib/categorize. Handing out one combined resolver would force one of those
 * orders onto the other.
 *
 * Both take an ALREADY-FOLDED name — every caller has folded it to get here.
 */
export interface CuratedHit {
  /** The table key that matched, which may be a stem of the word given. */
  term: string;
  emoji: string;
}

/** An exact match on the whole name, joined-up spelling included. */
export function curatedWhole(folded: string): CuratedHit | null {
  const term = lookupTerm(folded) ?? lookupTerm(folded.replace(/\s+/g, ''));
  return term ? { term, emoji: ITEM_EMOJI[term]! } : null;
}

/** The word-by-word scan, including the nut precedence rule below. */
export function curatedWord(folded: string): CuratedHit | null {
  const hits: CuratedHit[] = [];
  for (const word of folded.split(/[\s,./-]+/)) {
    const term = lookupTerm(word);
    if (term) hits.push({ term, emoji: ITEM_EMOJI[term]! });
  }
  if (hits.length === 0) return null;

  // Checked across every hit, not just the first: `water` precedes `colour` and
  // is what made the droplet win.
  const settled = hits.find((hit) => SETTLES_IT.has(hit.emoji));
  if (settled) return settled;

  const first = hits[0]!;
  if (NUT.has(first.emoji)) {
    const product = hits.find((hit) => NUT_YIELDS_TO.has(hit.emoji));
    if (product) return product;
  }
  return first;
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
  const whole = curatedWhole(folded);
  if (whole) return whole.emoji;

  // 2. Shared lexicon, whole term. Ordered above the word scan deliberately:
  //    an exact match on the full string is more specific than a partial match
  //    on one of its words, whichever source it came from. "Coconut water"
  //    known in full beats matching "coconut" and calling it a 🥥.
  const learned = lexicon(folded);
  if (learned) return learned;

  // 3. Curated table, word by word — including the nut rule, which lib/
  //    item-category now inherits rather than having to be told about.
  const word = curatedWord(folded);
  if (word) return word.emoji;

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
