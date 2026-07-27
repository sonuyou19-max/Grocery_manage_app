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

const source = readFileSync(SRC, 'utf8').replace(/^import .*from '@korb\/shared';$/gm, '');
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
check('isResting reads the timestamp', mod.isResting(asleep), true);
check('an active item is not resting', mod.isResting(stat()), false);
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

const rested = mod.applyResting({ milk: stat() }, 'milk', true, now);
check('resting stamps the moment', rested.milk.archivedAt, now);
check('resting keeps the learned rate', rested.milk.intervalDays, stat().intervalDays);

// Waking restarts the countdown rather than resuming an ancient one, so a
// long-asleep item doesn't shout on the first Vibe Check after it comes back.
const woken = mod.applyResting({ milk: asleep }, 'milk', false, now);
check('waking clears the timestamp', woken.milk.archivedAt, null);
check('waking restarts the clock', woken.milk.lastPurchasedAt, now);
check('waking clears any snooze', woken.milk.snoozeUntil, null);
check('a woken item is not immediately due', mod.isDue(woken.milk, now), false);
check('waking keeps the learned rate', woken.milk.intervalDays, asleep.intervalDays);
check('waking keeps the sample count', woken.milk.sampleCount, asleep.sampleCount);
check('resting an unknown key is a no-op', mod.applyResting({}, 'nope', true, now), {});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
