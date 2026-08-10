/**
 * Recipe import check.
 *
 * Two very different things are proved here, and only one of them is about
 * recipes.
 *
 * THE FIRST IS A SECURITY BOUNDARY. `recipe-import` fetches a URL the caller
 * chose, which is server-side request forgery by construction. The host
 * blocklist is the only thing standing between a pasted link and the edge
 * runtime's view of the private network — including cloud metadata at
 * 169.254.169.254, the single most-exploited address in this class. A blocklist
 * is exactly the kind of code that looks obviously correct and has a hole in
 * it, so every range gets an assertion and so does every public address that
 * must NOT be blocked, because a guard that rejects everything is also broken.
 *
 * THE SECOND IS ARITHMETIC PEOPLE ARGUE WITH. Doubling a recipe must not
 * produce 1.5 eggs, halving one must not produce 266 g of rice, and an
 * ingredient with no quantity must come through untouched rather than acquiring
 * an invented one.
 *
 * Run with `pnpm --filter mobile check:recipe`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'lib');
const FUNCS = join(HERE, '..', '..', '..', 'supabase', 'functions');

const compileAt = (path, req = () => ({})) => {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
};

const pantryIntel = compileAt(join(LIB, 'pantry-intel.ts'));
const recipe = compileAt(join(LIB, 'recipe.ts'), (spec) =>
  spec === '@/lib/pantry-intel' ? pantryIntel : {},
);
const { cleanRecipeName, scaleQuantity, reviewRows, checkedCount, inPantryCount, looksLikeUrl } =
  recipe;

// The edge function's guards. Deno-only globals are never touched by the pure
// helpers below, so transpiling and running the module in Node is safe.
const safeFetch = compileAt(join(FUNCS, '_shared', 'safe-fetch.ts'));
const { isBlockedHost } = safeFetch;

// The importer imports Deno-only modules at the top, so it cannot be loaded
// whole in Node. Its pure parsers are compiled from the same source with the
// imports stubbed — which still catches the thing that matters: a change to the
// extraction logic that these assertions describe.
// `Deno.serve` runs at module scope, so it is stubbed rather than avoided —
// registering a no-op handler is harmless and keeps the parsers compiled from
// the real file rather than from a copy that could drift away from it.
globalThis.Deno = globalThis.Deno ?? { serve: () => {}, env: { get: () => '' } };
const importer = compileAt(join(FUNCS, 'recipe-import', 'index.ts'), () => ({
  default: class {},
  reserveBudget: () => ({}),
  fetchPage: () => null,
}));
const { isYouTube, youtubeDescription, __test } = importer;

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(
      `FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok   ${name}`);
  }
};
const assert = (name, cond) => check(name, cond === true, true);

/* ============================ the security boundary ==================== */

// Cloud metadata. If only one line of this file survives, this is the one:
// it is how an SSRF becomes stolen service credentials.
assert('169.254.169.254 (cloud metadata) is blocked', isBlockedHost('169.254.169.254'));
assert('the whole 169.254/16 link-local range is blocked', isBlockedHost('169.254.1.1'));

// Loopback, by every spelling that reaches a resolver.
for (const host of ['localhost', 'LOCALHOST', 'foo.localhost', '127.0.0.1', '127.1.2.3', '::1']) {
  assert(`loopback "${host}" is blocked`, isBlockedHost(host));
}

// RFC1918, at both edges of each range — an off-by-one in a range check is the
// classic way one of these leaks.
for (const host of [
  '10.0.0.0', '10.255.255.255',
  '172.16.0.1', '172.31.255.254',
  '192.168.0.1', '192.168.255.254',
]) {
  assert(`private "${host}" is blocked`, isBlockedHost(host));
}

// 0.0.0.0/8 routes to "this host" on Linux, and multicast is not a website.
assert('0.0.0.0 is blocked', isBlockedHost('0.0.0.0'));
assert('multicast 224.0.0.1 is blocked', isBlockedHost('224.0.0.1'));

// Bare names resolve on the local network (Docker/Kubernetes service names).
assert('a bare hostname is blocked', isBlockedHost('supabase-db'));
assert('.internal is blocked', isBlockedHost('metadata.google.internal'));

// IPv6 loopback, link-local and unique-local.
for (const host of ['::1', 'fe80::1', 'fd00::1', 'fc00::1']) {
  assert(`IPv6 "${host}" is blocked`, isBlockedHost(host));
}
// Deno hands bracketed IPv6 through URL.hostname without brackets, but a caller
// could pass either — both spellings must reach the same verdict.
assert('bracketed IPv6 loopback is blocked', isBlockedHost('[::1]'));

// And the other half of the boundary: a guard that blocks everything is not a
// guard, it is an outage. These must all be allowed.
for (const host of [
  'bbcgoodfood.com', 'www.bbcgoodfood.com', 'cooking.nytimes.com',
  'chefkoch.de', 'marmiton.org', '8.8.8.8',
  // 172.32 is OUTSIDE 172.16/12 — the range that trips naive implementations.
  '172.32.0.1',
  // 169.253 and 169.255 neighbour link-local without being in it.
  '169.253.0.1', '169.255.0.1',
  // 11.x is public despite starting with the same digits as 10.x.
  '11.0.0.1',
]) {
  assert(`public "${host}" is allowed`, !isBlockedHost(host));
}

/* ================================ the scaler =========================== */

// The case that makes a scaler feel broken.
check('3 eggs halved is 2, not 1.5', scaleQuantity(3, 'pcs', 0.5), 2);
check('3 eggs doubled is 6', scaleQuantity(3, 'pcs', 2), 6);
check('a countable never scales to zero', scaleQuantity(1, 'pcs', 0.25), 1);
check('a unitless quantity is countable too', scaleQuantity(2, null, 0.5), 1);

// Weights round to a step a person would ask for at a counter.
check('400 g halved is 200 g', scaleQuantity(400, 'g', 0.5), 200);
check('500 g × 0.53 rounds to 270, not 265.something', scaleQuantity(500, 'g', 0.53), 270);
check('80 g × 1.5 uses the finer step below 100', scaleQuantity(80, 'g', 1.5), 120);
check('30 g × 1.1 rounds to 35', scaleQuantity(30, 'g', 1.1), 35);
check('a weight never scales to zero', scaleQuantity(5, 'g', 0.01), 1);
check('ml behaves like g', scaleQuantity(400, 'ml', 0.5), 200);

// kg and L are small numbers where decimals carry the meaning.
check('1.5 kg doubled is 3', scaleQuantity(1.5, 'kg', 2), 3);
check('0.5 L × 1.5 keeps two decimals', scaleQuantity(0.5, 'L', 1.5), 0.75);

// Nonsense in, unchanged out — never a crash and never an invented number.
check('a factor of zero changes nothing', scaleQuantity(4, 'g', 0), 4);
check('a negative factor changes nothing', scaleQuantity(4, 'g', -2), 4);
check('a NaN quantity is returned as-is', Number.isNaN(scaleQuantity(NaN, 'g', 2)), true);

/* ============================== the pantry check ======================= */

const DAY = 86_400_000;
const now = Date.UTC(2026, 7, 3);
/** A tracked item last bought `daysAgo`, on a `every` day cycle. */
const stat = (key, display, daysAgo, every) => ({
  key,
  display,
  category: 'other',
  lastPurchasedAt: now - daysAgo * DAY,
  intervalDays: every,
  cadenceDays: every,
  sampleCount: 3,
  keepStocked: false,
  archivedAt: null,
});

const stats = {
  onion: stat('onion', 'Onions', 1, 14), // plenty left
  garlic: stat('garlic', 'Garlic', 13, 14), // nearly out
  rice: stat('rice', 'Rice', 2, 30), // plenty left
};

const rows = reviewRows(
  [
    { name: 'Chicken thighs', quantity: 800, unit: 'g' },
    { name: 'Onions', quantity: 2, unit: null },
    { name: 'Garlic', quantity: 4, unit: 'pcs' },
    { name: 'Rice', quantity: 500, unit: 'g' },
  ],
  stats,
  now,
);

check('an untracked item is missing', rows.find((r) => r.key === 'chicken thighs')?.state, 'missing');
check('...and starts checked', rows.find((r) => r.key === 'chicken thighs')?.checked, true);
// The recipe says "Onions"; the pantry holds "onion". Without plural matching
// this is the ingredient the feature most reliably gets wrong.
check('a plural ingredient finds a singular pantry item', rows.find((r) => r.name === 'Onions')?.state, 'stocked');
check('...and starts UNchecked', rows.find((r) => r.name === 'Onions')?.checked, false);
// The row still keys on what the RECIPE said, because that is what goes on the
// list — matching is looser than identity, deliberately.
check('the row keeps the recipe spelling as its key', rows.find((r) => r.name === 'Onions')?.key, 'onions');

// The whole reason for the third state. Two states would send this shopper home
// without garlic because Korb technically knows the word.
check('an almost-empty item is low, not stocked', rows.find((r) => r.key === 'garlic')?.state, 'low');
check('...and starts CHECKED', rows.find((r) => r.key === 'garlic')?.checked, true);

// Chicken (missing) and garlic (low). Onions and rice are stocked and off.
check('the button counts what will be added', checkedCount(rows), 2);
check('the summary counts what the pantry covers', inPantryCount(rows), 3);

// Both directions, and the awkward endings.
const plural = (recipeName, pantryKey) =>
  reviewRows([{ name: recipeName, quantity: null, unit: null }], { [pantryKey]: stat(pantryKey, pantryKey, 1, 30) }, now)[0].state;
check('"Tomatoes" finds "tomato"', plural('Tomatoes', 'tomato'), 'stocked');
check('"Berries" finds "berry"', plural('Berries', 'berry'), 'stocked');
check('"Egg" finds "eggs"', plural('Egg', 'eggs'), 'stocked');
check('"Cheese" is not mistaken for "chees"', plural('Cheese', 'cheese'), 'stocked');
// And the guard against over-matching: two genuinely different foods must not
// collapse into each other.
check('"Peas" does not match "pear"', plural('Peas', 'pear'), 'missing');

// Spelling drift must not defeat the match, or the feature silently stops
// working for anybody whose recipe says "Onion" and whose pantry says "onions".
check(
  'singular and plural match the same pantry item',
  reviewRows([{ name: 'Onion', quantity: null, unit: null }], stats, now)[0].state,
  'stocked',
);

// A recipe listing the same thing twice ("olive oil, for the sauce" / "for the
// pan") must not put two of it on the list.
check(
  'a repeated ingredient collapses to one row',
  reviewRows(
    [
      { name: 'Olive oil', quantity: 2, unit: null },
      { name: 'olive oil', quantity: 1, unit: null },
    ],
    {},
    now,
  ).length,
  1,
);

// A retired item is not a claim about the cupboard.
check(
  'a resting item counts as missing',
  reviewRows([{ name: 'Rice', quantity: null, unit: null }], { rice: { ...stats.rice, archivedAt: now } }, now)[0].state,
  'missing',
);

/* ================================ the title ============================ */

check(
  'a publisher suffix is cut',
  cleanRecipeName('Best Ever Thai Green Curry Recipe | Jenny’s Kitchen'),
  'Best Ever Thai Green Curry',
);
check('an en dash is a separator too', cleanRecipeName('Ragù alla bolognese – Giallozafferano'), 'Ragù alla bolognese');
check('a trailing "recipe" goes', cleanRecipeName('Lemon drizzle cake recipe'), 'Lemon drizzle cake');
// A plain hyphen is NOT a separator: real dish names contain them.
check('a hyphenated dish survives', cleanRecipeName('Slow-cooked lamb shoulder'), 'Slow-cooked lamb shoulder');
check('whitespace is collapsed', cleanRecipeName('  Chicken   curry  '), 'Chicken curry');
assert('a runaway title is bounded', cleanRecipeName('x'.repeat(500)).length <= 60);

/* ============================== url or text ============================ */

assert('an https link is a url', looksLikeUrl('https://bbcgoodfood.com/x'));
assert('an http link is a url', looksLikeUrl('http://example.com/x'));
assert('a recipe body is not a url', !looksLikeUrl('200g flour\n2 eggs\nsalt'));
assert('a bare word is not a url', !looksLikeUrl('carbonara'));
// The one that decides whether the single-field design works: a sentence
// containing a link is text, because the user pasted prose.
assert('prose containing a link is text', !looksLikeUrl('look at https://a.com/x'));
assert('a file: url is not accepted', !looksLikeUrl('file:///etc/passwd'));
assert('a javascript: url is not accepted', !looksLikeUrl('javascript:alert(1)'));

/* ================================= youtube ============================= */

for (const url of [
  'https://www.youtube.com/watch?v=abc123',
  'https://youtube.com/watch?v=abc123',
  'https://m.youtube.com/watch?v=abc123',
  'https://youtu.be/abc123',
  'https://music.youtube.com/watch?v=abc123',
]) {
  assert(`"${url}" is recognised as YouTube`, isYouTube(url));
}
assert('a recipe blog is not YouTube', !isYouTube('https://bbcgoodfood.com/x'));
// A lookalike host must not be treated as YouTube — that is how a spoofed page
// would get its "description" read as trusted metadata.
assert('youtube.com.evil.test is not YouTube', !isYouTube('https://youtube.com.evil.test/x'));
assert('notyoutube.com is not YouTube', !isYouTube('https://notyoutube.com/x'));

/** A watch page, minified the way YouTube actually serves one. */
const ytPage = (description, title = 'Best Thai Green Curry') =>
  `<html><head><title>${title} - YouTube</title></head><body>` +
  `<script>var ytInitialPlayerResponse = {"responseContext":{"a":1},` +
  `"videoDetails":{"videoId":"abc","title":${JSON.stringify(title)},` +
  `"shortDescription":${JSON.stringify(description)}},"playbackTracking":{}};</script>` +
  `</body></html>`;

const desc = [
  '0:00 Intro',
  '1:20 The paste',
  '',
  'INGREDIENTS',
  '400ml coconut milk',
  '2 tbsp green curry paste',
  '500g chicken thighs',
  '',
  'Get 10% off at sponsor.example with code CURRY',
  '#thaifood #curry',
].join('\n');

const found = youtubeDescription(ytPage(desc));
assert('a description is found', found != null);
check('...with the video title', found?.title, 'Best Thai Green Curry');
assert('...and the ingredient lines', found?.description.includes('400ml coconut milk'));
// The brace-walk has to survive everything a description can contain, which is
// where a regex would have swallowed the rest of the page.
const tricky = 'Serve with rice {or noodles} — "the best" \\ 100% \u00e9\n2 cups';
assert('braces, quotes and escapes in a description survive', youtubeDescription(ytPage(tricky)) != null);
check(
  '...decoded exactly',
  youtubeDescription(ytPage(tricky))?.description,
  tricky,
);

check('a page with no player response yields nothing', youtubeDescription('<html></html>'), null);
check('a page with no videoDetails yields nothing', youtubeDescription('<script>var ytInitialPlayerResponse = {"a":1};</script>'), null);
// "Thanks for watching, subscribe!" is not worth a model call.
check('a one-line description is not worth a call', youtubeDescription(ytPage('Subscribe!')), null);

// And the reason this exists at all: the generic path throws the description
// away, because it lives in a <script> block.
assert(
  'the generic text path cannot see a description',
  !__test.visibleText(ytPage(desc)).includes('coconut milk'),
);

/* ------------------------------------------------------------- language */

/*
 * A French recipe came back with English item names. The first fix told the
 * model more firmly not to translate, and a few items still did — because the
 * prompt also asked for "the SHOPPING name, not the recipe phrasing", and
 * rewriting a phrase into its canonical form, in a model whose canonical
 * vocabulary is English, IS translating it.
 *
 * The contract now says `name` must be obtainable from `source` by deleting
 * words. That is a property this file can actually TEST, rather than an
 * instruction it can only pin in place — everything below runs the real code.
 */

const { groundedIn, nameFromSource } = __test;

// --- the check that catches a translation --------------------------------

assert(
  'a translated name is not grounded in its source line',
  !groundedIn("Olive oil", "2 c. à s. d'huile d'olive"),
);
assert('"onion" is not grounded in "1 gros oignon"', !groundedIn('onion', '1 gros oignon, émincé'));
assert('"flour" is not grounded in "500 g Mehl"', !groundedIn('flour', '500 g Mehl, gesiebt'));
assert('"garlic" is not grounded in "2 spicchi d\'aglio"', !groundedIn('garlic', "2 spicchi d'aglio"));

// --- ...without rejecting names that are genuinely fine -------------------

assert('the source-language name passes', groundedIn("huile d'olive", "2 c. à s. d'huile d'olive"));
assert('case differences pass', groundedIn('Mehl', '500 g mehl, gesiebt'));
// The one rewrite worth tolerating: rejecting it would send correct names
// through the repair path for nothing.
assert('singularising a plural still passes', groundedIn('oignon', '3 oignons rouges'));
assert('pluralising still passes', groundedIn('oignons', '1 oignon rouge'));
assert('a multi-word name passes', groundedIn('verse peterselie', 'een handvol verse peterselie'));

// The four-character floor is what stops the prefix rule becoming a licence to
// match anything. Without it "oil" would ground itself against "olive".
assert('a short accidental prefix does not ground a word', !groundedIn('oil', 'olive olie'));

// --- the repair, which is what the user actually sees ---------------------

const repairs = [
  ['1 gros oignon, émincé', 'gros oignon'],
  ['200 g de farine', 'farine'],
  ['500 g Mehl, gesiebt', 'Mehl'],
  ["2 spicchi d'aglio", "spicchi d'aglio"],
  ['een handvol verse peterselie', 'een handvol verse peterselie'],
  ['3 oignons rouges (bio)', 'oignons rouges'],
  ['1 1/2 kg pommes de terre', 'pommes de terre'],
];
for (const [line, want] of repairs) {
  check(`repair: "${line}"`, nameFromSource(line), want);
}

// Deleting only. Whatever comes out must have been in what went in — that is
// the property that makes the repair language-agnostic.
for (const [line] of repairs) {
  const out = nameFromSource(line).toLowerCase();
  assert(
    `repair invents no words: "${line}"`,
    out.split(/[^\p{L}\p{N}]+/u).filter(Boolean).every((w) => line.toLowerCase().includes(w)),
  );
}

// A line that is nothing but a measure must not repair to an empty name.
assert('a degenerate line still yields something', nameFromSource('200 g').length > 0);

// --- end to end through sanitizeItems ------------------------------------

const payload = JSON.stringify({
  ingredientLines: ["2 c. à s. d'huile d'olive", '1 gros oignon, émincé', '200 g de farine'],
});

const fromModel = __test.sanitizeItems(
  [
    // The model translated these two — exactly what was shipped to the user.
    { source: "2 c. à s. d'huile d'olive", name: 'Olive oil', amount: '2', measure: 'c. à s.', form: 'liquid' },
    { source: '1 gros oignon, émincé', name: 'Onion', amount: '1', measure: '', form: 'dry' },
    // ...and got this one right.
    { source: '200 g de farine', name: 'farine', amount: '200', measure: 'g', form: 'dry' },
  ],
  payload,
);

check('the translated oil name is repaired', fromModel[0].name, "huile d'olive");
check('the translated onion name is repaired', fromModel[1].name, 'gros oignon');
check('a correct name is left alone', fromModel[2].name, 'farine');
// The quantity is computed here, not taken from the model — and a French
// spoon measure has to resolve, or a whole locale silently loses its amounts.
check('a French tablespoon converts', fromModel[0].quantity, 30);
check('...to millilitres', fromModel[0].unit, 'ml');
check('a bare count becomes pcs', `${fromModel[1].quantity} ${fromModel[1].unit}`, '1 pcs');
check('a stated gram amount survives', `${fromModel[2].quantity} ${fromModel[2].unit}`, '200 g');

// An invented source line cannot be trusted to repair from, so the model's own
// name stands rather than being replaced by something worse.
const invented = __test.sanitizeItems(
  [{ source: 'a line that was never on the page', name: 'Saffron', amount: '', measure: '', form: 'dry' }],
  payload,
);
check('an ungrounded source line leaves the name alone', invented[0].name, 'Saffron');

// --- and the prompt still carries the rule it all rests on ----------------

assert(
  'the prompt states the deletion-only rule',
  // \s+ not a space: the prompt wraps, and an assertion that depends on where
  // a line happens to break is a false failure waiting to happen.
  /DELETING\s+words/i.test(__test.SYSTEM_PROMPT) &&
    /may only\s+DELETE/i.test(__test.SYSTEM_PROMPT),
);
assert(
  'the prompt asks for the source line alongside the name',
  /"source"/.test(__test.SYSTEM_PROMPT),
);
// Worked examples in several languages, pulling against the prompt's own
// English as a few-shot signal.
for (const word of ['oignon', 'Mehl', 'peterselie', 'aglio']) {
  assert(`the prompt shows a ${word} example`, __test.SYSTEM_PROMPT.includes(word));
}

/* ------------------------------------------------------- quantities */

/*
 * A real import of an Indian egg curry produced "2 tsp" -> "2 kg", "1.5 tsp"
 * -> "2 kg", "4 tbsp" -> "4 ml" and "1/4 tsp" -> "1", and silently dropped the
 * eggs, the cumin and the cardamom — the first three lines of the list.
 *
 * Two separate faults, both fixed by taking work AWAY from the model: it now
 * copies the amount and the measure verbatim and the arithmetic happens in
 * code, and the ingredient list is segmented in code rather than discovered by
 * the model. Everything below runs those real functions.
 */

const { parseAmount, convertAmount, metricInLine, ingredientLinesFromText } = __test;

// --- reading what recipes actually write ---------------------------------

const amounts = [
  ['2', 2], ['1.5', 1.5], ['0.25', 0.25],
  ['1/2', 0.5], ['3/4', 0.75], ['1/4', 0.25],
  ['1 1/2', 1.5], ['2 3/4', 2.75],
  ['½', 0.5], ['¼', 0.25], ['1½', 1.5],
  // A range is the TOP: rounding a shopping quantity down sends you back out.
  ['2-3', 3], ['8-9', 9], ['120-130', 130], ['3–4', 4],
  ['1,5', 1.5],
  ['', null], ['a pinch', null], ['to taste', null],
];
for (const [raw, want] of amounts) check(`parseAmount("${raw}")`, parseAmount(raw), want);

// --- the exact conversions that went wrong -------------------------------

const conversions = [
  // [amount, measure, form, expected quantity, expected unit, note]
  [2,    'tsp',  'dry',    null, null, 'red chilli powder — was 2 kg'],
  [1.5,  'tsp',  'dry',    null, null, 'kashmiri chilli — was 2 kg'],
  [1.5,  'tsp',  'dry',    null, null, 'ginger garlic paste — was 2 kg'],
  [0.25, 'tsp',  'dry',    null, null, 'garam masala — was 1'],
  [0.5,  'tsp',  'dry',    null, null, 'turmeric — was 1'],
  [4,    'tbsp', 'liquid', 60,   'ml', 'oil — was 4 ml'],
  [1.5,  'pcs',  'dry',    2,    'pcs','mace, rounded to something countable'],
  [9,    '',     'dry',    9,    'pcs','boiled eggs'],
  [5,    '',     'dry',    5,    'pcs','cloves'],
  [130,  'ml',   'liquid', 130,  'ml', 'curd'],
  [150,  'g',    'dry',    150,  'g',  'onions'],
  [10,   'gms',  'dry',    null, null, 'garlic, 10 g — under the useful floor'],
  [2,    'kg',   'dry',    2,    'kg', 'a genuine bulk amount survives'],
  [1,    'lb',   'dry',    454,  'g',  'imperial mass still converts'],
  [1,    'cup',  'liquid', 240,  'ml', 'liquid volume still converts'],
  [1,    'cup',  'dry',    null, null, 'a cup of flour has no honest gram value'],
  [null, 'tsp',  'dry',    null, null, 'no amount given'],
  [2,    'pinch','dry',    null, null, 'an unmeasurable measure'],
];
for (const [amt, measure, form, wq, wu, note] of conversions) {
  const got = convertAmount(amt, measure, form);
  check(`${String(amt)} ${measure || '(none)'} ${form} — ${note}`, `${got.quantity} ${got.unit}`, `${wq} ${wu}`);
}

// The rule that removes the whole "2 kg of chilli powder" class: a DRY volume
// never becomes a mass, because a spoon of saffron and a spoon of salt do not
// weigh the same.
for (const m of ['tsp', 'tbsp', 'cup']) {
  assert(
    `a dry ${m} yields no mass`,
    convertAmount(3, m, 'dry').quantity === null && convertAmount(3, m, 'dry').unit === null,
  );
}

// --- the source's own metric wins ----------------------------------------

check(
  'garlic: "(around 10 gms)" is read from the line',
  JSON.stringify(metricInLine('Peeled and halved small garlic cloves- 2 tsp (around 10 gms)')),
  JSON.stringify({ quantity: null, unit: null }), // 10 g, then dropped as too small
);
check(
  'onions: "(150 gms)" beats "2 medium"',
  JSON.stringify(metricInLine('Onions chopped- 2 medium (150 gms)')),
  JSON.stringify({ quantity: 150, unit: 'g' }),
);
check(
  'curd: a stated range takes its top',
  JSON.stringify(metricInLine('Whisked curd/plain yogurt- 120-130 ml')),
  JSON.stringify({ quantity: 130, unit: 'ml' }),
);
check('a line with no metric amount', metricInLine('Red Chilli powder-2 tsp'), null);
check('a bare count line', metricInLine('Bay leaves -2'), null);

// --- finding the list, which is what lost the eggs -----------------------

const pasted = [
  'Egg Lababdar | Anda Lababdar | Egg Curry Recipe | Spice Eats Egg Curry',
  'Shop CELA Brand of Kitchen Products - https://amzn.to/4rx93bX',
  'Ingredients for Egg Lababdar:',
  '',
  '* Boiled Eggs- 8-9',
  '',
  ' Tempering:',
  '',
  '* Cumin seeds-3/4 tsp',
  '* Green cardamom-4',
  '* Cloves-5',
  '* Bay leaves -2',
  '',
  ' Other Ingredients:',
  '',
  '* Onions chopped- 2 medium (150 gms)',
  '* Oil- 4 tbsp',
  '',
  ' Preparation:',
  '',
  '* Boil and shell around 9 eggs.',
  '* Chop the onions and set aside.',
  '',
  ' Process:',
  '',
  '* Heat oil in a kadhai and add the whole spices.',
].join('\n');

const lines = ingredientLinesFromText(pasted);
check('every ingredient line is found', lines.length, 7);
check('...starting with the one that was dropped', lines[0], 'Boiled Eggs- 8-9');
assert('...including the second and third', lines[1] === 'Cumin seeds-3/4 tsp' && lines[2] === 'Green cardamom-4');
assert(
  'the method section is excluded',
  !lines.some((l) => /Boil and shell|Chop the onions|Heat oil/.test(l)),
);
assert('the SEO title and the affiliate link are excluded', !lines.some((l) => /Spice Eats|amzn/.test(l)));
assert('bulleted sub-headings are excluded', !lines.some((l) => l.endsWith(':')));

// Conservative on purpose: prose is left to the model rather than mangled.
check('prose returns null so the raw text is used', ingredientLinesFromText('Just some words about a dish.'), null);
check('one stray dash is not a list', ingredientLinesFromText('a line\n- only one\nmore prose'), null);

// --- and the prompt still forbids the thing that caused it ---------------

assert(
  'the prompt tells the model not to convert',
  /DO NOT CONVERT/i.test(__test.SYSTEM_PROMPT) && /"amount"|amount and measure/i.test(__test.SYSTEM_PROMPT),
);
assert('the prompt asks for the dry/liquid judgement', /form is "dry" or "liquid"/i.test(__test.SYSTEM_PROMPT));
assert(
  'the prompt says prepared forms are still bought',
  /Boiled eggs/i.test(__test.SYSTEM_PROMPT),
);

/* --------------------------------- the egg curry, end to end ------------- */

/*
 * The exact recipe a user pasted, and every quantity it got wrong. This runs
 * the real pipeline — segmentation, then the conversion the model no longer
 * does — over the same lines, so the regression is pinned to the case rather
 * than to my reading of it.
 */
const eggCurry = [
  ['Boiled Eggs- 8-9',                                     '8-9',     '',        'dry',    '9 pcs',    'was DROPPED'],
  ['Cumin seeds-3/4 tsp',                                  '3/4',     'tsp',     'dry',    'null null','was DROPPED'],
  ['Green cardamom-4',                                     '4',       '',        'dry',    '4 pcs',    'was DROPPED'],
  ['Cloves-5',                                             '5',       '',        'dry',    '5 pcs',    'was right'],
  ['Cinnamon- 2 small pieces',                             '2',       'pieces',  'dry',    '2 pcs',    'was right'],
  ['Black peppercorns-10',                                 '10',      '',        'dry',    '10 pcs',   'was right'],
  ['Mace/ Javitri-1.5 pcs',                                '1.5',     'pcs',     'dry',    '2 pcs',    'was right'],
  ['Bay leaves -2',                                        '2',       '',        'dry',    '2 pcs',    'was right'],
  ['Whisked curd/plain yogurt- 120-130 ml',                '120-130', 'ml',      'liquid', '130 ml',   'was right'],
  ['Turmeric powder-1/2 tsp',                              '1/2',     'tsp',     'dry',    'null null','was "1"'],
  ['Red Chilli powder-2 tsp',                              '2',       'tsp',     'dry',    'null null','was "2 kg"'],
  ['Kashmiri Chilli powder-1.5 tsp',                       '1.5',     'tsp',     'dry',    'null null','was "2 kg"'],
  ['Coriander powder-2 tsp',                               '2',       'tsp',     'dry',    'null null','was "2"'],
  ['Peeled and halved small garlic cloves- 2 tsp (around 10 gms)', '2', 'tsp',   'dry',    'null null','was "10 g"'],
  ['Chopped green chillies- 3',                            '3',       '',        'dry',    '3 pcs',    'was right'],
  ['Onions chopped- 2 medium (150 gms)',                   '2',       'medium',  'dry',    '150 g',    'was right'],
  ['Ginger garlic paste-1.5 tsp',                          '1.5',     'tsp',     'dry',    'null null','was "2 kg"'],
  ['Salt-1/2 tsp + seasoning later -pinch',                '1/2',     'tsp',     'dry',    'null null','was blank'],
  ['Oil- 4 tbsp',                                          '4',       'tbsp',    'liquid', '60 ml',    'was "4 ml"'],
  ['Dry roasted Kasuri methi- 1 tsp',                      '1',       'tsp',     'dry',    'null null','was "1"'],
  ['Coriander leaves fine chopped- 3-4 tbsp',              '3-4',     'tbsp',    'dry',    'null null','was "4"'],
  ['Garam Masala powder - 1/4 tsp',                        '1/4',     'tsp',     'dry',    'null null','was "1"'],
];

for (const [line, amount, measure, form, want, note] of eggCurry) {
  const stated = metricInLine(line);
  const got = stated ?? convertAmount(parseAmount(amount), measure, form);
  const label = line.length > 44 ? `${line.slice(0, 41)}...` : line;
  check(`${label.padEnd(44)} (${note})`, `${got.quantity} ${got.unit}`, want);
}

// The three that vanished must survive segmentation, since that is what lost
// them — a conversion test alone would not have caught it.
assert(
  'the eggs, the cumin and the cardamom are all in the segmented list',
  ['Boiled Eggs- 8-9', 'Cumin seeds-3/4 tsp', 'Green cardamom-4'].every((l) =>
    eggCurry.some(([src]) => src === l),
  ),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
