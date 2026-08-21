#!/usr/bin/env node
/**
 * The recap describes numbers the app also prints. They have to agree.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * The payload carried one `itemCount`, built by flattening every row on every
 * list — ticked and unticked together. That is a third quantity which no card
 * in the app reports, and the prompt never said what the field meant, so the
 * model was handed `{"itemCount": 17}` and had to invent a verb for it. It
 * chose "grabbed". Two things had been bought and fifteen were still waiting;
 * the two cards printed directly beneath the recap said 2 and 15, correctly,
 * while the prose above them said 17.
 *
 * Nothing failed. The recap is prose from a language model, so there is no
 * assertion anywhere that it is TRUE — and there cannot be. What can be checked
 * is the two things that made it untrue:
 *
 *   1. every field in the payload comes from the same source as the card that
 *      displays the same fact, and
 *   2. every field the client sends is DEFINED in the prompt, so the model
 *      never has to guess what a number means.
 *
 * The second is the same assertion check-lexicon makes about the categorize
 * function, and for the same reason: a model given an undefined field answers
 * plausibly rather than correctly, and plausible is what nobody double-checks.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const FN = join(here, '..', '..', '..', 'supabase', 'functions', 'weekly-recap', 'index.ts');

let failures = 0;
const fail = (what, detail = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of detail) console.log(`  ${line}`);
};
const ok = (what) => console.log(`ok   ${what}`);

const payloadSrc = readFileSync(join(SRC, 'lib', 'weekly-recap.ts'), 'utf8');
const cardSrc = readFileSync(join(SRC, 'components', 'weekly-recap-card.tsx'), 'utf8');
const fnSrc = readFileSync(FN, 'utf8');

/* ------------------------------ 1. every field is defined in the prompt --- */

/*
 * The interface is the contract. Anything added to it and not described in the
 * prompt is a number the model will narrate from its name alone, which is
 * exactly how "itemCount" became "you grabbed".
 */
const iface = payloadSrc.match(/export interface RecapPayload \{[\s\S]*?\n\}/);
if (!iface) {
  fail('RecapPayload is gone or renamed', ['This check cannot verify anything without it.']);
} else {
  // Field names at one level of indentation, ignoring the doc comments between.
  const fields = [...iface[0].matchAll(/^  (\w+)\??:/gm)].map((m) => m[1]);

  /*
   * The DEFINITIONS block, not the whole prompt.
   *
   * Matching anywhere in the prompt is too weak, and provably so: deleting the
   * line that explains basketCount left this check passing, because the name
   * still appeared in a later rule about not confusing the two counts. A
   * mention is not a meaning. So the field has to be introduced here, followed
   * by a colon or a slash — the two shapes the block uses.
   */
  const prompt = fnSrc.slice(fnSrc.indexOf('const SYSTEM_PROMPT'));
  const promptText = prompt.slice(0, prompt.indexOf('`;'));
  const defsStart = promptText.indexOf('WHAT THE FIELDS MEAN');
  const defsEnd = promptText.indexOf('\nRules:');
  const defs = defsStart >= 0 && defsEnd > defsStart ? promptText.slice(defsStart, defsEnd) : '';

  const undefinedFields = defs
    ? fields.filter((f) => !new RegExp(`\\b${f}\\b\\s*(?::|/)`).test(defs))
    : fields;
  if (fields.length === 0) {
    fail('no fields parsed out of RecapPayload', ['The pattern above has stopped matching.']);
  } else if (undefinedFields.length) {
    fail(`${undefinedFields.length} payload field(s) the prompt never explains`, [
      ...undefinedFields.map((f) => `  ${f}`),
      '',
      'The model receives the payload as raw JSON. A field it has not been given',
      'a meaning for gets narrated from its name, which is how a count of every',
      'list row became "you grabbed 17 items this week".',
      '',
      'It has to be INTRODUCED under "WHAT THE FIELDS MEAN" — being mentioned',
      'in a later rule is not a definition.',
    ]);
  } else {
    ok(`all ${fields.length} payload fields are defined in the prompt`);
  }
}

/* ------------------- 2. the counts are not the old merged one ------------- */

/*
 * Comments come out first. Both files explain at length why itemCount is gone,
 * and a check that flagged its own postmortem would be deleted within a day —
 * taking the postmortem with it. Only live code counts.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

if (/\bitemCount\b/.test(stripComments(payloadSrc)) || /\bitemCount\b/.test(stripComments(cardSrc))) {
  fail('itemCount is back', [
    'It counted ticked and unticked rows together — neither what was bought nor',
    'what is still to buy, and a number no card in the app reports. Send',
    'boughtCount and basketCount instead, and let the prompt keep them apart.',
  ]);
} else {
  ok('the merged itemCount is gone');
}

/* ------------------ 3. each field comes from the card's own source -------- */

const build = cardSrc.slice(
  cardSrc.indexOf('const payload = useMemo<RecapPayload>'),
  cardSrc.indexOf('const enoughData'),
);

const SOURCES = [
  [
    'the basket is the unticked rows, as the basket card measures it',
    /const basket = basketItems\(lists\)/,
  ],
  [
    'purchases are windowed to the week the recap covers',
    /const bought = purchases\.filter\(\(p\) => p\.at >= now - 7 \* DAY\)/,
  ],
  ['boughtCount counts purchases', /boughtCount: bought\.length/],
  ['basketCount counts the basket', /basketCount: basket\.length/],
  ['the food-group split is of the basket', /basketBalance\(basket\.map/],
  ['spend is money paid, not price tags on a list', /const pricedBought = bought\.filter/],
  ['the climate score is of the purchases', /ecoScoreFor\(\s*bought\.map/],
];
for (const [what, pattern] of SOURCES) {
  if (pattern.test(build)) ok(what);
  else
    fail(what, [
      'The recap sits directly above the cards showing these same figures. A',
      'different source here means the prose contradicts the card beneath it.',
    ]);
}

/*
 * And the specific mistake that made spend double-count: a price typed against
 * something still in the basket is not money spent, and the spend card counts
 * the purchase separately.
 */
if (/priceCents/.test(build) && !/bought\.filter\(\(p\) => p\.priceCents/.test(build)) {
  fail('spend is reading prices off list rows again', [
    'A price on an unbought row is not spending, and the same shop then counts',
    'twice — once here and once from the purchase log on the spend card.',
  ]);
} else {
  ok('spend reads only from logged purchases');
}

/* --------------- 4. seasonal produce is not the reader's shopping --------- */

/*
 * `inSeason` read, to a model, like a property of the basket it was describing,
 * and it duly wrote "with tomatoes, peppers and courgettes looking fresh" about
 * a basket holding none of them. The name carries the disclaimer now, and the
 * prompt says it outright.
 */
if (/\binSeason:/.test(payloadSrc)) {
  fail('the seasonal field is named inSeason again', [
    'Named that, the model reads it as something the household has. It is a',
    'calendar lookup for their region. seasonalSuggestions says so in the name.',
  ]);
} else {
  ok('seasonal produce is named as a suggestion');
}

const promptSaysNotTheirs =
  /seasonalSuggestions[\s\S]{0,300}?NOT their items/.test(fnSrc);
if (!promptSaysNotTheirs) {
  fail('the prompt no longer says seasonal produce is not theirs', [
    'Without it the model writes them into the basket, which is what it did.',
  ]);
} else {
  ok('and the prompt says so too');
}

/* ------------------------ 5. changing the payload invalidates the cache --- */

/*
 * A recap is cached for the week, per device AND per household. Without a
 * version in the key, a payload change leaves up to seven days of prose
 * describing numbers the app no longer sends — and it looks perfectly fine, so
 * nobody reports it.
 */
if (!/const PAYLOAD_VERSION/.test(payloadSrc) || !/PAYLOAD_VERSION\}:/.test(payloadSrc)) {
  fail('the week key no longer carries a payload version', [
    'household_recaps.week is plain text precisely so the version can live in',
    'it without a migration. Drop it and a payload change ships a week of prose',
    'written from fields that no longer exist.',
  ]);
} else {
  ok('the week key carries the payload version');
}

const localData = readFileSync(join(SRC, 'lib', 'local-data.ts'), 'utf8');
const cacheKey = payloadSrc.match(/const CACHE_KEY = '([^']+)'/);
if (!cacheKey) {
  fail('the recap cache key is gone or renamed');
} else if (!localData.includes(cacheKey[1])) {
  fail(`sign-out does not clear ${cacheKey[1]}`, [
    'The recap is a paragraph of prose about the previous account’s shopping',
    'week. Bumping the key without adding it to LOCAL_DATA_KEYS leaves it on',
    'the device for the next person to sign in.',
  ]);
} else {
  ok('sign-out clears the current recap cache key');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
