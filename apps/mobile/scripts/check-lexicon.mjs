/**
 * Shared item-lexicon check.
 *
 * Three invariants, none of which fail loudly in production:
 *
 *  1. **The two fold() implementations must agree.** The client folds a name
 *     before asking the lexicon; the edge function folds it before storing it.
 *     If they ever disagree by one character, nothing crashes — terms are just
 *     filed under keys nobody will ever look up, and the whole shared
 *     dictionary silently stops paying off. This loads BOTH and diffs them.
 *
 *  2. **The shareability filter must be strict in the right direction.** It is
 *     the gate that keeps "call dr rutten about the rash" out of a table every
 *     customer reads. A false negative costs one unshared word; a false
 *     positive is a privacy incident. Both directions are asserted.
 *
 *  3. **The emoji allowlist must be clean.** No duplicates (wasted prompt
 *     tokens and an ambiguous set), no flags or people, and every entry short
 *     enough to render as a single glyph.
 *
 * Run with `pnpm --filter mobile check:lexicon`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'src', 'lib', 'item-emoji.ts');
const SERVER_FOLD = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fold.ts');
const ALLOWLIST = join(
  here, '..', '..', '..', 'supabase', 'functions', '_shared', 'emoji-allowlist.ts',
);
const LEXICON = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'lexicon.ts');

async function load(path, strip = []) {
  let source = readFileSync(path, 'utf8');
  for (const re of strip) source = source.replace(re, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const client = await load(CLIENT, [/^import\s[^;]*?from '@korb\/shared';/gm]);
const server = await load(SERVER_FOLD);
const allow = await load(ALLOWLIST);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
  return ok;
};

/* ------------------------------------------- 1. the two folds must agree */

const FOLD_CASES = [
  'Milk', 'MILK', '  milk  ', 'Milch', 'Käse', 'KÄSE', 'Œufs', 'œufs',
  'Masło', 'Mydło', 'Jabłka', 'Pêche', 'jalapeño', 'Crème fraîche',
  'Smørrebrød', 'Straße', 'Ærter', 'Ðill', 'Þyme', 'ısırgan',
  'Olive   oil', 'ice\tcream', 'Red \n onion', 'Café au lait',
  '', '   ', 'a', 'Żurek', 'Grüne Bohnen', 'Aardappelen',
];
let foldMismatches = 0;
for (const input of FOLD_CASES) {
  const a = client.fold(input);
  const b = server.fold(input);
  if (a !== b) {
    foldMismatches += 1;
    console.log(`FAIL fold drift on ${JSON.stringify(input)}\n  client ${JSON.stringify(a)}\n  server ${JSON.stringify(b)}`);
  }
}
if (foldMismatches) failures += foldMismatches;
check('client and server fold() agree on every case', foldMismatches, 0);

// And the folds must actually do the job, not just agree on doing nothing.
check('fold lowercases', client.fold('MILK'), 'milk');
check('fold strips accents', client.fold('Pêche'), 'peche');
check('fold maps ligatures NFD cannot', client.fold('Masło'), 'maslo');
check('fold expands œ', client.fold('Œufs'), 'oeufs');
check('fold collapses inner whitespace', client.fold('Olive   oil'), 'olive oil');
check('fold trims', client.fold('  milk  '), 'milk');

/* --------------------------------------- 2. the shareability gate, both ways */

// Real grocery words, in every language the app ships. These MUST be shareable
// or the feature never accumulates a useful dictionary.
const SHAREABLE = [
  'sriracha', 'speculoos', 'kefir', 'harissa', 'quinoa', 'kombucha',
  'oat milk', 'creme fraiche', 'sun-dried tomatoes',
  'zwiebeln', 'aardappelen', 'pomodori', 'czosnek', 'mantequilla',
  'brotchen', "creme d'or", 'pasta de dientes',
];
for (const term of SHAREABLE) {
  check(`shareable: ${JSON.stringify(term)}`, allow.isShareableTerm(term), true);
}

// The shape filter's actual contract: no digits, no punctuation beyond a
// hyphen or apostrophe, 2-24 characters, at most three words.
const REFUSED_BY_SHAPE = [
  'gift for anna birthday',                        // 4 words
  'order 4412',                                    // digits
  'sarah@example.com',                             // an email
  'pick up at 5pm',                                // digits + 4 words
  'flat 3b keys',                                  // digits
  'a',                                             // too short
  'the very long shopping note here that goes on', // too long
  'medication-2mg',                                // digits
  'tel 0475 22 11 90',                             // digits
  'https://foo',                                   // punctuation
];
for (const term of REFUSED_BY_SHAPE) {
  check(`refused by shape: ${JSON.stringify(term)}`, allow.isShareableTerm(term), false);
}

// And the honest limit, asserted rather than assumed. A short, letters-only
// private phrase sails through the shape filter — "call dr rutten" is three
// words of plain letters and is indistinguishable, on shape alone, from "sun
// dried tomatoes". The shape filter is a cheap pre-filter, NOT the privacy
// control. What actually stops these is the model's `generic` judgement, and
// behind that the requirement that three unrelated callers type the identical
// string. Pinning this here so nobody later reads the filter as a guarantee it
// does not provide.
for (const term of ['call dr rutten', 'see whatsapp', 'ring mum']) {
  check(
    `shape filter alone does NOT catch ${JSON.stringify(term)} (generic + k-anonymity do)`,
    allow.isShareableTerm(term),
    true,
  );
}

check('empty term refused', allow.isShareableTerm(''), false);
check('25 chars refused', allow.isShareableTerm('a'.repeat(25)), false);
check('24 chars accepted', allow.isShareableTerm('a'.repeat(24)), true);
check('leading space refused', allow.isShareableTerm(' milk'), false);
check('trailing hyphen refused', allow.isShareableTerm('milk-'), false);

/* ------------------------------------------------ 3. the allowlist is clean */

const list = allow.EMOJI_ALLOWLIST;
check('allowlist is non-trivial', list.length > 100, true);
check('no duplicates', list.length, new Set(list).size);
check('every entry is a non-empty string', list.every((e) => typeof e === 'string' && e.length > 0), true);
// Two codepoints max: a base glyph plus an optional variation selector. Longer
// means a ZWJ sequence or a flag, which is what we said we would not ship.
check(
  'no multi-codepoint sequences (ZWJ / flags)',
  list.filter((e) => [...e].length > 2),
  [],
);
check(
  'no regional indicators (flags)',
  list.filter((e) => [...e].some((c) => c.codePointAt(0) >= 0x1f1e6 && c.codePointAt(0) <= 0x1f1ff)),
  [],
);
// Skin-tone modifiers and the person ranges — identity, not groceries.
check(
  'no skin-tone modifiers',
  list.filter((e) => [...e].some((c) => c.codePointAt(0) >= 0x1f3fb && c.codePointAt(0) <= 0x1f3ff)),
  [],
);

check('isAllowedEmoji accepts a member', allow.isAllowedEmoji('🍎'), true);
check('isAllowedEmoji rejects a non-member', allow.isAllowedEmoji('💀'), false);
check('isAllowedEmoji rejects a flag', allow.isAllowedEmoji('🇧🇪'), false);
check('isAllowedEmoji rejects prose', allow.isAllowedEmoji('an apple'), false);
check('isAllowedEmoji rejects undefined', allow.isAllowedEmoji(undefined), false);
check('isAllowedEmoji rejects empty', allow.isAllowedEmoji(''), false);

/* ------------------------------- 4. the lexicon tier sits in the right place */

// Injected resolver: a whole-term lexicon hit must beat the curated table's
// word-by-word scan, but must NOT beat a curated whole-name match.
client.setEmojiLexicon((term) => (term === 'coconut water' ? '💧' : undefined));
check('lexicon whole-term beats a curated word match', client.emojiFor('Coconut water', 'drinks'), '💧');
// 'pasta de dientes' is a genuine multi-word key in the curated table, so this
// exercises the real precedence: a curated whole-name match outranks anything
// the lexicon learned. (An earlier version of this test used 'olive oil', which
// is NOT a curated whole-name entry — it resolves via the word scan — and so
// asserted the opposite of what it claimed to.)
client.setEmojiLexicon((term) => (term === 'pasta de dientes' ? '💀' : undefined));
check('curated whole-name still beats the lexicon', client.emojiFor('Pasta de dientes', 'personal_care'), '🪥');
client.setEmojiLexicon((term) => (term === 'olive oil' ? '🛢️' : undefined));
check('lexicon whole-term beats the curated WORD scan', client.emojiFor('Olive oil', 'pantry'), '🛢️');
client.setEmojiLexicon(() => undefined);
check('unwired lexicon changes nothing', client.emojiFor('Milk', 'dairy_eggs'), '🥛');
check('unknown term still falls back to its category', client.emojiFor('zzzqq', 'bakery'), '🍞');

/* ------------------------------------ the prompt asks for what the parser reads */

// The bug this pins, found in a shipped build: the response-shape example named
// only two of the five fields. Everything described in prose further down —
// emoji, generic, unit — was quietly never returned, because a model that is
// shown an object with two keys returns an object with two keys.
//
// It was invisible for weeks. English items still showed the right emoji from
// the curated table, so only a Hindi word revealed it — and `generic` silently
// defaulting to false meant the shared lexicon had never published a single
// term. A prompt cannot be typechecked, so this is the only place the two
// halves are held together.
const fn = readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', 'categorize', 'index.ts'), 'utf8');

const promptMatch = fn.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
check('the system prompt is findable', promptMatch != null, true);
const prompt = promptMatch ? promptMatch[1] : '';

// Every key the parser destructures off the model's JSON.
const parsedShape = fn.match(/const parsed = JSON\.parse\(extractJson\(raw\)\) as \{([\s\S]*?)\};/);
check('the parsed shape is findable', parsedShape != null, true);
const fields = parsedShape
  ? [...parsedShape[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
  : [];
// Deliberately not a count. It used to assert `fields.length === 5`, which meant
// adding a sixth field to the function broke a check that had noticed nothing
// wrong — the number was a restatement of today's code, not a property of it.
// What actually has to hold is that the three lists agree: everything the
// parser reads is named in the prompt's example, and everything the response
// returns was parsed. Both survive a field being added; neither survives one
// being added in only two of the three places, which is the real failure.
check('some fields are parsed', fields.length > 0, true);

// The example object the model is shown, i.e. the first {...} in the prompt.
const example = (prompt.match(/\{[^}]*"category"[^}]*\}/) ?? [''])[0];
for (const f of fields) {
  check(`the prompt's example object names "${f}"`, example.includes(`"${f}"`), true);
}

// And the other end: a field the function returns but never parsed is a field
// that is always its default. `group` is computed rather than returned from the
// parse block in the same shape, so it is allowed to be absent from `fields`.
const returned = (fn.match(/return Response\.json\(\{([^}]*)\}\)/) ?? ['', ''])[1]
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
check('the response is findable', returned.length > 0, true);
for (const f of returned) {
  if (f === 'group') continue;
  check(`"${f}" is parsed before it is returned`, fields.includes(f), true);
}

/* ------------------------------------------------------- the storage tip -- */

/*
 * THE ONLY FREE TEXT THIS TABLE PUBLISHES.
 *
 * Every other shared column comes from a closed set — the emoji is copied from
 * an allowlist, unit and carbon and food_group are enums with CHECKs — so a bad
 * generation can only ever be a wrong value from a known vocabulary, and the
 * worst case is a carrot wearing the wrong icon.
 *
 * A sentence has no vocabulary to check against. One bad generation reaches
 * every customer, and unlike a wrong emoji nobody can glance at it and see it.
 * isShareableTip is what stands in for the missing allowlist, so it is tested
 * directly rather than through a network call.
 */
{
  // Only the guard is wanted; the module's supabase-js import will not resolve
  // here and nothing below needs the writer itself.
  const src = readFileSync(LEXICON, 'utf8');
  const fn = src.slice(src.indexOf('const CLAIM_WORDS'), src.indexOf('export async function offerToLexicon'));
  const foldSrc = readFileSync(SERVER_FOLD, 'utf8').replace(/^export /gm, '');
  const { outputText } = ts.transpileModule(
    foldSrc + '\n' + fn.replace('export function isShareableTip', 'export function isShareableTip'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  );
  const { isShareableTip } = await import(
    'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
  );

  const ok = (name, tip) => check(name, isShareableTip(tip), true);
  const no = (name, tip) => check(name, isShareableTip(tip), false);

  // What a tip is FOR. Refusing everything would be safe and useless.
  ok('a real storage tip passes', 'Keep spinach unwashed in the fridge with a dry paper towel.');
  ok('...and one without a full stop', 'Bananas brown faster next to apples');
  ok('...and one about a cupboard', 'Once opened, olive oil keeps best in a dark cupboard.');

  /*
   * THE REGULATED ONES. "High in iron" is a nutrition claim under EU
   * 1924/2006 — only claims on the authorised list may be made at all, and each
   * has a legal threshold. Publishing one to every customer, about an item
   * somebody typed, is a compliance problem whose failure nobody would notice.
   */
  no('a vitamin claim is refused', 'Spinach is rich in vitamins, so eat it fresh.');
  no('...an iron claim', 'High in iron — keep it cool and eat within days.');
  no('...a calorie claim', 'Low calorie and best kept in the fridge door.');
  no('...a health claim', 'Good for your immune system; store in the fridge.');
  no('...a digestion claim', 'Aids digestion, so keep a bag in the freezer.');
  no('...and a cure claim', 'A remedy for colds; keep it somewhere dark.');
  /*
   * Matched on word boundaries, so an ordinary word that merely CONTAINS a
   * claim word is not caught. "Heart" is a claim word; "hearty" is not a claim.
   */
  check('a word that merely contains one is fine', isShareableTip('Store the hearts of the lettuce in the fridge.'), true);

  // SHAPE. Each of these is also a CHECK on the column; both refuse, and
  // neither is the other's excuse.
  /*
   * Each shape rule gets a fixture that trips ONLY it. Three of these first
   * caught nothing when the rule they were written for was deleted, because
   * they also broke a different rule: a 280-character tip built by repeating a
   * sentence is refused for having twenty sentences whether or not there is a
   * length ceiling, and a two-line tip is refused for being two sentences.
   * A test that passes for the wrong reason is not a test.
   */
  no('too short to say anything', 'Fridge.');
  no('too long to be a tip', `Keep it ${'very '.repeat(40)}cold`);
  no('a link', 'Storage advice at https://example.com/spinach keeps it fresh');
  no('...even without a scheme', 'See www.example.com for how to store spinach well');
  no('markup', 'Keep it <b>cold</b> and dry in the fridge drawer');
  no('a template brace', 'Keep ${item} in the fridge, unwashed and dry');
  no('a newline', 'Keep it cold\nand dry in the drawer');
  no('two sentences', 'Keep it cold. Then eat it within three days please.');

  /*
   * And the gate is actually wired: a candidate whose tip fails must reach the
   * table as null rather than as itself.
   */
  check(
    'a refused tip is stored as null, not as text',
    /typeof candidate\.tip === 'string' && isShareableTip\(candidate\.tip\)/.test(src),
    true,
  );
  /*
   * Fill-once, like unit and carbon and food_group. A sentence that a later
   * generation can overwrite has no settled version, which defeats the whole
   * point of the three-caller threshold.
   */
  check(
    '...and never rewritten once set',
    /\.update\(\{ storage_tip: tip \}\)[\s\S]{0,120}\.is\('storage_tip', null\)/.test(src),
    true,
  );
}

console.log(failures === 0 ? 'ALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
