// Supabase Edge Function: recipe-import
//
// Turns a recipe URL or a block of pasted text into a name, a serving count and
// a list of ingredients. Two paths, one response shape:
//
//   URL   fetch → schema.org/Recipe (JSON-LD or microdata) → LLM only if that
//         finds nothing
//   text  straight to the LLM
//
// Structured data first is not an optimisation, it is an accuracy decision: a
// publisher's own `recipeIngredient` array is what the recipe says, while a
// model reading the same page is a very good guess at it. Most food sites ship
// JSON-LD because Google requires it for rich results, so the free, exact path
// covers the majority.
//
// WE TAKE THE INGREDIENTS ONLY. Never `recipeInstructions`. An ingredient list
// is close to a statement of fact and is thin on copyright in most
// jurisdictions; the written method is an author's prose and is not. Extracting
// what to buy is defensible, copying how to cook it is not, and it would buy
// this feature nothing.
//
// Deploy:  supabase functions deploy recipe-import
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

import { reserveBudget } from '../_shared/rate-limit.ts';
import { fetchPage } from '../_shared/safe-fetch.ts';

const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'] as const;
type Unit = (typeof UNITS)[number];

/* ------------------------------------------------------------------------ */
/* schema.org/Recipe                                                         */
/* ------------------------------------------------------------------------ */

interface Scraped {
  name: string;
  servings: number | null;
  ingredients: string[];
}

/** Walk any JSON-LD shape — arrays, @graph, nested — looking for a Recipe. */
function findRecipeNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipeNode(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isRecipe = Array.isArray(type)
    ? type.some((x) => String(x).toLowerCase() === 'recipe')
    : String(type ?? '').toLowerCase() === 'recipe';
  if (isRecipe && obj.recipeIngredient) return obj;

  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'mainEntityOfPage']) {
    const found = findRecipeNode(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** "4 servings", "Serves 6", "6-8" → a number, or null. */
function parseServings(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return clampServings(value);
  const text = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  const match = text.match(/\d+/);
  return match ? clampServings(Number(match[0])) : null;
}

const clampServings = (n: number): number | null =>
  Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n) : null;

function scrapeJsonLd(html: string): Scraped | null {
  const blocks = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue; // a malformed block is normal in the wild; try the next one
    }
    const recipe = findRecipeNode(parsed);
    if (!recipe) continue;

    const raw = recipe.recipeIngredient;
    const ingredients = (Array.isArray(raw) ? raw : [raw])
      .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 60);
    if (ingredients.length === 0) continue;

    return {
      name: String(recipe.name ?? '').trim() || 'Recipe',
      servings: parseServings(recipe.recipeYield),
      ingredients,
    };
  }
  return null;
}

/** Fallback when a page has no JSON-LD: the title, so the LLM has a name. */
function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/**
 * Strip a page down to something worth sending to a model.
 *
 * Scripts and styles first — they are most of a modern recipe page's bytes and
 * none of its meaning — then tags, then whitespace. Bounded hard: the point of
 * this is to keep a 2 MB page from becoming 2 MB of billed input tokens.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

/* ------------------------------------------------------------------------ */
/* YouTube                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A video page has no schema.org/Recipe, and the generic text path finds
 * nothing on it — `visibleText` strips <script> blocks first, and the
 * description lives inside one. So the page reduced to navigation chrome and
 * every YouTube link failed.
 *
 * The description is the video's own metadata, served in its own HTML, and
 * reading it is the same kind of act as reading a blog's JSON-LD. This is
 * deliberately NOT the transcript: captions are a different resource behind
 * different terms, and are not worth taking.
 *
 * Expect this to work about half the time. Plenty of cooking channels put a
 * clean ingredient list in the description; plenty put it only in the video, or
 * behind a link to their own site. When it finds nothing the user gets the same
 * honest "paste the ingredients as text" as any other page.
 */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
]);

export function isYouTube(input: string): boolean {
  try {
    const host = new URL(input).hostname.toLowerCase().replace(/^www\./, '');
    return YOUTUBE_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * The balanced JSON object following `marker`.
 *
 * A regex cannot do this: the object is one line of minified JavaScript
 * containing every brace and quote a video description can hold, and
 * `/\{.*\}/` would swallow the rest of the page. Walking the braces while
 * tracking string state and escapes is the only way to find where it ends.
 */
function jsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Title and description from a watch page, or null if neither is there. */
export function youtubeDescription(html: string): { title: string; description: string } | null {
  const player = jsonAfter(html, 'ytInitialPlayerResponse') as
    | { videoDetails?: { title?: unknown; shortDescription?: unknown } }
    | null;
  const details = player?.videoDetails;
  if (!details) return null;

  const description = String(details.shortDescription ?? '').trim();
  // A video with no description, or a one-line one, has no ingredients in it.
  // Failing here rather than spending a model call on "Thanks for watching!".
  if (description.length < 40) return null;

  return {
    title: String(details.title ?? '').trim().slice(0, 200),
    // Descriptions carry chapter timestamps, affiliate links and sponsor
    // blurbs. Bounded so the padding cannot become the bill.
    description: description.slice(0, 4000),
  };
}

/* ------------------------------------------------------------------------ */
/* The model                                                                 */
/* ------------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You extract the shopping-relevant parts of a recipe.
Return ONLY a JSON object, no prose, no code fences:
{"name": "...", "language": "fr", "servings": 4,
 "items": [{"source": "2 c. à s. d'huile d'olive", "name": "huile d'olive",
            "amount": "2", "measure": "c. à s.", "form": "liquid"}]}

======================= THE ONE RULE THAT MATTERS =======================

For every item you return TWO strings:

  source  the ingredient line COPIED CHARACTER-FOR-CHARACTER from the input.
  name    what to write on a shopping list, produced from source by DELETING
          words and nothing else.

You may only DELETE. You may not substitute a word, re-spell a word, correct a
word, singularise a word, or supply a word that is not already in source. If
name contains a letter that is not in source, you have broken the rule.

This is not a style preference. Someone reading "poireaux" is going to look for
"poireaux" on the shelf; "Leeks" sends them down the wrong aisle in a shop that
has never heard of the word. These instructions are written in English and that
is NOT a signal to answer in English.

  "1 gros oignon, émincé"            -> "oignon"          NOT "onion"
  "2 c. à s. d'huile d'olive"        -> "huile d'olive"   NOT "olive oil"
  "500 g Mehl, gesiebt"              -> "Mehl"            NOT "flour"
  "een handvol verse peterselie"     -> "verse peterselie" NOT "parsley"
  "2 spicchi d'aglio"                -> "aglio"           NOT "garlic"

Delete: quantities, units, and preparation ("finely diced", "at room
temperature", "gesiebt", "émincé"). Keep the thing you buy, spelled exactly as
the source spells it. When in doubt, delete less — a slightly long name in the
right language is correct, a tidy one in the wrong language is not.

language is the ISO 639-1 code of the source text ("fr", "de", "nl", "it").
Decide it BEFORE writing any item, and let it be the language of every name.

=========================================================================

name (top level) is the dish, in the source language, as a person would write it
on a shopping list. Strip the website's own name, "Recipe", and SEO padding.
Under 60 characters.

servings is the number the recipe makes, or null if it does not say. Never guess.

=================== DO NOT CONVERT ANYTHING. REPORT IT. ===================

amount and measure are what the line SAYS, copied, not worked out:

  "2 tsp"              -> amount "2",   measure "tsp"
  "1/2 tsp"            -> amount "1/2", measure "tsp"
  "120-130 ml"         -> amount "120-130", measure "ml"
  "2 medium (150 gms)" -> amount "2",   measure "medium"
  "8-9"                -> amount "8-9", measure ""
  "a pinch"            -> amount "",    measure "pinch"
  "to taste"           -> amount "",    measure ""

Do not add up, scale, round, or change a unit into another unit. A previous
version of this prompt asked for conversions and got "2 tsp" back as "2 kg" —
the number kept, the unit swapped. Code downstream does the arithmetic and can
be tested; you cannot. Copy the two strings and stop.

form is "dry" or "liquid": would this ingredient be measured by weight or
poured? Oil, milk, stock, yoghurt, juice, wine -> liquid. Flour, spices, rice,
sugar, chopped vegetables -> dry. This IS a judgement, and it is the only one
asked for here — get it right and the conversion downstream is right.

===========================================================================

Skip water and ice. Nothing else: if it appears in the ingredient list, it goes
in the output, INCLUDING things that arrive prepared. "Boiled eggs" is bought
as eggs — return it, with "eggs" as the name. A previous run silently dropped
the eggs from an egg curry. At most 40 items.

Return one entry per ingredient line you are given, in the order given.

The text may be a video description rather than a recipe page. If so, ignore
chapter timestamps ("0:00 Intro"), links, hashtags, sponsor and discount-code
blurbs, equipment lists, and "subscribe" copy — take only the ingredients. If
there is no ingredient list in it, return an empty items array rather than
inventing one from the dish name.

Do NOT return the method, the instructions, or any prose from the page. Only the
ingredient list.`;

/* ------------------------------------------------------------------------ */
/* Keeping the source language — enforced, not requested                     */
/* ------------------------------------------------------------------------ */

/*
 * The prompt above asks for deletion-only extraction. This section checks that
 * it happened, and repairs it deterministically when it did not.
 *
 * The previous version asked for "the SHOPPING name, not the recipe phrasing"
 * and, separately, to never translate. Those two instructions are in tension:
 * rewriting a phrase into its canonical shopping form, in a model whose
 * canonical vocabulary is English, IS translation. Most items survived; a few
 * came back as "Olive oil" and "Flour". Telling it more firmly not to would
 * have been the third attempt at the same approach.
 *
 * So the contract changed shape. `name` must now be obtainable from `source` by
 * deleting characters, which is a property we can TEST — and when the test
 * fails we do not ask again, we build the name from the source line ourselves.
 * A slightly clumsy name in the right language beats a tidy one in the wrong
 * language, which is the user's stated priority and the whole point of the
 * feature for a non-English speaker.
 */

/** Letter runs, lowercased. Splits on punctuation, so "d'huile" -> d, huile. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Is every word of `name` present in `source`?
 *
 * Prefix matching in both directions, because the one rewrite worth tolerating
 * is a plural/singular shift — "oignons" -> "oignon" is still French, still
 * findable on a shelf, and rejecting it would send a correct name through the
 * repair path for nothing. A four-character floor keeps that from being a
 * licence to match anything: "onion" and "oignon" share only "o" and "oi"
 * respectively in the wrong order, so the pair that started this fails.
 */
function groundedIn(name: string, source: string): boolean {
  const hay = wordsOf(source);
  if (hay.length === 0) return false;
  return wordsOf(name).every((w) =>
    hay.some((h) => {
      const need = Math.min(4, w.length, h.length);
      if (w.length <= 3 || h.length <= 3) return w === h;
      return w.slice(0, need) === h.slice(0, need) && (w.startsWith(h) || h.startsWith(w));
    }),
  );
}

/**
 * Measure abbreviations, deliberately only the unambiguous ones.
 *
 * Words like "cuillère", "tasse" and "gousse" are left in: stripping them turns
 * "2 gousses d'ail" into "d'ail", and a shopping list reading "gousses d'ail"
 * is perfectly good French. This list exists to drop "200 g", not to parse
 * cooking measures — the model already did that into `quantity` and `unit`.
 */
const MEASURE_TOKENS = new Set([
  'g', 'gr', 'gg', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'lt',
  'oz', 'lb', 'lbs', 'tbsp', 'tsp', 'el', 'tl', 'msp', 'cs', 'cc',
]);

/**
 * Connectors and measure-phrase glue left stranded once the quantity is gone —
 * "200 g DE farine", and the middle of French "c. À s." (cuillère à soupe).
 */
const LEADING_CONNECTORS = new Set([
  'de', 'd', 'du', 'des', 'di', 'del', 'della', 'van', 'von', 'of', 'à', 'a', 'al',
]);

/**
 * Build a shopping name out of an ingredient line, using only deletion.
 *
 * The fallback when the model's own `name` is not grounded in its `source`.
 * Deterministic and language-agnostic: it never introduces a word, so whatever
 * comes out is in the language that went in.
 */
function nameFromSource(source: string): string {
  // Preparation almost always follows a comma, a dash or a bracket.
  let text = source.split(/[,(–—]|\s-\s/)[0];
  // Leading quantity: digits, fractions, vulgar fractions, ranges.
  text = text.replace(/^[\s\d.,\/\u00BC-\u00BE\u2150-\u215E×x*+-]+/u, '');

  let parts = text.split(/\s+/).filter(Boolean);
  /*
   * Peel measure tokens and the glue between them. Bounded, and never down to
   * nothing, so a line that is all units cannot empty the name.
   *
   * Single letters go too, which is what makes the abbreviated French measures
   * work: "2 c. à s. d'huile d'olive" arrives here as [c.] [à] [s.] [d'huile]
   * [d'olive], and only a rule that drops "c", "à" and "s" reaches the oil. No
   * ingredient anywhere starts with a bare one-letter word, so the risk this
   * carries is theoretical and the abbreviations are not.
   */
  for (let pass = 0; pass < 4 && parts.length > 1; pass += 1) {
    const head = parts[0].replace(/[.\u00B7]/g, '').toLowerCase();
    const droppable =
      MEASURE_TOKENS.has(head) || LEADING_CONNECTORS.has(head) || [...head].length === 1;
    if (droppable) parts = parts.slice(1);
    else break;
  }

  let out = parts.join(' ').replace(/\s+/g, ' ').trim();
  // An elided article welded to the first real word: "d'huile" -> "huile".
  // Only at the front — "huile d'olive" must keep its own.
  out = out.replace(/^(?:d|l|dell|nell|all|un|una)['\u2019]\s*/iu, '');
  // Never return nothing: a whole line beats an empty row.
  return (out || source.trim()).slice(0, 60);
}

/* ------------------------------------------------------------------------ */
/* Finding the list, so the model does not have to                           */
/* ------------------------------------------------------------------------ */

/*
 * A pasted recipe lost its first three ingredients — the eggs, the cumin and
 * the cardamom — while everything from the fourth line on came through. Not
 * random: the text opened with a wall of SEO titles and an affiliate link,
 * then one lone bullet, then a "Tempering:" sub-heading with its own bullets.
 * The model locked onto the first sub-headed block and read everything above
 * it as preamble.
 *
 * The URL path never has this problem, because scrapeJsonLd hands over an
 * explicit `recipeIngredient` array — the model is never asked where the list
 * begins. The text path was asking it to do discovery and parsing at once.
 *
 * This does the discovery in code so both paths give the model the same, much
 * smaller job: read one line at a time. It is deliberately conservative — it
 * only takes over when the text is clearly a bulleted list, and otherwise
 * returns null and the raw text goes through as before.
 */

/** Where the ingredients stop and the cooking starts. */
const METHOD_HEADING =
  /^\s*[*\-•–]?\s*(preparation|process|method|instructions?|directions?|steps?|to\s+make|procedure)\b/i;

const BULLET = /^\s*[*\-•–—]\s+/;

export function ingredientLinesFromText(text: string): string[] | null {
  const lines = String(text ?? '').split(/\r?\n/);

  // Everything after a method heading is cooking, and it is bulleted too —
  // without this cut, "Boil and shell around 9 eggs" arrives as an ingredient.
  const stop = lines.findIndex((l) => METHOD_HEADING.test(l));
  const head = stop === -1 ? lines : lines.slice(0, stop);

  const bullets = head
    .filter((l) => BULLET.test(l))
    .map((l) => l.replace(BULLET, '').replace(/\s+/g, ' ').trim())
    // A bulleted sub-heading ("Tempering:") is not an ingredient.
    .filter((l) => l.length > 1 && !l.endsWith(':'))
    .slice(0, 60);

  // Three is the point where "this is a list" beats "this is prose with a
  // stray dash in it". Below that, hand the model the text and let it read.
  return bullets.length >= 3 ? bullets : null;
}

/* ------------------------------------------------------------------------ */
/* Quantities: the model reports, the code calculates                        */
/* ------------------------------------------------------------------------ */

/*
 * A real import produced "2 tsp" -> "2 kg", "1.5 tsp" -> "2 kg", "4 tbsp" ->
 * "4 ml" and "1/4 tsp" -> "1". Every one of those has the same shape: the
 * NUMBER survived and the UNIT was relabelled. And every quantity that came
 * out right was one that needed no arithmetic — "(around 10 gms)", "(150
 * gms)", "120-130 ml", bare counts.
 *
 * So the model copies reliably and calculates unreliably, which is not a
 * surprise and not something a firmer prompt fixes. It now reports what the
 * line SAYS — the amount and the measure word, verbatim — plus one judgement
 * it is genuinely good at, whether the thing is dry or liquid. Everything
 * numeric happens below, where it can be tested.
 */

/** Unicode fractions, which recipe sites use freely. */
const VULGAR: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/**
 * "2", "1.5", "1/2", "1 1/2", "2-3", "8-9", "½" -> a number, or null.
 *
 * A range resolves to its TOP. "Boil 8-9 eggs" means buy nine; rounding a
 * shopping quantity down is the one direction that sends someone back to the
 * shop.
 */
export function parseAmount(raw: string): number | null {
  const text = String(raw ?? '').trim().replace(/,/g, '.');
  if (!text) return null;

  // Ranges first, so "2-3" is not read as a subtraction or as just "2".
  const range = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (range) {
    const hi = parseAmount(range[2]);
    const lo = parseAmount(range[1]);
    if (hi != null) return hi;
    if (lo != null) return lo;
    return null;
  }

  let total = 0;
  let seen = false;
  for (const part of text.split(/\s+/)) {
    if (VULGAR[part] != null) {
      total += VULGAR[part];
      seen = true;
      continue;
    }
    const frac = part.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      const d = Number(frac[2]);
      if (d !== 0) {
        total += Number(frac[1]) / d;
        seen = true;
      }
      continue;
    }
    // A number with a vulgar fraction stuck to it: "1½".
    const mixed = part.match(/^(\d*\.?\d+)([¼-¾⅐-⅞])$/);
    if (mixed) {
      total += Number(mixed[1]) + (VULGAR[mixed[2]] ?? 0);
      seen = true;
      continue;
    }
    if (/^\d*\.?\d+$/.test(part)) {
      total += Number(part);
      seen = true;
    }
  }
  return seen && Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Volume measures, in millilitres. Liquids only — see convertAmount.
 *
 * Seven languages, because the importer is built to keep a recipe in the
 * language it was written in — and a French page that returns "huile d'olive"
 * correctly and then loses every quantity is only half a feature. Keys are in
 * the normalised form: lower case, dots removed, single-spaced, so "C. à S."
 * and "c.à.s." both arrive as "c à s".
 */
const VOLUME_ML: Record<string, number> = {
  // English
  tsp: 5, teaspoon: 5, teaspoons: 5,
  tbsp: 15, tbs: 15, tablespoon: 15, tablespoons: 15,
  cup: 240, cups: 240,
  'fl oz': 30, floz: 30,
  // French
  'c à c': 5, cac: 5, 'cuillère à café': 5, 'cuillères à café': 5, 'cuillere a cafe': 5,
  'c à s': 15, cas: 15, 'cuillère à soupe': 15, 'cuillères à soupe': 15, 'cuillere a soupe': 15,
  tasse: 240, tasses: 240,
  // German / Dutch
  tl: 5, teelöffel: 5, teeloffel: 5, theelepel: 5,
  el: 15, esslöffel: 15, essloffel: 15, eetlepel: 15,
  kop: 240, kopje: 240,
  // Italian
  cucchiaino: 5, cucchiaini: 5, cucchiaio: 15, cucchiai: 15, tazza: 240, tazze: 240,
  // Spanish
  cucharadita: 5, cucharaditas: 5, cucharada: 15, cucharadas: 15, taza: 240, tazas: 240,
  // Polish
  łyżeczka: 5, łyżeczki: 5, łyżka: 15, łyżki: 15, szklanka: 250, szklanki: 250,
  // Metric, everywhere
  ml: 1, milliliter: 1, millilitre: 1, cc: 1, cl: 10, dl: 100,
  l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, litr: 1000,
};

/** Mass measures, in grams. */
const MASS_G: Record<string, number> = {
  g: 1, gm: 1, gms: 1, gr: 1, gram: 1, grams: 1, gramme: 1, grammes: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28, ounce: 28, ounces: 28,
  lb: 454, lbs: 454, pound: 454, pounds: 454,
};

/** Measures that are really "how many of the thing". */
const COUNTED = new Set([
  '', 'pcs', 'pc', 'piece', 'pieces', 'clove', 'cloves', 'sprig', 'sprigs',
  'stick', 'sticks', 'bunch', 'bunches', 'stalk', 'stalks', 'leaf', 'leaves',
  'medium', 'large', 'small', 'whole', 'x',
]);

/**
 * Below this, a gram or millilitre figure is not shopping information.
 *
 * Nobody buys ten grams of chilli powder; they buy a jar. Printing "10 g"
 * beside it invites exactly the reaction the wrong conversions did — that the
 * app is confidently telling you something silly. Counts are exempt: "5 pcs"
 * of cloves is a real instruction.
 */
const MIN_USEFUL = 25;

/**
 * Turn what the line said into what the app stores.
 *
 * The rule that matters: a DRY volume never becomes a mass. A teaspoon of
 * saffron and a teaspoon of salt weigh an order of magnitude apart, so
 * "tsp -> grams" is a guess wearing a number's clothing — and guessing is what
 * produced "2 kg of chilli powder". Dry volumes lose their quantity instead,
 * which loses nothing a shopper needed.
 */
export function convertAmount(
  amount: number | null,
  measure: string,
  form: string,
): { quantity: number | null; unit: Unit | null } {
  // "C. à S." and "c.à.s." are the same measure; so are "tsp" and "tsp.".
  const m = String(measure ?? '')
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const liquid = String(form ?? '').toLowerCase() === 'liquid';

  if (MASS_G[m] != null) {
    if (amount == null) return { quantity: null, unit: null };
    const grams = amount * MASS_G[m];
    if (grams >= 1000) return { quantity: round(grams / 1000), unit: 'kg' };
    return grams < MIN_USEFUL ? { quantity: null, unit: null } : { quantity: round(grams), unit: 'g' };
  }

  if (VOLUME_ML[m] != null) {
    if (amount == null) return { quantity: null, unit: null };
    // A dry thing measured by spoon or cup: no honest mass, so no quantity.
    if (!liquid && VOLUME_ML[m] < 1000 && m !== 'ml' && m !== 'cl' && m !== 'dl') {
      return { quantity: null, unit: null };
    }
    const ml = amount * VOLUME_ML[m];
    if (ml >= 1000) return { quantity: round(ml / 1000), unit: 'L' };
    return ml < MIN_USEFUL ? { quantity: null, unit: null } : { quantity: round(ml), unit: 'ml' };
  }

  if (COUNTED.has(m)) {
    if (amount == null) return { quantity: null, unit: null };
    // Half a bay leaf is not a thing to buy; round up to something countable.
    return { quantity: Math.max(1, Math.round(amount)), unit: 'pcs' };
  }

  // An unrecognised measure ("pinch", "handful", "to taste"): no number at all
  // rather than a number whose meaning we cannot state.
  return { quantity: null, unit: null };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * A metric amount written plainly in the line — "(around 10 gms)", "(150
 * gms)", "120-130 ml".
 *
 * When the source has already done the conversion, use it: that is the one
 * number in the line nobody had to derive. This is why onions and curd came
 * through correct while the spices did not.
 */
export function metricInLine(source: string): { quantity: number | null; unit: Unit | null } | null {
  const re = /(\d[\d.,]*)\s*(?:[-–—]\s*(\d[\d.,]*)\s*)?(gms?|grams?|grammes?|gr|g|kgs?|kilograms?|ml|cl|dl|litres?|liters?|l)\b/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(source); m; m = re.exec(source)) last = m;
  if (!last) return null;
  const amount = parseAmount(last[2] ?? last[1]);
  if (amount == null) return null;
  // `liquid` so a stated ml stays ml; a stated gram hits the mass branch first.
  return convertAmount(amount, last[3], 'liquid');
}

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

interface OutItem {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

/**
 * Narrow whatever the model returned to the contract the app relies on, and
 * hold it to the deletion-only rule.
 *
 * `haystack` is the text that actually went to the model. An item's `source`
 * has to appear in it, or the line was invented and cannot be trusted to repair
 * from — in that case the model's own name is the best we have. Passing "" (no
 * haystack) skips that outer check and grounds names against `source` alone.
 */
function sanitizeItems(raw: unknown, haystack = ''): OutItem[] {
  if (!Array.isArray(raw)) return [];
  const hay = haystack.toLowerCase().replace(/\s+/g, ' ');
  const out: OutItem[] = [];
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    let name = String(e.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) continue;

    /*
     * The language check. `source` is the line the model claims to have copied;
     * when it is real, `name` must be derivable from it by deleting words. If
     * it is not, the model rewrote — which is how "huile d'olive" became "Olive
     * oil" — and we rebuild the name from the source line instead of shipping
     * the rewrite.
     */
    const source = String(e.source ?? '').replace(/\s+/g, ' ').trim();
    const sourceIsReal =
      source.length > 1 && (hay === '' || hay.includes(source.toLowerCase()));
    if (sourceIsReal && !groundedIn(name, source)) {
      name = nameFromSource(source);
    }

    /*
     * The quantity, computed here rather than trusted from the model.
     *
     * Order matters. A metric amount written plainly in the line is the best
     * answer available — nobody had to derive it — so "(around 10 gms)" and
     * "(150 gms)" win over anything reconstructed from "2 tsp" or "2 medium".
     * Only when the line states no metric amount do we fall back to converting
     * what the model read off it.
     */
    const stated = sourceIsReal ? metricInLine(source) : null;
    const { quantity, unit } = stated ?? convertAmount(
      parseAmount(String(e.amount ?? '')),
      String(e.measure ?? ''),
      String(e.form ?? ''),
    );

    out.push({ name, quantity, unit });
  }
  return out;
}

/* ------------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Body must be {"url"} or {"text"}' }, { status: 400 });
  }

  const { url, text } = body as { url?: unknown; text?: unknown };
  const inputUrl = typeof url === 'string' ? url.trim() : '';
  // Bounded like the other endpoints: a recipe is a few hundred words, and an
  // unbounded paste is an unbounded input-token bill.
  const inputText = typeof text === 'string' ? text.trim().slice(0, 8000) : '';

  if (!inputUrl && !inputText) {
    return Response.json({ error: 'Give a url or some text' }, { status: 400 });
  }

  let scraped: Scraped | null = null;
  let forModel = inputText;
  let titleHint = '';

  if (inputUrl) {
    const html = await fetchPage(inputUrl);
    if (!html) {
      // One message for "blocked", "unreachable", "not html" and "too many
      // redirects" on purpose: the differences are not actionable by the user,
      // and enumerating them would confirm to a prober which hosts are blocked.
      return Response.json({ error: 'unreachable' }, { status: 422 });
    }
    scraped = scrapeJsonLd(html);
    if (!scraped) {
      // A video page's description, when there is one, beats its stripped body
      // by a mile — the body is navigation.
      const video = isYouTube(inputUrl) ? youtubeDescription(html) : null;
      if (video) {
        titleHint = video.title;
        forModel = video.description;
      } else {
        titleHint = pageTitle(html);
        forModel = visibleText(html);
      }
    }
  }

  // The exact path: the publisher's own ingredient array. Still goes through the
  // model, but only to normalise "1 large onion, finely diced" into something
  // buyable — the ingredient SET is the page's, not the model's.
  /*
   * Both paths hand over an explicit list wherever one can be found. A scraped
   * page already has `recipeIngredient`; a pasted bulleted recipe gets the
   * same treatment from ingredientLinesFromText. Only genuinely unstructured
   * text falls through to "here is the page, find the list" — which is the
   * shape that lost three ingredients off the top.
   */
  const pastedLines = scraped ? null : ingredientLinesFromText(forModel);

  const payload = scraped
    ? JSON.stringify({
        name: scraped.name,
        servings: scraped.servings,
        ingredientLines: scraped.ingredients,
      })
    : pastedLines
      ? JSON.stringify({ title: titleHint, ingredientLines: pastedLines })
      : JSON.stringify({ title: titleHint, text: forModel });

  if (!payload || payload.length < 8) {
    return Response.json({ error: 'no_recipe' }, { status: 422 });
  }

  const MAX_TOKENS = 1400;
  const guard = await reserveBudget(req, 'recipe-import', SYSTEM_PROMPT + payload, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: payload }],
  });

  await guard.settle(message.usage);

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let name = scraped?.name ?? '';
  let servings = scraped?.servings ?? null;
  let items: OutItem[] = [];
  try {
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim();
    const s = Number(parsed.servings);
    // The page's own yield wins over the model's reading of it.
    if (servings == null && Number.isFinite(s)) servings = clampServings(s);
    // Everything the model was shown, so an item's `source` can be checked
    // against it. Scraped ingredient lines and free text alike live in
    // `payload`, which is exactly what was sent.
    items = sanitizeItems(parsed.items, payload);
  } catch {
    // fall through to the empty check below
  }

  if (items.length === 0) return Response.json({ error: 'no_recipe' }, { status: 422 });

  // `source` tells the client which path answered, so a scraped result can be
  // trusted more than an inferred one if that ever matters. Nothing is stored:
  // the recipe is not saved anywhere, only the list the user chooses to create.
  return Response.json({
    name: name.slice(0, 60),
    servings,
    items,
    source: scraped ? 'structured' : 'inferred',
  });
});

// Deliberately absent: any persistence. The page, its text and the model's
// reading of it live for the length of one request. Korb keeps the shopping
// list the user creates, which is theirs, and nothing about the recipe itself.

/** Test seam: the pure helpers, so check-recipe.mjs can exercise them. */
export const __test = {
  sanitizeItems,
  ingredientLinesFromText,
  parseAmount,
  convertAmount,
  metricInLine,
  groundedIn,
  nameFromSource,
  wordsOf,
  parseServings,
  visibleText,
  pageTitle,
  scrapeJsonLd,
  jsonAfter,
  SYSTEM_PROMPT,
};
