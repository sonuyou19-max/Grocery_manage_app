/**
 * Pantry-intel check — the interval precedence chain and staple ordering.
 *
 * `effectiveInterval` is the single point every prediction reads through: the
 * due date, the Vibe Check deck, the pantry bar and the weekly list builder. A
 * wrong precedence there is invisible in the UI but silently ignores what the
 * user explicitly told us, which is the one thing a "set your own cadence"
 * feature must never do. The deck cap makes ordering matter too — a staple
 * pushed past the cap disappears entirely.
 *
 * Run with `pnpm --filter mobile check:pantry-intel`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'pantry-intel.ts');

const source = readFileSync(SRC, 'utf8').replace(/^import\s[^;]*?from '@korb\/shared';/gm, '');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 22);

const stat = (over = {}) => ({
  key: over.key ?? 'milk',
  display: over.display ?? 'Milk',
  category: over.category ?? 'dairy_eggs', // default interval 7
  lastPurchasedAt: over.lastPurchasedAt ?? now - 3 * DAY,
  intervalDays: over.intervalDays ?? 0,
  sampleCount: over.sampleCount ?? 0,
  snoozeUntil: over.snoozeUntil ?? null,
  keepStocked: over.keepStocked,
  cadenceDays: over.cadenceDays,
  archivedAt: over.archivedAt,
});

/* --------------------------------------------------- precedence: 1 > 2 > 3 */

// 3. No history at all → the category default.
check('no history uses category default', mod.effectiveInterval(stat()), 7);

// 2. Learned rate beats the category default.
check(
  'learned rate beats default',
  mod.effectiveInterval(stat({ intervalDays: 12, sampleCount: 3 })),
  12,
);

// 1. A user cadence beats BOTH — the whole point of the feature.
check(
  'user cadence beats learned rate',
  mod.effectiveInterval(stat({ intervalDays: 12, sampleCount: 3, cadenceDays: 4 })),
  4,
);
check(
  'user cadence beats category default',
  mod.effectiveInterval(stat({ cadenceDays: 30 })),
  30,
);

// Null/absent/zero cadence must NOT be read as an override.
check('null cadence falls through', mod.effectiveInterval(stat({ cadenceDays: null, intervalDays: 12, sampleCount: 3 })), 12);
check('undefined cadence falls through', mod.effectiveInterval(stat({ intervalDays: 12, sampleCount: 3 })), 12);
check('zero cadence falls through (not "due immediately")', mod.effectiveInterval(stat({ cadenceDays: 0, intervalDays: 12, sampleCount: 3 })), 12);

check('hasUserCadence true only for a real override', [
  mod.hasUserCadence(stat({ cadenceDays: 5 })),
  mod.hasUserCadence(stat({ cadenceDays: null })),
  mod.hasUserCadence(stat({ cadenceDays: 0 })),
  mod.hasUserCadence(stat()),
], [true, false, false, false]);

/* ------------------------------------- the cadence must actually move dueAt */

// A shorter cadence brings the due date forward; that's what the user asked for.
const learnedLong = stat({ intervalDays: 30, sampleCount: 5 });
const pinnedShort = stat({ intervalDays: 30, sampleCount: 5, cadenceDays: 2 });
check('cadence brings dueAt forward', mod.dueAt(pinnedShort) < mod.dueAt(learnedLong), true);
check('short cadence makes it due now', mod.isDue(pinnedShort, now), true);
check('long learned rate is not due yet', mod.isDue(learnedLong, now), false);
// And lifeRemaining must agree, or the bar would contradict the status text.
check('lifeRemaining respects cadence', mod.lifeRemaining(pinnedShort, now), 0);

/* ------------------------------------------------------------- applyStaple */

const base = { milk: stat({ key: 'milk' }) };
check('applyStaple sets the flag', mod.applyStaple(base, 'milk', { keepStocked: true }).milk.keepStocked, true);
check('applyStaple sets cadence', mod.applyStaple(base, 'milk', { cadenceDays: 5 }).milk.cadenceDays, 5);
check('applyStaple clears cadence with null', mod.applyStaple({ milk: stat({ cadenceDays: 9 }) }, 'milk', { cadenceDays: null }).milk.cadenceDays, null);
// Setting a cadence must clear a snooze, or the correction the user just made
// stays suppressed by an old "still good".
check(
  'setting a cadence clears the snooze',
  mod.applyStaple({ milk: stat({ snoozeUntil: now + 5 * DAY }) }, 'milk', { cadenceDays: 3 }).milk.snoozeUntil,
  null,
);
// Toggling the staple flag alone must NOT clear a snooze — it isn't a
// correction to the prediction.
check(
  'toggling staple keeps the snooze',
  mod.applyStaple({ milk: stat({ snoozeUntil: now + 5 * DAY }) }, 'milk', { keepStocked: true }).milk.snoozeUntil,
  now + 5 * DAY,
);
// Patching one field must leave the other alone.
const both = mod.applyStaple({ milk: stat({ keepStocked: true, cadenceDays: 7 }) }, 'milk', { keepStocked: false });
check('patch leaves the untouched field alone', both.milk.cadenceDays, 7);
check('unknown key is a no-op', mod.applyStaple(base, 'nope', { keepStocked: true }), base);

/* ------------------------------------------------- deck ordering + the cap */

// Staples outrank more-overdue incidentals.
const deck = mod.buildDeck(
  {
    incidental: stat({ key: 'incidental', display: 'Incidental', lastPurchasedAt: now - 100 * DAY }),
    staple: stat({ key: 'staple', display: 'Staple', keepStocked: true, lastPurchasedAt: now - 8 * DAY }),
  },
  new Set(),
  now,
);
check('staple sorts ahead of a more-overdue item', deck.map((c) => c.key), ['staple', 'incidental']);
check('deck exposes keepStocked', deck[0].keepStocked, true);
check('non-staple reports keepStocked false', deck[1].keepStocked, false);

// The cap is why ordering matters: with more due items than DECK_CAP, a staple
// must still make the cut.
const many = {};
for (let i = 0; i < mod.DECK_CAP + 5; i += 1) {
  many[`old${i}`] = stat({ key: `old${i}`, display: `Old ${i}`, lastPurchasedAt: now - (200 + i) * DAY });
}
many.staple = stat({ key: 'staple', display: 'Staple', keepStocked: true, lastPurchasedAt: now - 8 * DAY });
const capped = mod.buildDeck(many, new Set(), now);
check('deck respects the cap', capped.length, mod.DECK_CAP);
check('a staple survives the cap', capped.some((c) => c.key === 'staple'), true);
check('the staple is first', capped[0].key, 'staple');

// Excluded keys still win over staple status — it's already on a list.
check(
  'an excluded staple stays out',
  mod.buildDeck(many, new Set(['staple']), now).some((c) => c.key === 'staple'),
  false,
);

/* ----------------------------------------- existing behaviour still intact */

// A snooze must still suppress a due item, staple or not.
check(
  'snooze suppresses',
  mod.isDue(stat({ lastPurchasedAt: now - 100 * DAY, snoozeUntil: now + DAY }), now),
  false,
);
check('never-purchased is never due', mod.isDue(stat({ lastPurchasedAt: 0 }), now), false);
// recordPurchase must not wipe the staple settings — it's called on every
// check-off, so losing them there would silently undo the user's choice.
const after = mod.recordPurchase(
  { milk: stat({ keepStocked: true, cadenceDays: 5 }) },
  'Milk',
  'dairy_eggs',
  now,
);
check('recordPurchase keeps keepStocked', after.milk.keepStocked, true);
check('recordPurchase keeps cadenceDays', after.milk.cadenceDays, 5);

/* ------------------------------------------------------------- resting */

// Resting is the "stop asking me about this" state. It must beat every reason
// an item would otherwise surface — an item asleep for a year is the exact case
// the feature exists for, so an overdue check must not wake it.
const asleep = stat({ lastPurchasedAt: now - 365 * DAY, archivedAt: now - 30 * DAY });
check('hasStopped reads the timestamp', mod.hasStopped(asleep), true);
check('an active item is not resting', mod.hasStopped(stat()), false);
check('a wildly overdue resting item is never due', mod.isDue(asleep, now), false);
check(
  'resting items stay out of the deck',
  mod.buildDeck({ asleep }, new Set(), now).length,
  0,
);
// A staple that is resting must not slip in through the staple ordering path.
check(
  'a resting staple stays out of the deck too',
  mod.buildDeck(
    { s: stat({ key: 's', keepStocked: true, lastPurchasedAt: now - 100 * DAY, archivedAt: now }) },
    new Set(),
    now,
  ).length,
  0,
);

const rested = mod.applyStopped({ milk: stat() }, 'milk', true, now);
check('resting stamps the moment', rested.milk.archivedAt, now);
check('resting keeps the learned rate', rested.milk.intervalDays, stat().intervalDays);

// Waking restarts the countdown rather than resuming an ancient one, so a
// long-asleep item doesn't shout on the first Vibe Check after it comes back.
const woken = mod.applyStopped({ milk: asleep }, 'milk', false, now);
check('waking clears the timestamp', woken.milk.archivedAt, null);
check('waking restarts the clock', woken.milk.lastPurchasedAt, now);
check('waking clears any snooze', woken.milk.snoozeUntil, null);
check('a woken item is not immediately due', mod.isDue(woken.milk, now), false);
check('waking keeps the learned rate', woken.milk.intervalDays, asleep.intervalDays);
check('waking keeps the sample count', woken.milk.sampleCount, asleep.sampleCount);
check('resting an unknown key is a no-op', mod.applyStopped({}, 'nope', true, now), {});

/* ============ the two thresholds, and the line that used to conflate them === */

/*
 * LOW_THRESHOLD and DUE_FRACTION answer different questions and are BOTH right:
 *
 *   LOW_THRESHOLD (0.35 remaining)  "flag it"  — the Running low section, the
 *       bar's colour, and the recipe importer's have-I-got-enough check.
 *   DUE_FRACTION  (0.9 elapsed)     "ask about it" — the Vibe Check deck, the
 *       list screen's suggestions, the recap's what's-coming-up.
 *
 * They are deliberately not equal, so a row can be in the section without being
 * due — which is fine, and was only ever confusing because statusLabel printed
 * the SECTION'S words. The obvious "fix" is to collapse them into one number;
 * that floods the deck or delays the warning, so this asserts they stay apart
 * and that the label keeps stating its own urgency.
 */
const T = (key, opts) => {
  if (key === 'status.daysLeft') return `~${opts.count} days left`;
  if (key === 'status.daysOver') return `${opts.count} days over`;
  return key.split('.')[1];
};

// A 10-day rhythm: flagged from day 6.5, due from day 9.
const paced = stat({ intervalDays: 10, sampleCount: 5, lastPurchasedAt: now - 0 });
const at = (d) => ({ ...paced, lastPurchasedAt: now - d * DAY });

check('just bought: not flagged', mod.lifeRemaining(at(0), now) < mod.LOW_THRESHOLD, false);
check('day 7: flagged', mod.lifeRemaining(at(7), now) < mod.LOW_THRESHOLD, true);
check('day 7: NOT yet due', mod.isDue(at(7), now), false);
check('day 7 label states days left, not the section', mod.statusLabel(at(7), now, T), '~2 days left');
check('day 9: due', mod.isDue(at(9), now), true);
check('day 9 label', mod.statusLabel(at(9), now, T), 'dueNow');
check('day 12 label counts the overshoot', mod.statusLabel(at(12), now, T), '3 days over');

/*
 * The label must never reach for the section's key again. Checked on the source
 * because it is a wording decision, not a value one — no assertion about output
 * would catch someone renaming the string back.
 */
const libSrc = readFileSync(join(here, '..', 'src', 'lib', 'pantry-intel.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
if (/status\.runningLow/.test(libSrc)) {
  failures += 1;
  console.log('FAIL statusLabel prints the Running low section\'s own words again');
  console.log('  Inside a section headed "Running low", a row reading "Running low"');
  console.log('  says nothing and reads as a contradiction next to its neighbours');
  console.log('  showing "~2 days left". State the row\'s own urgency instead.');
} else {
  console.log('ok   statusLabel does not reuse the section\'s wording');
}

if (mod.LOW_THRESHOLD >= 1 || mod.LOW_THRESHOLD <= 0) {
  failures += 1;
  console.log(`FAIL LOW_THRESHOLD is not a fraction of a lifespan (${mod.LOW_THRESHOLD})`);
} else {
  console.log(`ok   LOW_THRESHOLD is still a lifespan fraction (${mod.LOW_THRESHOLD})`);
}

// Flagging must stay STRICTLY earlier than asking, or the section becomes a
// mirror of the deck, and the early warning it exists to give disappears.
const flagAt = 1 - mod.LOW_THRESHOLD;
if (!(flagAt < 0.9)) {
  failures += 1;
  console.log('FAIL "flag it" no longer precedes "ask about it"');
  console.log(`  flagged at ${(flagAt * 100).toFixed(0)}% elapsed, asked at 90%`);
  console.log('  The Running low section exists to warn BEFORE the deck asks.');
} else {
  console.log(`ok   flagged at ${(flagAt * 100).toFixed(0)}% elapsed, asked at 90% — in that order`);
}

/* ================== how hard one shop may move the learned rate ============ */

/*
 * The interval is learned from gaps between purchases, and a single gap is a
 * terrible witness: a fortnight away from home looks exactly like "we now buy
 * milk fortnightly". The old flat EMA believed it at once — 7 days became 12.6
 * — and the item then went quiet for a week and a half, right when the user got
 * home and needed milk.
 *
 * These assert both halves of the fix: noise is absorbed, and real change is
 * still learned. A rule that only did the first would be a rule that never
 * learns anything, and it would pass any test written about holidays alone.
 */
const checkDeep = (title, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${title}`);
  else {
    failures += 1;
    console.log(`FAIL ${title}`);
    console.log(`  expected ${e}`);
    console.log(`  actual   ${a}`);
  }
};

const rounded = (n) => Math.round(n * 10) / 10;
const learn = (seed, gaps) => {
  let iv = seed;
  let n = 1;
  for (const g of gaps) {
    iv = mod.blendInterval(iv, g, n);
    n += 1;
  }
  return rounded(iv);
};

// Noise: settled at 7 days, one 21-day holiday. The old rule gave 12.6.
check('one holiday barely moves a settled rate', learn(7, [7, 7, 7, 21]), 8.8);
// ...and it comes back rather than staying stretched.
check('and it recovers over the next few shops', learn(7, [7, 7, 7, 21, 7, 7, 7]), 7.7);

// Signal: the household really does move to a fortnight. Must still converge.
const drift = learn(7, [7, 7, 7, 14, 14, 14, 14, 14, 14]);
if (drift > 12 && drift < 14) {
  console.log(`ok   a genuine change is still learned (7 -> ${drift} over six shops)`);
} else {
  failures += 1;
  console.log(`FAIL a genuine change is no longer learned (7 -> ${drift}, wanted 12-14)`);
  console.log('  Damping that also blocks real drift is not damping, it is a freeze.');
}

/*
 * The cap binds at exactly 2x, and only upward. Both fall out of MAX_STEP being
 * equal to ALPHA_FLOOR — see blendInterval — so these two assertions are what
 * would catch someone "tidying up" one constant without the other.
 */
check('a gap of exactly 2x is NOT capped', rounded(mod.blendInterval(10, 20, 9)), 12.5);
check('a gap of 4x is capped to the same move', rounded(mod.blendInterval(10, 40, 9)), 12.5);
check('a gap of 40x is capped to the same move', rounded(mod.blendInterval(10, 400, 9)), 12.5);
// Downward, the cap never binds: even a gap of zero only pulls by alpha.
check('a much shorter gap is believed, not capped', rounded(mod.blendInterval(10, 0, 9)), 7.5);
check('...at the floor alpha, whatever the sample count', rounded(mod.blendInterval(10, 0, 999)), 7.5);

/*
 * Damping: early samples move more than late ones, because early on the app has
 * almost no evidence and the shop in front of it is most of what it knows.
 */
/*
 * Probed at 1.4x, deliberately. At 2x and beyond the CAP decides the answer and
 * both sample counts land on the same number — a test written there would pass
 * whether or not damping existed at all.
 */
const early = mod.blendInterval(10, 14, 1);
const late = mod.blendInterval(10, 14, 50);
if (early > late) {
  console.log(`ok   the 2nd shop moves the rate more than the 50th (${rounded(early)} vs ${rounded(late)})`);
} else {
  failures += 1;
  console.log('FAIL sample count no longer damps the blend');
  console.log(`  2nd shop -> ${rounded(early)}, 50th -> ${rounded(late)}; the 50th must move it less.`);
}
// But never to zero: a rhythm that really changed must not be locked out.
// Also below the cap, so it is the FLOOR being tested and not the ceiling:
// without a floor, alpha would be ~0 here and the answer would be 10.
check('damping bottoms out rather than freezing', rounded(mod.blendInterval(10, 14, 1e6)), 11);


/* ------------------- the queue rule: a tick beats an untick ---------------- */

/*
 * The bug this is written for, exactly as reported.
 *
 * "Check 1" and a recipe list both carry gnocchi. Ticking it off the shop left
 * it unticked on the recipe list, so the Pantry still counted it as queued and
 * filed it under Running low — a row reading "On a list · Last bought today ·
 * ~7 days left" next to a full green bar. Three statements that cannot all be
 * advice about the same jar.
 *
 * Only sound because the lists handed in are SWEPT (lib/list-sweep): a ticked
 * row that survives was ticked today, so "ticked somewhere" means "bought
 * today". These cases pin the rule, not the wording of it.
 */
const keys = (lists) => [...mod.queuedKeys(lists)].sort();
const L = (...items) => ({ items });
const I = (name, checked = false) => ({ name, checked });

checkDeep('an unticked row queues the item', keys([L(I('Milk'))]), ['milk']);
checkDeep('a ticked row does not', keys([L(I('Milk', true))]), []);
// The reported case: ticked on one list, still unticked on another.
checkDeep(
  'a tick on ANY list cancels an untick on another',
  keys([L(I('Gnocchi di Patate', true)), L(I('Gnocchi di Patate'))]),
  [],
);
// Order must not matter — a Set built the other way round would pass the case
// above by luck and fail this one.
checkDeep(
  '...whichever list is seen first',
  keys([L(I('Gnocchi di Patate')), L(I('Gnocchi di Patate', true))]),
  [],
);
// Identity is normalizeKey's, not the raw string: two spellings are one item,
// so a tick on one really does cancel the other.
checkDeep(
  'the tick and the untick are matched by item key',
  keys([L(I('  OLIVE   OIL '), I('Olive oil', true))]),
  [],
);
checkDeep(
  'unrelated items are untouched',
  keys([L(I('Milk', true), I('Bread'))]),
  ['bread'],
);
checkDeep('no lists, nothing queued', keys([]), []);


/* ----------------- which lists an item is tagged with --------------------- */

/*
 * The Pantry tags an open item with the lists holding it. Ticked rows count:
 * a bought item has not left the list, it is in the "added to pantry" section
 * at its foot, and this answers "where does this live" rather than "do I still
 * need it" — which is the opposite of what queuedKeys above answers, and the
 * reason they are two functions instead of one flag.
 */
const named = (lists, key) => mod.listsHolding(lists, key).map((l) => l.name);

checkDeep(
  'an item is tagged with every list holding it',
  named(
    [
      { name: 'Check 1', items: [I('Citroen', true), I('Zout')] },
      { name: 'Gnocchi', items: [I('Citroen')] },
      { name: 'Weekly', items: [I('Melk')] },
    ],
    'citroen',
  ),
  ['Check 1', 'Gnocchi'],
);
// A ticked row still counts — the opposite of the queue rule, deliberately.
checkDeep(
  'a ticked row still tags its list',
  named([{ name: 'Check 1', items: [I('Citroen', true)] }], 'citroen'),
  ['Check 1'],
);
checkDeep(
  'matching is by item key, not raw name',
  named([{ name: 'Check 1', items: [I('  OLIVE   OIL ')] }], 'olive oil'),
  ['Check 1'],
);
checkDeep('an untracked item has no tags', named([{ name: 'Check 1', items: [I('Zout')] }], 'melk'), []);

/* ------------------ the home list is household state, not device state ---- */

/*
 * "You usually buy" filters a list's chips by which list each item is homed to.
 * That mapping used to live only in AsyncStorage, so the strip appeared on
 * whichever handset had done the adding and was simply absent on the other —
 * reported as an iOS feature missing from Android, when it was a feature of one
 * phone. Migration 0037 moved it to pantry_items.home_list_id.
 *
 * Three halves have to stay joined for that to keep working, and none of them
 * fails loudly on its own: the write-through, the seed on row creation, and the
 * read preferring the shared answer. A device-local regression here looks
 * exactly like "no items are due", which is also what a correct empty state
 * looks like.
 */
const read = (...parts) => readFileSync(join(here, '..', 'src', ...parts), 'utf8');

const homeLib = read('lib', 'item-home-list.ts');
const remember = homeLib.slice(
  homeLib.indexOf('export function rememberItemList'),
  homeLib.indexOf('export function recallItemList'),
);
check(
  'rememberItemList writes the home list through to the household',
  /home_list_id/.test(remember) && /from\('pantry_items'\)/.test(remember),
  true,
);
check(
  'the shared write is an update, never an upsert',
  /\.update\(/.test(remember) && !/\.upsert\(/.test(remember),
  true,
);
check(
  'and is skipped when there is no household to share with',
  /scope === 'local'/.test(remember),
  true,
);

const store = read('store', 'pantry-intel.tsx');
// The select list is matched as a whole rather than sliced out of the file:
// several queries hit pantry_items, and anchoring on the one that reads the
// columns is what makes this assert the fetch and not, say, the seed insert.
// display_name is what identifies the PANTRY fetch: the price_entries selects
// also carry item_key, and matching those would assert the wrong query.
const selects = [...store.matchAll(/\.select\(\s*'([^']*display_name[^']*)'/g)].map((m) => m[1]);
check('the pantry fetch selects the shared home list', selects.length > 0 && selects.every((sel) => sel.includes('home_list_id')), true);

check(
  'a check-off seeds home_list_id rather than blanking it',
  /home_list_id: s\.homeList \?\? recallItemList\(/.test(store),
  true,
);

const strip = read('components', 'list-pantry-strip.tsx');
check(
  'the strip prefers the household answer over the device memory',
  /s\.homeList \?\? recallItemList\(/.test(strip),
  true,
);

/* -------------------- buying it again is how a stop is undone ------------- */

/*
 * "I've stopped buying this" is a statement about intent, and buying the thing
 * contradicts it — so the flag clears itself rather than waiting for a tap
 * nobody will think to make.
 *
 * The half that would go wrong quietly is the GAP. An item stopped in March and
 * bought again in December produces a nine-month interval, and blending that
 * into the burn rate teaches the app you buy this once a year — from a single
 * purchase, permanently, with nothing on screen explaining why the milk stopped
 * being predicted. applyStopped's resume path has refused that gap since it was
 * written; the automatic return has to refuse it too, or the two doors into one
 * state behave differently.
 */
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 0, 1);
  const stopped = {
    milk: {
      key: 'milk',
      display: 'Milk',
      category: 'dairy_eggs',
      // Bought weekly for a while, then stopped nine months ago.
      lastPurchasedAt: now - 270 * DAY,
      intervalDays: 7,
      sampleCount: 6,
      snoozeUntil: null,
      archivedAt: now - 269 * DAY,
    },
  };

  const back = mod.recordPurchase(stopped, 'Milk', 'dairy_eggs', now).milk;
  check('buying it again clears the stop', back.archivedAt, null);
  check('...and does not learn the long gap', back.intervalDays, 7);
  check('...nor counts it as a sample', back.sampleCount, 6);
  check('...and the clock starts from this purchase', back.lastPurchasedAt, now);

  /*
   * The mirror: an ordinary repeat purchase must still learn from its gap, or
   * the guard above would be satisfied by a recordPurchase that never learns
   * anything at all.
   */
  const active = {
    milk: { ...stopped.milk, archivedAt: null, lastPurchasedAt: now - 10 * DAY },
  };
  const again = mod.recordPurchase(active, 'Milk', 'dairy_eggs', now).milk;
  check('a normal repeat still learns its gap', again.sampleCount, 7);
  check('...and moves the interval toward it', again.intervalDays > 7, true);

  /*
   * And the settings a purchase must never wipe. recordPurchase spreads the
   * previous row first for this reason; clearing archivedAt is the one field
   * that is deliberately overwritten, and it would be easy to "tidy" that into
   * rebuilding the whole stat.
   */
  const pinned = {
    milk: { ...stopped.milk, keepStocked: true, cadenceDays: 14 },
  };
  const kept = mod.recordPurchase(pinned, 'Milk', 'dairy_eggs', now).milk;
  check('the staple flag survives the return', kept.keepStocked, true);
  check('a pinned cadence survives the return', kept.cadenceDays, 14);
}

/* --------------------------- the two doors agree ------------------------- */

/*
 * applyStopped's resume path and recordPurchase's automatic one must leave the
 * item in the same shape, or "buying it again" and "tapping Buying again" would
 * predict differently for the same item.
 */
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 0, 1);
  const stats = {
    rice: {
      key: 'rice',
      display: 'Rice',
      category: 'pantry',
      lastPurchasedAt: now - 200 * DAY,
      intervalDays: 30,
      sampleCount: 4,
      snoozeUntil: null,
      archivedAt: now - 199 * DAY,
    },
  };
  const tapped = mod.applyStopped(stats, 'rice', false, now).rice;
  const bought = mod.recordPurchase(stats, 'Rice', 'pantry', now).rice;
  check('both doors clear the flag', [tapped.archivedAt, bought.archivedAt], [null, null]);
  check('both restart the clock', [tapped.lastPurchasedAt, bought.lastPurchasedAt], [now, now]);
  check(
    'both keep the learned rate',
    [tapped.intervalDays, bought.intervalDays, tapped.sampleCount, bought.sampleCount],
    [30, 30, 4, 4],
  );
}

/* ---------------------- undo is not the same as buying again ------------- */

/*
 * Both clear the flag, and there the resemblance stops.
 *
 * "Buying again" is a decision, so the countdown restarts from now. Undo means
 * the tap should never have happened, so the item goes back to exactly what it
 * was — and restarting the clock there would destroy the one field the stop
 * existed to preserve, on the button somebody pressed to prevent any change at
 * all. The failure is silent: the item reappears, looks right, and has quietly
 * forgotten when it was last bought.
 */
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 0, 1);
  const bought = now - 40 * DAY;
  const snooze = now + 3 * DAY;
  const stats = {
    olives: {
      key: 'olives',
      display: 'Olives',
      category: 'pantry',
      lastPurchasedAt: bought,
      intervalDays: 30,
      sampleCount: 3,
      snoozeUntil: snooze,
      archivedAt: now,
    },
  };

  const undone = mod.applyStopped(stats, 'olives', false, now, { restartClock: false }).olives;
  check('undo clears the flag', undone.archivedAt, null);
  check('...and leaves last-bought exactly where it was', undone.lastPurchasedAt, bought);
  check('...and does not silently cancel a snooze', undone.snoozeUntil, snooze);

  const resumed = mod.applyStopped(stats, 'olives', false, now).olives;
  check('buying again clears the flag too', resumed.archivedAt, null);
  check('...but restarts the countdown, which is the point of it', resumed.lastPurchasedAt, now);
  check('...and clears the snooze with it', resumed.snoozeUntil, null);

  // The default has to stay the deliberate one: every caller except the toast
  // means "buying again", and an inverted default would make the common path
  // the surprising one.
  const byDefault = mod.applyStopped(stats, 'olives', false, now, {}).olives;
  check('an empty options object still restarts', byDefault.lastPurchasedAt, now);

  // Stopping is unchanged by any of this.
  const stoppedAgain = mod.applyStopped(
    { olives: { ...stats.olives, archivedAt: null } },
    'olives',
    true,
    now,
  ).olives;
  check('stopping stamps the moment', stoppedAgain.archivedAt, now);
  check('...and touches nothing else', stoppedAgain.lastPurchasedAt, bought);
}

/* ------------------------- the toast offers the undo --------------------- */

/*
 * A reversible destructive-feeling action with no way back in the moment sends
 * the user hunting for a section they have not been told about yet. The toast
 * is the only place that way back exists at the time it is wanted.
 */
{
  const pantry = readFileSync(join(here, '..', 'src', 'app', '(tabs)', 'pantry.tsx'), 'utf8');
  const handler = pantry.slice(
    pantry.indexOf('const onStopBuying = ('),
    pantry.indexOf('const onDelete'),
  );
  /*
   * Matched as an ARGUMENT to showToast, not merely as text somewhere in the
   * handler. The looser version passed a mutation that kept the label but
   * stopped passing it — which is exactly the shape a careless refactor takes,
   * and the one where the toast still says the right thing and does nothing.
   */
  check(
    'stopping offers an undo on the toast',
    /showToast\([\s\S]*?,\s*\{[\s\S]*?label: t\('common\.undo'\)/.test(handler),
    true,
  );
  check(
    '...and the undo does not restart the clock',
    /setStopped\(item\.key, false, \{ restartClock: false \}\)/.test(handler),
    true,
  );
}

/* ------------------------------------------------- the pantry item sheet -- */

/*
 * The sheet you reach by tapping a pantry row used to be settings only: a
 * toggle, some cadence chips, a link to history. It is opened FROM a row that
 * says "19 days left", and it owed the reader that fact and something to do
 * about it.
 */
{
  /*
   * Comments stripped before anything is matched.
   *
   * Both of the assertions below failed on their first run against correct
   * code: one counted `Date.now()` twice because the comment above it explains
   * why there is only one, and one missed a handler because a comment sits
   * between the close and the call. Matching prose is this repo's most
   * repeated guard bug, and the fix is always the same.
   */
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sheet = code(readFileSync(join(here, '..', 'src', 'components', 'staple-sheet.tsx'), 'utf8'));
  const pantry = code(readFileSync(join(here, '..', 'src', 'app', '(tabs)', 'pantry.tsx'), 'utf8'));
  const has = (re) => re.test(sheet);

  /*
   * THE STATE, BEFORE ANY SETTING ABOUT IT — and drawn with the ROW'S OWN
   * gauge. One instrument in two places is what stops the sheet disagreeing
   * with the row that opened it.
   */
  check('the sheet reports what the item is doing', has(/statusLabel\(item, now, t\)/), true);
  check('...on the same gauge the row draws', has(/<StockBar geo=\{geo\} \/>/), true);
  /*
   * One `now` for the whole sheet. Three Date.now() calls a millisecond apart
   * can straddle a day boundary and print a state that contradicts its own bar.
   */
  check('...against one clock reading', (sheet.match(/Date\.now\(\)/g) ?? []).length, 1);

  // THE THREE VERBS. All three existed; none was reachable from here.
  check('the sheet offers all three actions',
    has(/t\("staple\.actionBuy"\)/) && has(/t\("staple\.actionList"\)/) && has(/t\("staple\.actionUsed"\)/),
    true);
  /*
   * Wired to what the Pantry already does, and every one CLOSES the sheet —
   * each changes the reading on screen, so staying open would leave stale
   * numbers with nothing saying they had moved.
   */
  check('buying is logged through the store',
    /onAddPurchase=\{\(\) => \{[\s\S]{0,320}?logPurchase\(item\.display, item\.category\)/.test(pantry), true);
  check('...listing takes the same path as the swipe',
    /onAddToList=\{\(\) => \{[\s\S]{0,320}?onAddToList\(item\)/.test(pantry), true);
  check('...and using it up teaches the interval',
    /onMarkUsed=\{\(\) => \{[\s\S]{0,320}?markAlmostOut\(item\.key\)/.test(pantry), true);
  check('all three close the sheet first',
    (pantry.match(/setStapleKey\(null\);\s*(logPurchase|onAddToList\(item\)|markAlmostOut)/g) ?? []).length, 3);

  /*
   * The cadence footnote is behind a tap. It was permanent prose under controls
   * everybody uses, which is where prose goes to be unread.
   */
  check('the cadence note is behind a tap', has(/\{whyOpen && \(/), true);
  check('...with something to tap', has(/t\("staple\.whyThese"\)/), true);

  // The insights row, which replaced a bare "3 purchases" count.
  check('history leads with the rhythm', has(/t\("staple\.typicalCycle"\)/), true);
  check('...and the cycle in days', has(/t\("staple\.cycleDays", \{ count: learned \}\)/), true);
  /*
   * Below two intervals there is no rhythm to draw, and an empty frame reads as
   * a broken chart rather than as an item with no history yet.
   */
  check('the chart needs two gaps to draw', has(/intervals\.length >= 2 && \(\s*<IntervalChart/), true);
  /*
   * Bars are scaled to the LONGEST gap, not to the learned cycle: the question
   * is "how regular am I", and anchoring to the average flattens exactly the
   * variation worth seeing.
   */
  check('...scaled to the longest gap', has(/const longest = Math\.max\(\.\.\.days\)/), true);

  /*
   * A glyph, never a photograph. There is no image source in the app, and the
   * failure mode decides it: right for "Spinach", blank for the receipt-fed
   * names that make up much of a real pantry.
   */
  check('the header draws the item glyph', has(/<ItemEmoji name=\{item\.display\} category=\{item\.category\} size=\{38\}/), true);
  check('...and no photograph', /<Image|source=\{\{ uri/.test(sheet), false);

  /*
   * And no nutrition claims. "High in iron" is a regulated claim in the EU with
   * a legal threshold behind it; generating one from a model, about an item
   * somebody typed, is a compliance problem whose failure nobody would notice.
   */
  check('...and no nutrition claims',
    /high in iron|low calorie|rich in vitamins/i.test(sheet), false);

  /*
   * The storage tip comes from the SHARED dictionary, never from a call this
   * sheet makes. It is learned once for a term and free for every household
   * afterwards; a per-open request would be an AI call behind a tap that most
   * people make to change a cadence.
   */
  /*
   * THE SAME FACT, THREE TIMES.
   *
   * lastBoughtLabel returns a whole sentence — "Last bought a week ago" — and it
   * was under a LAST BOUGHT label, inside a card that also carried it in the
   * corner. Reads perfectly well in code; reads as a stutter on screen. The
   * short form exists so the mistake is a compile-time choice rather than a
   * thing to remember.
   */
  check('the boxed date uses the short form', has(/sinceBoughtLabel\(item\.lastPurchasedAt/), true);
  check('...and the sentence form is not in the sheet at all',
    /lastBoughtLabel\(/.test(sheet), false);

  /*
   * THE CARD CARRIES THE STATE. It was accent-tinted whatever the item was
   * doing, so an overdue mango sat in a calm green card with red text inside
   * it — the surface saying one thing and its contents another.
   */
  check('the freshness card is tinted by tone', has(/backgroundColor: tone\.soft/), true);
  check('...from the same tone the gauge uses', has(/toneOf\(geo\.tone, colors\)/), true);
  check('...and never a fixed accent tint', /styles\.fresh, \{ backgroundColor: colors\.accentSoft/.test(sheet), false);

  /*
   * The three verbs are buttons, not a legend. type.label is 11px/800,
   * letter-spaced and uppercase — three of those side by side read as shouting.
   */
  check('the actions are set as buttons, not labels',
    /actionText: \{ textAlign: 'center', fontSize: 13, fontWeight: '600' \}/.test(sheet), true);

  // Chosen means filled: tint-plus-border is the same weight as its neighbours
  // from a foot away, and this strip exists to answer "which one" at a glance.
  check('the chosen cadence chip is filled', has(/backgroundColor: active \? colors\.accent :/), true);

  /*
   * The text absorbs the slack, not the chart — the chart is the element that
   * is often absent, and flexing it left a hole when there was no rhythm to
   * draw.
   */
  check('the insights text takes the slack', has(/insightBody: \{ flex: 1, minWidth: 0 \}/), true);

  /*
   * SHRINKABLE, because React Native's default is not.
   *
   * On the web flexShrink defaults to 1; in React Native it defaults to 0, so a
   * fixed box beside flexible content does not give — it overflows. In German
   * the last-bought box ran off the right edge of the screen and took the
   * chevron with it. Shortening the text hides that; it does not fix it, and
   * the next language undoes the hiding.
   */
  check('the boxed date can shrink', has(/lastBuy: \{\s*flexShrink: 1,\s*minWidth: 0,/), true);
  check('...and its text can truncate', has(/lastBuyText: \{ flexShrink: 1, minWidth: 0 \}/), true);
  /*
   * And the chart steps aside on a narrow phone. It is the only element in that
   * row whose absence loses no fact — the cycle and the date are both still
   * there in words.
   */
  check('the chart yields on a narrow screen', has(/windowWidth >= 360 && intervals\.length >= 2/), true);

  check('the tip is read from the lexicon', has(/storageTipFor\(displayName\)/), true);
  /*
   * Absent is the ordinary case — most staples keep fine in a cupboard, and
   * "store in a cool dry place" on forty items is noise. Nothing renders rather
   * than a placeholder saying there is nothing.
   */
  check('...and nothing renders when there is none', has(/\{tip != null && \(/), true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
