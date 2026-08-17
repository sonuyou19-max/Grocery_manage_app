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
 * One calendar for a continent, and how it stays honest
 * ---------------------------------------------------------------------------
 *
 * Asparagus is done in Spain before it starts in Poland. Korb knows the
 * reader's LANGUAGE, which is not their country — `de` is Germany, Austria and
 * Switzerland; `es` is Spain and, for many users, Latin America — so there is
 * no reliable way to pick a regional calendar without asking, and asking for a
 * country to power one line of copy is a bad trade.
 *
 * So this is a single temperate-Europe calendar built from the OVERLAP rather
 * than the union: an item appears in a month only if it is plausibly in season
 * across most of the continent that month, and the genuinely regional cases are
 * simply left out. Fewer items, none of them wrong for the reader.
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
 * from being all fruit or all vegetable.
 */

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
const CALENDAR: readonly (readonly SeasonalProduce[])[] = [
  // Winter leans on stored roots and brassicas plus Mediterranean citrus, which
  // is the honest answer: the alternative is pretending January has berries.
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
];

/**
 * What is in season, for the month a date falls in.
 *
 * Takes a Date rather than reading the clock, so the caller controls "now" and
 * the check script can walk all twelve months without mocking anything.
 */
export function inSeason(at: Date): readonly SeasonalProduce[] {
  return CALENDAR[at.getMonth()] ?? [];
}
