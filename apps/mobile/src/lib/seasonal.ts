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
 * Three per month, deliberately. A list of nine is an almanac; three is a
 * sentence you finish reading.
 */

/**
 * Locale key stems. The display name is `eco.season.${key}` in each locale, so
 * a German reader gets Spargel rather than the English word — this table is
 * about WHEN, never about wording.
 */
export const SEASONAL_PRODUCE = [
  'apples', 'asparagus', 'blackberries', 'cabbage', 'cherries', 'courgettes',
  'kale', 'leeks', 'mushrooms', 'newPotatoes', 'oranges', 'parsnips', 'peas',
  'peppers', 'pears', 'plums', 'pumpkin', 'radishes', 'raspberries', 'rhubarb',
  'spinach', 'sprouts', 'strawberries', 'tomatoes',
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
  apples: 'fruit', blackberries: 'fruit', cherries: 'fruit', oranges: 'fruit',
  pears: 'fruit', plums: 'fruit', raspberries: 'fruit', rhubarb: 'fruit',
  strawberries: 'fruit',
  asparagus: 'veg', cabbage: 'veg', courgettes: 'veg', kale: 'veg',
  leeks: 'veg', mushrooms: 'veg', newPotatoes: 'veg', parsnips: 'veg',
  peas: 'veg', peppers: 'veg', pumpkin: 'veg', radishes: 'veg',
  spinach: 'veg', sprouts: 'veg', tomatoes: 'veg',
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
  ['leeks', 'kale', 'oranges'], // January
  ['cabbage', 'kale', 'oranges'], // February
  ['spinach', 'rhubarb', 'leeks'], // March
  ['asparagus', 'rhubarb', 'radishes'], // April
  ['asparagus', 'strawberries', 'peas'], // May
  ['strawberries', 'cherries', 'newPotatoes'], // June
  ['cherries', 'raspberries', 'courgettes'], // July
  ['tomatoes', 'plums', 'peppers'], // August
  ['apples', 'blackberries', 'mushrooms'], // September
  ['apples', 'pumpkin', 'mushrooms'], // October
  ['pumpkin', 'parsnips', 'apples'], // November
  ['sprouts', 'leeks', 'pears'], // December
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
