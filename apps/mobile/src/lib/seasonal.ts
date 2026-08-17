/**
 * What is in season in Europe right now.
 *
 * ---------------------------------------------------------------------------
 * Why this is here at all
 * ---------------------------------------------------------------------------
 *
 * Everything else in the climate feature says some version of "that is heavy".
 * Necessary, and relentless: a product that only ever tells you what is wrong
 * with your shopping is one people stop opening. This is the only part that
 * gets to say something good, and it is the reason the card ends on it rather
 * than on the score.
 *
 * It also happens to be true and useful. Out-of-season fresh produce is often
 * air-freighted, and air freight is around fifty times the emissions of sea
 * freight per tonne-kilometre — so the seasonal difference for soft fruit and
 * salad is large, larger than most of the swaps people agonise over. Seasonal
 * produce is also cheaper and better, which means the sentence is worth reading
 * even for somebody who does not care about the climate at all.
 *
 * ---------------------------------------------------------------------------
 * Three calendars, chosen by the region the user already told us
 * ---------------------------------------------------------------------------
 *
 * Asparagus is done in Spain before it starts in Poland, so a single European
 * calendar is wrong for somebody however it is written.
 *
 * This file used to carry one, justified like this: "Korb knows the reader's
 * LANGUAGE, which is not their country... there is no reliable way to pick a
 * regional calendar without asking, and asking for a country to power one line
 * of copy is a bad trade."
 *
 * That was simply false, and it survived here for a while because it sounded
 * reasonable. The app asks for a COUNTRY on first launch — see
 * components/locale-setup.tsx and i18n/regions.ts — stores it, and already uses
 * it for currency. The information was sitting there the whole time; nobody has
 * to be asked anything new.
 *
 * Using the region rather than the language also closes the hole the old comment
 * was worried about. Language is spoken across hemispheres: `es` would have
 * handed a Chilean reader "strawberries in May" while they were heading into
 * winter. The region list is a closed set of twenty European countries, so a
 * calendar keyed off it cannot end up on the wrong side of the equator.
 *
 * So: three climate bands, because latitude is what actually moves a growing
 * season.
 *
 *   north    SE DK NO FI          later spring, shorter summer, longer storage
 *   central  DE FR NL BE AT PL    the temperate middle
 *            CZ HU RO CH GB IE
 *   south    ES IT PT GR          earlier and longer, local citrus in winter
 *
 * Three and not twenty, because a per-country calendar is a research project
 * with twenty times the surface to be wrong in, and the honest gain over a band
 * is small: Belgium and the Netherlands do not differ enough to notice on a
 * grocery list. Within a band the OVERLAP rule still holds — an item appears in
 * a month only if it is plausibly in season across that whole band, and the
 * genuinely local cases are left out rather than shown to half the band wrongly.
 *
 * What this is NOT: a dataset. It is built from ordinary horticultural knowledge
 * of European growing seasons, not from a citable source, so any single entry is
 * arguable at the edges. It is accurate enough to be useful and honest about
 * being a guide rather than an almanac.
 *
 * Six per month, in a two-column grid.
 *
 * It was three, on the reasoning that "a list of nine is an almanac; three is a
 * sentence you finish reading". That held while this was one line at the bottom
 * of a card. On its own page, in a grid, three reads as a stub — the section
 * looks like it failed to load rather than like it is finished, and a real month
 * genuinely has more than three things worth buying. Six fills three grid rows
 * and is still a glance, not a catalogue.
 *
 * The ceiling is that overlap rule, not the layout: a month gets six because six
 * honest items exist for it, and the balance check in check-eco keeps each month
 * from being all fruit or all vegetable — in every band.
 */

/**
 * The three climate bands. See the header for why three.
 */
export type SeasonBand = 'north' | 'central' | 'south';

/**
 * ISO 3166-1 alpha-2 → band, for every country i18n/regions.ts offers.
 *
 * A plain map rather than an import from i18n, so this module stays free of the
 * locale stack and check-eco can load it on its own. check-eco asserts that every
 * region in REGIONS appears here, so adding a country to the picker without
 * giving it a band fails the build instead of silently getting the middle one.
 *
 * The two judgement calls, stated so they can be argued with rather than
 * discovered: Ireland and the UK sit in `central` despite the latitude, because
 * an oceanic climate keeps their season closer to northern France than to
 * Scandinavia. Romania sits in `central` rather than `south` because it is
 * continental, not Mediterranean, whatever the map suggests.
 */
const BAND_BY_REGION: Record<string, SeasonBand> = {
  SE: 'north', DK: 'north', NO: 'north', FI: 'north',
  DE: 'central', FR: 'central', NL: 'central', BE: 'central', AT: 'central',
  PL: 'central', CZ: 'central', HU: 'central', RO: 'central', CH: 'central',
  GB: 'central', IE: 'central',
  ES: 'south', IT: 'south', PT: 'south', GR: 'south',
};

/**
 * The band for a region code, defaulting to the temperate middle.
 *
 * `central` for an unknown or missing code because it is the least wrong answer
 * for Europe as a whole, and because DEFAULT_REGION in i18n/regions.ts is DE —
 * so a user who has not finished setup sees the same calendar they will keep.
 */
export function bandForRegion(code: string | null | undefined): SeasonBand {
  return (code && BAND_BY_REGION[code.toUpperCase()]) || 'central';
}

/**
 * Locale key stems. The display name is `eco.season.${key}` in each locale, so
 * a German reader gets Spargel rather than the English word — this table is
 * about WHEN, never about wording.
 */
export const SEASONAL_PRODUCE = [
  'apples', 'asparagus', 'blackberries', 'blueberries', 'cabbage', 'celeriac',
  'cherries', 'courgettes', 'grapes', 'greenBeans', 'kale', 'leeks', 'lettuce',
  'mushrooms', 'newPotatoes', 'oranges', 'parsnips', 'peas', 'peppers', 'pears',
  'plums', 'pumpkin', 'radishes', 'raspberries', 'redcurrants', 'rhubarb',
  'spinach', 'sprouts', 'strawberries', 'sweetcorn', 'tomatoes',
] as const;

export type SeasonalProduce = (typeof SEASONAL_PRODUCE)[number];

/**
 * Fruit or vegetable, culinary rather than botanical.
 *
 * A tomato is a fruit and nobody wants to be told so while planning dinner;
 * rhubarb is a stem and everybody treats it as a fruit. The only job this table
 * has is to keep each month's three from being all of one kind, and for that
 * the kitchen's definition is the useful one.
 */
export const PRODUCE_KIND: Record<SeasonalProduce, 'fruit' | 'veg'> = {
  apples: 'fruit', blackberries: 'fruit', blueberries: 'fruit',
  cherries: 'fruit', grapes: 'fruit', oranges: 'fruit', pears: 'fruit',
  plums: 'fruit', raspberries: 'fruit', redcurrants: 'fruit', rhubarb: 'fruit',
  strawberries: 'fruit',
  asparagus: 'veg', cabbage: 'veg', celeriac: 'veg', courgettes: 'veg',
  greenBeans: 'veg', kale: 'veg', leeks: 'veg', lettuce: 'veg',
  mushrooms: 'veg', newPotatoes: 'veg', parsnips: 'veg', peas: 'veg',
  peppers: 'veg', pumpkin: 'veg', radishes: 'veg', spinach: 'veg',
  sprouts: 'veg', sweetcorn: 'veg', tomatoes: 'veg',
};

/**
 * An emoji per produce KEY — not per name.
 *
 * The rows used to draw themselves with the generic item-emoji lookup, which
 * takes the TRANSLATED name. Not one seasonal word is in that table, so every
 * row fell through to the fruit_veg fallback and "plums" rendered as a head of
 * lettuce. One line at the bottom of a card hid it; six of them in a grid would
 * have been a wall of identical leaves.
 *
 * Keyed by the stable key rather than the display name, so Pflaumen, prunes,
 * prugne, ciruelas, pruimen and śliwki all get the plum — one entry instead of
 * seven, and a new language needs no emoji work at all.
 *
 * Every glyph is a member of the shared allowlist (_shared/emoji-allowlist.ts),
 * so this stays the same visual vocabulary the AI is held to. A few are honest
 * approximations, because Unicode has no asparagus, rhubarb or celeriac: those
 * borrow the herb sprig and the root vegetable rather than inventing precision
 * the glyph set does not have. check-eco asserts the map is total, so a produce
 * key added without an emoji fails CI instead of shipping as a leaf.
 *
 * Glyphs repeat across the table — five different leafy greens cannot each have
 * their own picture in a set that contains one leaf — but never WITHIN a month.
 * Two cells side by side showing the same icon reads as a rendering bug rather
 * than as two vegetables, so the assignments below are chosen against the
 * calendar: kale takes the herb sprig because it is only ever a winter item and
 * asparagus and rhubarb (the other sprig candidates) are only ever spring ones;
 * redcurrants take the grape because grapes are an autumn item and currants a
 * June one. check-eco asserts that no month contains a duplicate, so a calendar
 * edit that puts two 🥬 side by side fails the build.
 */
export const PRODUCE_EMOJI: Record<SeasonalProduce, string> = {
  apples: '🍎', asparagus: '🌱', blackberries: '🫐', blueberries: '🫐',
  cabbage: '🥦', celeriac: '🥔', cherries: '🍒', courgettes: '🥒',
  grapes: '🍇', greenBeans: '🫘', kale: '🌿', leeks: '🧅', lettuce: '🥗',
  mushrooms: '🍄', newPotatoes: '🥔', oranges: '🍊', parsnips: '🥕',
  peas: '🫘', peppers: '🫑', pears: '🍐', plums: '🍑', pumpkin: '🍠',
  radishes: '🥕', raspberries: '🍓', redcurrants: '🍇', rhubarb: '🌿',
  spinach: '🥬', sprouts: '🥬', strawberries: '🍓', sweetcorn: '🌽',
  tomatoes: '🍅',
};

/**
 * Month index 0–11, as `Date.getMonth()` returns it.
 *
 * Every month carries at least one fruit and at least one vegetable, which
 * check-eco asserts. Three months used to break that — September was all fruit,
 * November and December all vegetables — and a line reading "in season now:
 * pumpkin, parsnips, cabbage" tells somebody nothing about what to put in a
 * fruit bowl. Winter fruit is real (stored apples and pears, Mediterranean
 * citrus), so the balance costs no honesty.
 */
const CALENDARS: Record<SeasonBand, readonly (readonly SeasonalProduce[])[]> = {
  /*
   * Scandinavia. Spring arrives late and leaves early, so the shoulder months
   * lean on stored roots, brassicas and imported citrus rather than pretending
   * March has anything fresh in it. Berries run roughly a month behind central
   * Europe — Nordic strawberries are a July crop, not a May one — and the summer
   * window is genuinely short, which is why so much of this year is storage.
   */
  north: [
    ['kale', 'cabbage', 'oranges', 'leeks', 'parsnips', 'apples'], // January
    ['cabbage', 'kale', 'oranges', 'celeriac', 'leeks', 'pears'], // February
    ['cabbage', 'kale', 'leeks', 'celeriac', 'oranges', 'apples'], // March
    ['spinach', 'radishes', 'rhubarb', 'lettuce', 'leeks', 'oranges'], // April
    ['asparagus', 'rhubarb', 'spinach', 'radishes', 'lettuce', 'apples'], // May
    ['strawberries', 'rhubarb', 'asparagus', 'peas', 'lettuce', 'radishes'], // June
    ['strawberries', 'newPotatoes', 'peas', 'courgettes', 'redcurrants', 'lettuce'], // July
    ['raspberries', 'blueberries', 'courgettes', 'tomatoes', 'newPotatoes', 'greenBeans'], // August
    ['apples', 'blackberries', 'plums', 'mushrooms', 'cabbage', 'greenBeans'], // September
    ['apples', 'pears', 'pumpkin', 'mushrooms', 'leeks', 'cabbage'], // October
    ['apples', 'pears', 'pumpkin', 'parsnips', 'kale', 'leeks'], // November
    ['sprouts', 'kale', 'leeks', 'parsnips', 'apples', 'oranges'], // December
  ],

  /*
   * The temperate middle, and the band this file started as. Winter leans on
   * stored roots and brassicas plus Mediterranean citrus, which is the honest
   * answer: the alternative is pretending January has berries.
   */
  central: [
    ['leeks', 'kale', 'oranges', 'cabbage', 'parsnips', 'pears'], // January
    ['cabbage', 'kale', 'oranges', 'leeks', 'celeriac', 'apples'], // February
    ['spinach', 'rhubarb', 'leeks', 'cabbage', 'radishes', 'oranges'], // March
    ['asparagus', 'rhubarb', 'radishes', 'spinach', 'lettuce', 'oranges'], // April
    ['asparagus', 'strawberries', 'peas', 'radishes', 'lettuce', 'rhubarb'], // May
    ['strawberries', 'cherries', 'newPotatoes', 'peas', 'courgettes', 'redcurrants'], // June
    ['cherries', 'raspberries', 'courgettes', 'blueberries', 'tomatoes', 'greenBeans'], // July
    ['tomatoes', 'plums', 'peppers', 'courgettes', 'blackberries', 'sweetcorn'], // August
    ['apples', 'blackberries', 'mushrooms', 'plums', 'grapes', 'sweetcorn'], // September
    ['apples', 'pumpkin', 'mushrooms', 'pears', 'grapes', 'leeks'], // October
    ['pumpkin', 'parsnips', 'apples', 'kale', 'leeks', 'pears'], // November
    ['sprouts', 'leeks', 'pears', 'kale', 'oranges', 'parsnips'], // December
  ],

  /*
   * The Mediterranean. Two real differences from the middle, not a shuffle:
   * citrus in winter is LOCAL rather than imported, so it belongs at the front of
   * a winter month rather than as the token fruit; and the summer crops start in
   * May and run to October, so tomatoes and peppers occupy five months instead of
   * two. Spring fruit is genuinely early — Spanish strawberries are a March crop
   * — while the autumn brassica-and-root season starts later than up north.
   */
  south: [
    ['oranges', 'spinach', 'cabbage', 'leeks', 'celeriac', 'pears'], // January
    ['oranges', 'spinach', 'cabbage', 'leeks', 'lettuce', 'apples'], // February
    ['strawberries', 'oranges', 'spinach', 'lettuce', 'asparagus', 'radishes'], // March
    ['strawberries', 'asparagus', 'oranges', 'lettuce', 'radishes', 'peas'], // April
    ['cherries', 'strawberries', 'asparagus', 'peas', 'courgettes', 'lettuce'], // May
    ['cherries', 'courgettes', 'tomatoes', 'peppers', 'peas', 'newPotatoes'], // June
    // Only one fruit, deliberately: raspberries sat here for a while and they are
    // a cool-climate crop, not a Mediterranean-July one. Plums are the honest
    // stone fruit of a southern high summer, and one true entry beats two with a
    // wrong one in it.
    ['tomatoes', 'peppers', 'plums', 'courgettes', 'greenBeans', 'sweetcorn'], // July
    ['tomatoes', 'peppers', 'grapes', 'plums', 'courgettes', 'sweetcorn'], // August
    ['grapes', 'tomatoes', 'peppers', 'apples', 'blackberries', 'sweetcorn'], // September
    ['grapes', 'apples', 'pears', 'mushrooms', 'peppers', 'pumpkin'], // October
    ['oranges', 'apples', 'pears', 'pumpkin', 'mushrooms', 'spinach'], // November
    ['oranges', 'cabbage', 'leeks', 'spinach', 'pears', 'celeriac'], // December
  ],
};

/**
 * What is in season, for the month a date falls in and the reader's band.
 *
 * Takes a Date rather than reading the clock, so the caller controls "now" and
 * the check script can walk all twelve months without mocking anything.
 *
 * `band` defaults to `central` so a caller that has no region to hand still gets
 * the least-wrong European answer rather than nothing — but every caller in the
 * app passes one, via bandForRegion(region) off the locale store.
 */
export function inSeason(at: Date, band: SeasonBand = 'central'): readonly SeasonalProduce[] {
  return CALENDARS[band][at.getMonth()] ?? [];
}
