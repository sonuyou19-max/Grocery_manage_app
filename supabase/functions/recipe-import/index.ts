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
/* The model                                                                 */
/* ------------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You extract the shopping-relevant parts of a recipe.
Return ONLY a JSON object, no prose, no code fences:
{"name": "...", "servings": 4, "items": [{"name": "...", "quantity": 2, "unit": "g"}]}

name is the dish, as a person would write it on a shopping list. Strip the
website's own name, "Recipe", and any SEO padding. Keep it under 60 characters.

servings is the number the recipe makes, or null if it does not say. Never guess.

items is the ingredient list, one entry per ingredient:
- name is the SHOPPING name, not the recipe phrasing: "1 large onion, finely
  diced" -> "Onion". Drop preparation ("chopped", "at room temperature"), drop
  size adjectives, keep the thing you buy. Singular where natural.
- quantity is a number, or null when the recipe gives none ("salt to taste",
  "a handful of parsley"). Convert fractions and ranges to a single number:
  "1 1/2" -> 1.5, "2-3" -> 3. Never invent one.
- unit is one of: ${UNITS.join(', ')}, or null.
  Convert cooking measures to what a European shopper buys: tablespoons and
  cups of a liquid -> ml, ounces and pounds -> g, "2 cloves" -> pcs with
  quantity 2. If a conversion would be a guess, use null for the unit and keep
  the quantity.
- Skip water, and skip anything that is not bought (ice, "oil for frying" if
  oil already appears).
- At most 40 items.

Do NOT return the method, the instructions, or any prose from the page. Only the
ingredient list.`;

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

/** Narrow whatever the model returned to the contract the app relies on. */
function sanitizeItems(raw: unknown): OutItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OutItem[] = [];
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = String(e.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) continue;

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
      titleHint = pageTitle(html);
      forModel = visibleText(html);
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
    items = sanitizeItems(parsed.items);
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
export const __test = { sanitizeItems, parseServings, visibleText, pageTitle, scrapeJsonLd };
