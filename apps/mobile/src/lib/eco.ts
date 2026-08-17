import type { CarbonTier, ItemCategory } from '@korb/shared';

import { fold } from '@/lib/item-emoji';
import { foodGroupOf, type DisplayGroup } from '@/lib/nutrition';

/**
 * The climate side of a basket: which items are heavy, which are light, and
 * how the week is going.
 *
 * ---------------------------------------------------------------------------
 * Why the tier is computed here and not asked for per item
 * ---------------------------------------------------------------------------
 *
 * The obvious build is "when the AI categorises an item, also ask it whether
 * the item is high, medium or low carbon". The categorize function does now
 * answer that — see below — but it is the LAST resort, not the first, and the
 * reason is that this feature is a comparison.
 *
 * A model asked twice about "milk" can say medium on Tuesday and low on Friday.
 * That is tolerable for an emoji. It is not tolerable for a score you are
 * invited to improve week over week, and it is actively broken in a shared
 * household, where two phones asking independently would put different dots on
 * the same row of the same list. Basket balance already learned this lesson —
 * see the note on determinism in nutrition.ts — and this is the same shape of
 * problem one step further on, because a mix is descriptive and a score is a
 * judgement people will argue with.
 *
 * So the resolution order mirrors emoji and units:
 *
 *   1. `CARBON_KEYWORDS` — the items that actually move the number, decided
 *      once, in code, identically on every device and with no network.
 *   2. the item's food group — a defensible default for everything else.
 *   3. the shared lexicon, written by the model on first sighting of a term
 *      nobody has typed before, then published so every later user gets the
 *      same answer with no call at all.
 *
 * Step 3 is where the AI earns its place: one answer per term, for everyone,
 * forever. Not one answer per person per lookup.
 *
 * ---------------------------------------------------------------------------
 * Where the bands come from
 * ---------------------------------------------------------------------------
 *
 * Poore & Nemecek (Science, 2018), the standard meta-analysis of food's
 * environmental impact, in kg CO2e per kg of product at retail:
 *
 *   beef 60 · lamb 24 · cheese 21 · prawns 12 · pork 7 · chicken 6 · eggs 4.5
 *   rice 4 · farmed fish 5 · cow's milk 3 · tofu 3 · oils 3–6 · bread 1.4
 *   beans 0.8 · fruit 0.7 · vegetables 0.5 · potatoes 0.5 · nuts 0.4
 *
 * The cuts are at roughly 2 and 7. They are coarse on purpose: the gap between
 * beef and lentils is a factor of seventy and survives any reasonable
 * methodology, while the gap between chicken and eggs does not, and a product
 * that pretends to resolve the second loses the right to be believed about the
 * first.
 */

export type { CarbonTier };

/**
 * Impact colours, deliberately not the theme's status colours.
 *
 * `crit` is the app's error red and appears when something has gone wrong. A
 * steak is not an error, and a shopping list that lights up with the same red
 * used for failures is scolding rather than informing. These are the same kind
 * of fixed mid-tones as GROUP_COLORS: they hold on both light and dark
 * surfaces, and they are far enough apart in hue AND value to survive being 8px
 * dots next to each other on a cheap panel.
 *
 * Red does appear here, and that is the difference from basket balance. A food
 * group is not a judgement, so nothing there is allowed to look like one. An
 * impact band IS a judgement — the user asked for exactly that — so the scale
 * is allowed to run to a warning colour. It is a clay red rather than a signal
 * red so it reads as "heavy", not "wrong".
 */
export const CARBON_COLORS: Record<CarbonTier, string> = {
  low: '#4E9E62',
  medium: '#D19A2E',
  high: '#C4562F',
};

/**
 * Group-level default. Correct for the two groups that are nearly uniform, and
 * a starting point for the three that are not — which the keywords below fix.
 *
 * `protein` is medium rather than high even though it holds beef, because it
 * also holds lentils, tofu, beans and eggs; defaulting the whole group to high
 * would paint a vegetarian basket red. The heavy members are named explicitly.
 */
const GROUP_CARBON: Record<DisplayGroup, CarbonTier> = {
  produce: 'low',
  carbs: 'low',
  protein: 'medium',
  fats: 'medium',
  other: 'medium',
};

/**
 * The terms that decide the answer, in the seven languages Korb ships plus the
 * English a European shopper types anyway.
 *
 * Only the movers are here. Anything not listed falls to its group, which is
 * why this table is a page rather than a dictionary: adding "courgette: low"
 * changes nothing, because produce is already low.
 */
const CARBON_KEYWORDS: Record<string, CarbonTier> = {
  // ---- high: ruminants, hard cheese, butter, prawns, and the two tropical
  // crops whose per-kilo figures rival meat.
  beef: 'high', steak: 'high', mince: 'high', burger: 'high', veal: 'high',
  rind: 'high', rindfleisch: 'high', hackfleisch: 'high', boeuf: 'high', manzo: 'high',
  ternera: 'high', vaca: 'high', rundvlees: 'high', wolowina: 'high',
  lamb: 'high', mutton: 'high', lamm: 'high', agneau: 'high', agnello: 'high',
  cordero: 'high', lam: 'high', jagniecina: 'high',
  cheese: 'high', parmesan: 'high', cheddar: 'high', gouda: 'high', brie: 'high',
  kase: 'high', fromage: 'high', formaggio: 'high', queso: 'high', kaas: 'high', ser: 'high',
  butter: 'high', beurre: 'high', burro: 'high', mantequilla: 'high', maslo: 'high',
  // Clarified butter: roughly 1.25 kg of butter cooked down into 1 kg of this,
  // so it is heavier per kilo than what it is made from and can never be the
  // lighter answer. Named explicitly because without it `ghee` fell through to
  // the `fats` group default of medium, and the swap engine duly offered it as a
  // lighter alternative to butter.
  ghee: 'high', tallow: 'high', lard: 'high',
  prawns: 'high', prawn: 'high', shrimp: 'high', scampi: 'high', garnelen: 'high',
  crevettes: 'high', gamberi: 'high', gambas: 'high', garnalen: 'high', krewetki: 'high',
  chocolate: 'high', schokolade: 'high', chocolat: 'high', cioccolato: 'high', czekolada: 'high',
  // Cocoa is the part of a chocolate bar that carries the footprint, so the
  // powder is not the lighter option — it is the same crop with the sugar and
  // milk taken out. Missing here, it fell to `other` and scored medium, which
  // made the powder look like an improvement on the bar AND kept it off Heavy
  // Hitters however often it was bought.
  cocoa: 'high', cacao: 'high', kakao: 'high',
  kakaopulver: 'high', cacaopoeder: 'high',
  coffee: 'high', kaffee: 'high', cafe: 'high', caffe: 'high', koffie: 'high', kawa: 'high',

  // ---- medium: pork, poultry, eggs, fish, dairy liquids, rice, oils.
  pork: 'medium', bacon: 'medium', ham: 'medium', sausage: 'medium', schwein: 'medium',
  speck: 'medium', schinken: 'medium', porc: 'medium', jambon: 'medium', maiale: 'medium',
  prosciutto: 'medium', cerdo: 'medium', jamon: 'medium', varkensvlees: 'medium',
  wieprzowina: 'medium', szynka: 'medium', kielbasa: 'medium',
  chicken: 'medium', turkey: 'medium', poultry: 'medium', hahnchen: 'medium',
  poulet: 'medium', pollo: 'medium', kip: 'medium', kurczak: 'medium', dinde: 'medium',
  fish: 'medium', salmon: 'medium', tuna: 'medium', cod: 'medium', fisch: 'medium',
  lachs: 'medium', poisson: 'medium', saumon: 'medium', pesce: 'medium', salmone: 'medium',
  pescado: 'medium', vis: 'medium', zalm: 'medium', ryba: 'medium', losos: 'medium',
  milk: 'medium', cream: 'medium', yogurt: 'medium', yoghurt: 'medium', milch: 'medium',
  sahne: 'medium', joghurt: 'medium', lait: 'medium', creme: 'medium', yaourt: 'medium',
  latte: 'medium', panna: 'medium', leche: 'medium', nata: 'medium',
  melk: 'medium', room: 'medium', mleko: 'medium', smietana: 'medium', jogurt: 'medium',
  eggs: 'medium', egg: 'medium', eier: 'medium', oeufs: 'medium', uova: 'medium',
  huevos: 'medium', eieren: 'medium', jajka: 'medium', jaja: 'medium',
  rice: 'medium', reis: 'medium', riz: 'medium', riso: 'medium', arroz: 'medium',
  rijst: 'medium', ryz: 'medium',

  // ---- low: the plant staples that sit in `protein`, `fats` or `other` and
  // would otherwise inherit a medium they do not deserve.
  tofu: 'low', tempeh: 'low', seitan: 'low',
  lentils: 'low', lentil: 'low', linsen: 'low', lentilles: 'low', lenticchie: 'low',
  lentejas: 'low', linzen: 'low', soczewica: 'low',
  beans: 'low', bean: 'low', chickpeas: 'low', bohnen: 'low', kichererbsen: 'low',
  haricots: 'low', pois: 'low', fagioli: 'low', ceci: 'low', frijoles: 'low', garbanzos: 'low',
  bonen: 'low', fasola: 'low', ciecierzyca: 'low',
  // Whole-name entries, and the reason is a word collision: the scan below finds
  // the FIRST keyword in a name, and "butter beans" contains `butter` (high)
  // before `beans` (low), so this legume was scoring as dairy butter — the exact
  // trap that made it show as a high-impact suggestion under a "Best impact drop"
  // badge. Matched whole, before the scan, they read as the beans they are.
  // Peanut butter is the same collision the other way: a ground legume spread,
  // nearer eggs than beef, not the `high` its `butter` earned it.
  'butter beans': 'low', 'butter bean': 'low', butterbeans: 'low',
  'peanut butter': 'medium', 'peanut butters': 'medium',
  nuts: 'low', almonds: 'low', walnuts: 'low', nusse: 'low', mandeln: 'low',
  noix: 'low', amandes: 'low', noci: 'low', mandorle: 'low', nueces: 'low', almendras: 'low',
  noten: 'low', orzechy: 'low', migdaly: 'low',
  // The cocoa substitute, and the only reason it is listed: it is what rung 2
  // of a chocolate ladder should be, and a suggestion the app then scores as
  // medium is a suggestion that does not pay.
  carob: 'low', johannisbrot: 'low', carruba: 'low', carrube: 'low',
  algarroba: 'low', karob: 'low', caroube: 'low',
};

/**
 * Every key above is in FOLDED form — lower case, accents stripped, ligatures
 * expanded — because that is what `fold` hands back and a key it can never
 * produce is a key that can never match. Writing `kase` rather than `kase` with
 * an umlaut looks like a typo and is the opposite: an entry spelled the way a
 * German shopper types it would be dead code, matched by nothing.
 */

/*
 * Words that mean "this is the plant version", in the seven languages shipped.
 *
 * These have to be checked BEFORE the animal keywords, and the reason is a bug
 * worth stating plainly: the table below scores by the heaviest word it finds,
 * so "plant-based butter" found `butter` and came back HIGH — the same band as
 * the dairy butter it exists to replace. So did "plant-based mince" (`mince`)
 * and "plant-based cheddar slices" (`cheddar`). Which made the swap suggestions
 * self-defeating: follow the advice, buy the alternative, and the score does not
 * move, because the app has just scored the substitute as the original.
 *
 * A qualifier wins over everything after it. "Pflanzliche Butter" is not butter,
 * whatever the noun says.
 *
 * `low` rather than `medium`, and it is a coarse call. Plant analogues run
 * around 2-4 kg CO2e/kg against beef's 60 and butter's 12, which puts them with
 * the legumes and breads this app already calls low. Three bands cannot express
 * "lower than dairy but above a lentil", and of the two available answers `low`
 * is much closer to true than `medium`.
 */
const PLANT_QUALIFIERS = [
  // en
  'plant', 'plantbased', 'vegan', 'meatfree', 'dairyfree', 'meatless',
  // de / nl
  'pflanzlich', 'pflanzliche', 'pflanzlicher', 'plantaardig', 'plantaardige',
  'vegane', 'veganer', 'veganes',
  // fr / it / es
  'vegetal', 'vegetale', 'vegetali', 'vegetaux', 'vegano', 'vegana',
  'vegetariano', 'vegetarien',
  // pl
  'roslinne', 'roslinny', 'roslinna', 'weganskie', 'weganski', 'weganska',
  // the common plant bases, which carry the same meaning without saying "vegan"
  'oat', 'oats', 'soy', 'soya', 'soja', 'almond', 'almonds', 'cashew',
  'cashews', 'coconut', 'hafer', 'avena', 'owsiane', 'mandel',
];

/*
 * Words that say "this is a flavouring made from the meat, not the meat".
 *
 * A beef stock cube is mostly salt with a trace of beef extract; a 10g cube used
 * across a week of meals is not the ribeye its name shares. But the scan below
 * reads `beef` and calls it high, which put "beef stock cubes" into Heavy
 * Hitters next to a braising joint and set the same red alarm — over-claiming, in
 * a feature whose whole promise is an honest, unpreachy number.
 *
 * So a marker here CAPS the item at medium: checked after the plant qualifiers
 * (a "vegetable stock" is still lighter than a beef one) and before the animal
 * nouns, so the meat word can no longer drive the band up. Medium rather than low
 * because we are not crediting it as a lentil either — just refusing to sound the
 * alarm a whole cut earns. The effect that matters: capped at medium, it drops
 * out of Heavy Hitters, which lists `high` only.
 */
const DILUTED_MARKERS = [
  // en
  'stock', 'broth', 'bouillon', 'gravy', 'consomme',
  // de / nl (bouillon shared)
  'bruhe', 'bruehe', 'fond', 'brodo', 'dado', 'caldo', 'bulion', 'rosol',
];

function keywordCarbon(name: string): CarbonTier | null {
  const clean = fold(name);
  // Whole name first — "ice cream" must not be decided by a word inside it —
  // then each word, so "organic beef mince" still finds beef.
  if (CARBON_KEYWORDS[clean]) return CARBON_KEYWORDS[clean];

  const words = clean.split(/[\s,./-]+/);
  // Before the animal nouns, never after. See PLANT_QUALIFIERS.
  if (words.some((w) => PLANT_QUALIFIERS.includes(w))) return 'low';
  // A stock or condiment made from meat is capped, not scored by the meat.
  if (words.some((w) => DILUTED_MARKERS.includes(w))) return 'medium';

  for (const word of words) {
    if (CARBON_KEYWORDS[word]) return CARBON_KEYWORDS[word];
  }
  return null;
}

/**
 * An item's impact band, or null when the item is not food.
 *
 * Non-food is null rather than 'low' on purpose. Washing-up liquid has a
 * footprint, but it is not comparable to a kilo of anything edible and Korb has
 * no basis for placing it, so it is left out of the mix entirely — exactly as
 * basket balance leaves it out. A basket of bleach should not score 100.
 *
 * `shared` is the lexicon's answer, used only when neither the keyword table
 * nor the group has an opinion — which, because the group always does for food,
 * means it is consulted for terms whose category is itself unknown.
 */
export function carbonOf(
  name: string,
  category: ItemCategory,
  shared?: CarbonTier | null,
): CarbonTier | null {
  const group = foodGroupOf(name, category);
  if (!group) return null;
  return keywordCarbon(name) ?? shared ?? GROUP_CARBON[group];
}

/** Points a band contributes to the 0–100 score. */
const TIER_POINTS: Record<CarbonTier, number> = { low: 100, medium: 55, high: 15 };

/**
 * How much of the score the bio/local flag can move it.
 *
 * Ten points, and capped, because the honest evidence does not support more.
 * Organic farming is frequently HIGHER carbon per kilo than conventional — the
 * yields are lower, so the same food needs more land — and transport is around
 * 6% of food emissions, so "local" moves the climate number far less than
 * people expect. Folding either into a carbon figure at full weight would be
 * teaching something false to people who trusted us.
 *
 * What bio and local genuinely buy is not carbon: fewer pesticides, better soil
 * and biodiversity outcomes, money that stays nearby. Those are real and worth
 * rewarding, which is why the flag exists and why the headline is an ECO score
 * rather than a carbon score. It is reported as its own line in the card, next
 * to the impact mix, so nobody has to take the composition on trust.
 */
const BIO_BONUS_POINTS = 10;

export interface EcoItem {
  name: string;
  category: ItemCategory;
  /** The shopper's own "this one is organic or local" flag. */
  bio?: boolean | null;
  /** The lexicon's band, when the caller has one. */
  carbon?: CarbonTier | null;
}

export interface EcoScore {
  /** Food items counted. Non-food is excluded, so this is not items.length. */
  total: number;
  counts: Record<CarbonTier, number>;
  /** Share of the food items in each band, 0..1, summing to 1 when total > 0. */
  shares: Record<CarbonTier, number>;
  bioCount: number;
  bioShare: number;
  /** 0–100. Null when there is no food to score — not zero, which is a verdict. */
  score: number | null;
}

/**
 * Score a basket, a shop, or a week — anything that is a list of items.
 *
 * Every food item counts once. Korb has no weights for most items, so this
 * cannot be and does not claim to be a footprint: it is the SHAPE of a basket,
 * the same claim basket balance makes about food groups. One steak among twenty
 * vegetables reads as a mostly-low basket, which is a fair description of the
 * shop and a lie about the kilos. The card says so in as many words.
 */
export function ecoScore(items: EcoItem[]): EcoScore {
  const counts: Record<CarbonTier, number> = { low: 0, medium: 0, high: 0 };
  let total = 0;
  let bioCount = 0;
  let points = 0;

  for (const it of items) {
    const tier = carbonOf(it.name, it.category, it.carbon);
    if (!tier) continue;
    counts[tier] += 1;
    total += 1;
    points += TIER_POINTS[tier];
    if (it.bio) bioCount += 1;
  }

  if (total === 0) {
    return {
      total: 0,
      counts,
      shares: { low: 0, medium: 0, high: 0 },
      bioCount: 0,
      bioShare: 0,
      score: null,
    };
  }

  const bioShare = bioCount / total;
  const base = points / total;
  const score = Math.min(100, Math.round(base + BIO_BONUS_POINTS * bioShare));

  return {
    total,
    counts,
    shares: {
      low: counts.low / total,
      medium: counts.medium / total,
      high: counts.high / total,
    },
    bioCount,
    bioShare,
    score,
  };
}

/* ------------------------------------------------------------ over time */

/**
 * A purchase, as far as this module is concerned. Structural, so the log's
 * `Purchase` satisfies it without eco.ts importing the store.
 */
export interface EcoPurchase {
  name: string;
  category: ItemCategory | null;
  store: string | null;
  at: number;
  bio: boolean;
}

/**
 * Below this many food items a week's score is noise.
 *
 * Two items is not a shop, and one steak in a two-item week would print a score
 * of 15 next to a week of ordinary shopping at 70 — a fall the household did
 * not make. Thin weeks return null and the chart draws a gap, which is the
 * honest shape: we do not know how that week went.
 */
const MIN_ITEMS_FOR_SCORE = 4;

export interface EcoWeek {
  /** Local Monday midnight, matching the spend chart's buckets exactly. */
  weekStart: number;
  score: number | null;
  total: number;
}

/**
 * Eco score per week, oldest first, including weeks with nothing in them.
 *
 * Mirrors `weeklySpend` on purpose — same bucketing, same "empty weeks are
 * data" rule — so the two charts on the Insights tab line up week for week and
 * a reader can look from one to the other without re-reading the axis.
 */
export function weeklyEco(
  purchases: EcoPurchase[],
  now: number,
  weekStartOf: (at: number) => number,
  weeks = 8,
): EcoWeek[] {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = weekStartOf(now);
  const oldest = thisWeek - (weeks - 1) * WEEK;

  const buckets = new Map<number, EcoItem[]>();
  for (let i = 0; i < weeks; i += 1) buckets.set(weekStartOf(oldest + i * WEEK), []);

  for (const p of purchases) {
    const bucket = buckets.get(weekStartOf(p.at));
    if (!bucket) continue;
    bucket.push({ name: p.name, category: p.category ?? 'other', bio: p.bio });
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, items]) => {
      const eco = ecoScore(items);
      return {
        weekStart,
        score: eco.total >= MIN_ITEMS_FOR_SCORE ? eco.score : null,
        total: eco.total,
      };
    });
}

/* ------------------------------------------------------ the biggest lever */

export interface HeaviestStaple {
  /** As the shopper writes it. */
  name: string;
  /** Purchases in the window — what makes it a habit rather than a one-off. */
  times: number;
}

/**
 * At least this many purchases before an item counts as something you buy
 * "regularly". Two is a coincidence; three is a pattern, and the sentence this
 * feeds says "regularly" out loud.
 */
const HABIT_PURCHASES = 3;

/**
 * The heavy item this household buys most often.
 *
 * ---------------------------------------------------------------------------
 * Why one item and not a list
 * ---------------------------------------------------------------------------
 *
 * A list of suggested substitutions was built and then deleted, because generic
 * advice is noise: everyone gets the same eight rows, most of which are about
 * food they never buy. This is the sharp version of the same idea. Korb knows
 * which heavy item YOU buy most, and for one household that is cheese, for
 * another coffee, for another beef — the single biggest lever, different every
 * time, and derivable from data already on the device.
 *
 * It returns a fact and nothing else. No "try swapping", no target, no saving.
 * The reader knows perfectly well what to do with "cheese is the heaviest thing
 * you buy regularly"; being told would turn an observation into a lecture, and
 * the lecture is the part people uninstall over.
 */
/**
 * Every heavy item this household buys, most frequent first.
 *
 * The plural of heaviestStaple, and it exists for a screen that did not before:
 * the card names ONE item because a card has room for one sentence, while the
 * Climate Mix page is a place the reader chose to go and can hold a short list.
 *
 * Deliberately NOT gated on HABIT_PURCHASES. That threshold guards a claim —
 * the card says "regularly", and twice is not regularly. This list makes no
 * such claim: it is "the heavy things you bought", and a steak bought once is
 * still a heavy thing you bought. Applying the habit gate here would empty the
 * page for anyone who shops varied, which is most people.
 */
export function heavyHitters(items: EcoPurchase[], limit = 8): HeaviestStaple[] {
  const counts = new Map<string, { name: string; times: number }>();
  for (const p of items) {
    if (carbonOf(p.name, p.category ?? 'other') !== 'high') continue;
    const key = fold(p.name);
    if (!key) continue;
    const found = counts.get(key);
    if (found) found.times += 1;
    else counts.set(key, { name: p.name.trim(), times: 1 });
  }
  return [...counts.values()]
    // Ties broken by name so the order is stable between renders — an unstable
    // sort here would reshuffle the page under the reader's finger every time
    // a purchase synced.
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function heaviestStaple(items: EcoPurchase[]): HeaviestStaple | null {
  const counts = new Map<string, { name: string; times: number }>();

  for (const p of items) {
    if (carbonOf(p.name, p.category ?? 'other') !== 'high') continue;
    const key = fold(p.name);
    if (!key) continue;
    const found = counts.get(key);
    if (found) found.times += 1;
    else counts.set(key, { name: p.name.trim(), times: 1 });
  }

  let best: HeaviestStaple | null = null;
  for (const entry of counts.values()) {
    if (entry.times < HABIT_PURCHASES) continue;
    // Ties go to whichever the map saw first, which is the earlier purchase —
    // arbitrary but stable, so the card does not reshuffle between renders.
    if (!best || entry.times > best.times) best = entry;
  }
  return best;
}
