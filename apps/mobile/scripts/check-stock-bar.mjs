/**
 * Stock-bar check — the gauge on every pantry row.
 *
 * Two halves, and they guard different failure modes.
 *
 * The GEOMETRY half runs stockGeometry against a table. Its job is the thing
 * the old bar got wrong: an item past its interval must keep reporting how far
 * past, and an item with no history must report nothing at all rather than
 * reporting "full". Both are silent in the UI — a wrong bar still draws — so
 * arithmetic is the only place they can be caught.
 *
 * The DRAWING half reads the component's source, because the properties that
 * make this a scale rather than a decoration are structural and cannot be
 * observed from the outside: that the gradient is sized against the track and
 * not against the fill, that the marker is drawn separately from it, and that
 * the notch's position comes from the same constant the geometry divides by.
 * Break any of those and it still renders a pretty striped bar that means
 * nothing.
 *
 * Run with `pnpm --filter mobile check:stock-bar`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

const source = read('src', 'lib', 'pantry-intel.ts').replace(
  /^import\s[^;]*?from '@korb\/shared';/gm,
  '',
);
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

/**
 * Comments are stripped before any source assertion. Every one of these files
 * explains itself at length, and three separate guards in this repo have
 * already passed against prose describing the thing rather than the thing —
 * including one that matched a phrase inside the very doc comment warning about
 * it.
 */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 22);

// Category default for dairy_eggs is 7 days, so one interval is one week.
const stat = (over = {}) => ({
  key: 'milk',
  display: 'Milk',
  category: 'dairy_eggs',
  lastPurchasedAt: now - 3 * DAY,
  intervalDays: 0,
  sampleCount: 0,
  snoozeUntil: null,
  ...over,
});

const geo = (over) => mod.stockGeometry(stat(over), now);

/* ------------------------------------------------------------- the scale */

check('the track spans one and a half intervals', mod.OVERDUE_ROOM, 0.5);
check('due sits two thirds along it', Math.round(mod.DUE_MARK * 1000) / 1000, 0.667);

/* --------------------------------------------------------- the readings */

// Just bought: at the left end, nothing elapsed, comfortable.
check('just bought sits at the start', geo({ lastPurchasedAt: now }), {
  tone: 'ok',
  position: 0,
  elapsed: 0,
  overdue: false,
});

// Half an interval gone → half of 1.5 along the track.
check(
  'half an interval is a third along',
  Math.round(geo({ lastPurchasedAt: now - 3.5 * DAY }).position * 1000) / 1000,
  0.333,
);

// Exactly due: on the notch, and flagged.
{
  const g = geo({ lastPurchasedAt: now - 7 * DAY });
  check('due lands exactly on the notch', Math.round(g.position * 1000) / 1000, 0.667);
  check('...and says so', g.overdue, true);
}

/*
 * THE REASON THIS COMPONENT EXISTS.
 *
 * lifeRemaining clamps at zero, so it answers 0 for both of these and a bar
 * drawn from it is empty for both. One is a day late; the other has been gone
 * for a week and a half. If these two ever report the same position again, the
 * gauge has been quietly turned back into a progress bar.
 */
{
  const barelyLate = geo({ lastPurchasedAt: now - 8 * DAY });
  const longGone = geo({ lastPurchasedAt: now - 17.5 * DAY });
  check('a day over still moves', Math.round(barelyLate.position * 1000) / 1000, 0.762);
  check('...and being much later reads differently', longGone.position > barelyLate.position, true);
  check('lifeRemaining cannot tell them apart', [
    mod.lifeRemaining(stat({ lastPurchasedAt: now - 8 * DAY }), now),
    mod.lifeRemaining(stat({ lastPurchasedAt: now - 17.5 * DAY }), now),
  ], [0, 0]);
}

// Past the end of the track it pins rather than running off.
check(
  'far overdue pins at the end',
  geo({ lastPurchasedAt: now - 90 * DAY }).position,
  1,
);

// A future timestamp — a misread receipt, a wrong phone clock — must not push
// the marker off the left.
check(
  'a future purchase does not go negative',
  geo({ lastPurchasedAt: now + 5 * DAY }).position,
  0,
);

/* ------------------------------------------------------ the learning case */

check('no history reports no reading at all', geo({ lastPurchasedAt: 0 }), {
  tone: 'learning',
  position: null,
  elapsed: null,
  overdue: false,
});
check(
  'and lifeRemaining still says "full", which is why position is null',
  mod.lifeRemaining(stat({ lastPurchasedAt: 0 }), now),
  1,
);

/* ------------------------------------------------------------ the tones */

// The boundaries the section headings and the recipe importer also use, so the
// bar's colour and the "Running low" section cannot disagree.
check('comfortable', geo({ lastPurchasedAt: now - 3 * DAY }).tone, 'ok');
check('past LOW_THRESHOLD is low', geo({ lastPurchasedAt: now - 5 * DAY }).tone, 'low');
check('past CRIT_THRESHOLD is critical', geo({ lastPurchasedAt: now - 6.5 * DAY }).tone, 'crit');
check(
  'the low boundary is the one the pantry sections use',
  mod.LOW_THRESHOLD,
  0.35,
);

/* ----------------------------------------------------------- the drawing */

const bar = codeOnly(read('src', 'components', 'stock-bar.tsx'));

/*
 * The gradient must be sized as a multiple of the CLIP, not left at 100%.
 * At 100% it stretches to whatever the fill happens to be, which is the
 * decorative version — green-to-red on every row regardless of value, amber
 * landing at a different real reading each time.
 */
check(
  'the gradient is sized against the track, not the fill',
  /style=\{\[styles\.scale,\s*\{\s*width:\s*`\$\{100\s*\/\s*p\}%`/.test(bar),
  true,
);
check(
  'and the clip carries the reading',
  /styles\.clip,\s*\{\s*width:\s*`\$\{p\s*\*\s*100\}%`/.test(bar),
  true,
);
check('the clip actually clips', /clip:\s*\{[^}]*overflow:\s*'hidden'/.test(bar), true);

// The notch's position and the geometry's divisor are the same number. Two
// literals would drift and the notch would stop meaning "due".
check('the notch reads DUE_MARK', /styles\.tick,\s*\{\s*left:\s*`\$\{DUE_MARK\s*\*\s*100\}%`/.test(bar), true);
check('...imported rather than re-typed', /import\s*\{[^}]*\bDUE_MARK\b[^}]*\}\s*from '@\/lib\/pantry-intel'/.test(bar), true);

// The marker is a separate element from the fill. Without it the fill's leading
// edge is the only reading, which is a progress bar again.
check('there is a marker', /styles\.marker/.test(bar), true);
check(
  'the marker is outlined so it survives sitting on its own colour',
  /borderColor:\s*colors\.surface/.test(bar),
  true,
);

// Learning draws no marker and no fill. Guarded by structure: the early return
// must come before `p` exists.
{
  const early = bar.indexOf('geo.position == null');
  const p = bar.indexOf('const p =');
  check('the learning case returns before any fill is computed', early > 0 && early < p, true);
}

/*
 * Nothing on this component may animate. Forty rows of a list all easing at
 * once is not a flourish, and the value moves on the scale of days.
 */
check(
  'the bar does not animate',
  /reanimated|withTiming|withRepeat|Animated\./.test(bar),
  false,
);

/* ---------------------------------------------------------------- the row */

const row = codeOnly(read('src', 'app', '(tabs)', 'pantry.tsx'));

check('the row draws the bar', /<StockBar geo=\{geo\} \/>/.test(row), true);
check(
  'the old fixed-width stock column is gone',
  /styles\.stock|styles\.fill\b/.test(row),
  false,
);

// The history button must be gated exactly as the settings sheet's row is.
// Ungated it is a paid feature given away from the busiest screen in the app.
{
  const handler = row.slice(row.indexOf('onOpenHistory={'), row.indexOf('onOpenHistory={') + 260);
  check('the ledger button exists', handler.length > 20, true);
  check('...and asks the plus gate first', /if \(locked\) requirePlus\(\);/.test(handler), true);
  check('...before opening anything', /else setLedgerFor\(/.test(handler), true);
}

// Hidden, not disabled, when there is nothing to show.
check('the button is hidden when there is no history', /\{hasHistory && \(/.test(row), true);
check(
  'and "has history" is a set lookup, not a scan per row',
  /hasHistory=\{logged\.has\(item\.key\)\}/.test(row),
  true,
);
check(
  'built once for the screen',
  /const logged = useMemo\(\(\) => new Set\(purchases\.map\(\(p\) => p\.key\)\), \[purchases\]\)/.test(row),
  true,
);

// Every string on the row goes through t(). The label names the item, so a
// screen reader on a list of forty identical icons can tell them apart.
check(
  'the button has an accessible name naming the item',
  /accessibilityLabel=\{t\('pantry\.historyFor', \{ item: item\.display \}\)\}/.test(row),
  true,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
