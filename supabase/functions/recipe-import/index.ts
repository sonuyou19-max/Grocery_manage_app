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
 "items": [{"source": "1 gros oignon, émincé", "name": "oignon", "quantity": 1, "unit": null}]}

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

quantity is a number, or null when the recipe gives none ("salt to taste", "a
handful of parsley"). Convert fractions and ranges to a single number: "1 1/2"
-> 1.5, "2-3" -> 3. Never invent one.

unit is one of: ${UNITS.join(', ')}, or null.
  Convert cooking measures to what a European shopper buys: tablespoons and
  cups of a liquid -> ml, ounces and pounds -> g, "2 cloves" -> pcs with
  quantity 2. If a conversion would be a guess, use null for the unit and keep
  the quantity. (Units are a fixed machine vocabulary — they are the ONLY
  field that is not in the source language.)

Skip water, and skip anything that is not bought (ice, "oil for frying" if oil
already appears). At most 40 items.

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

    const q = typeof e.quantity === 'number' ? e.quantity : Number(e.quantity);
    // A non-positive or absurd quantity is treated as absent rather than
    // corrected: "0 onions" is a parse failure, and the app renders a missing
    // quantity perfectly well.
    const quantity = Number.isFinite(q) && q > 0 && q < 100_000 ? q : null;

    const u = String(e.unit ?? '');
    const unit = (UNITS as readonly string[]).includes(u) ? (u as Unit) : null;

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
  const payload = scraped
    ? JSON.stringify({
        name: scraped.name,
        servings: scraped.servings,
        ingredientLines: scraped.ingredients,
      })
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
