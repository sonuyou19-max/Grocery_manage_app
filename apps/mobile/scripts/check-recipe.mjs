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

// A French page came back with English item names — the model defaulted to
// the prompt's own language, since nothing told it not to. Cannot test model
// behaviour from here, but the instruction it depends on can be pinned so it
// cannot be edited away without this failing.
assert(
  'the prompt forbids translating names into another language',
  /same language/i.test(__test.SYSTEM_PROMPT) && /NEVER translate/.test(__test.SYSTEM_PROMPT),
);
// The one worked example in the prompt used to be English-only, which is
// itself a few-shot nudge toward English output even alongside a rule saying
// not to. A second example in another language pulls in the other direction.
assert(
  'the worked example demonstrates a non-English source, not just an English one',
  /oignon/i.test(__test.SYSTEM_PROMPT),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
