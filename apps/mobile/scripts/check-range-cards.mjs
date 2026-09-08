#!/usr/bin/env node
/**
 * A card must not be hidden by its own filter.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * Pick "Last 7 days" on the climate card in a week with no shopping and the
 * whole card disappeared. The range picker lives ON the card, so it went too —
 * leaving nothing on screen about climate and no way back to a window with data
 * in it. The reader's own filter had removed the only control that could undo
 * it.
 *
 * The line was `{eco.score != null && <EcoCard range={ecoRange} … />}`, which
 * reads as the sensible "don't draw an empty card". The fault is invisible at
 * the call site: `eco` is derived from `ecoRange`, so the card's EXISTENCE and
 * the card's CONTENTS were answering the same question.
 *
 * Two of the four range cards on this tab already had the fix — mount on what
 * the household has ever logged, say "nothing in this window" inside — and two
 * did not. Nothing recorded which, and nothing would have noticed a third
 * getting it wrong.
 *
 * ---------------------------------------------------------------------------
 * What is asserted, and why it is not "every card has an empty state"
 * ---------------------------------------------------------------------------
 *
 * The property is narrower and checkable: NOTHING DERIVED FROM A RANGE MAY
 * DECIDE WHETHER A CARD EXISTS.
 *
 * So this reads the ranges out of the screen, follows them through the useMemo
 * dependency arrays to every value computed from them, and then asserts none of
 * those names appears in a mount condition. That is the actual defect, stated
 * once, and it holds for cards nobody has written yet.
 *
 * Run with `pnpm --filter mobile check:range-cards`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, lines = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of lines) console.log(`  ${line}`);
};
const assert = (what, cond, lines) => (cond ? ok(what) : fail(what, lines));

/*
 * Comments stripped first. This repo's most repeated guard bug is an assertion
 * that matches the PROSE about a rule rather than the rule — and both files
 * here explain this one at length, including by quoting the broken line.
 */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const screen = code(readFileSync(join(SRC, 'app', '(tabs)', 'insights.tsx'), 'utf8'));
const card = code(readFileSync(join(SRC, 'components', 'range-card.tsx'), 'utf8'));

/* ============================ 1. the ranges, and what is derived from them = */

/*
 * Every `const xRange = useState<Range>(…)`. Read rather than listed, so a
 * fifth range added tomorrow is covered without anyone remembering this file.
 */
const ranges = [...screen.matchAll(/const \[(\w+), set\w+\] = useState<Range>/g)].map(
  (m) => m[1],
);

assert(
  'the screen still declares its ranges as useState<Range>',
  ranges.length >= 4,
  [`found ${ranges.length}: ${ranges.join(', ') || 'none'} — the pattern this file reads has changed`],
);

/*
 * Every `const x = useMemo(…)` on the screen, paired with its dependency array.
 *
 * The call is found by COUNTING PARENTHESES, not by a regex for its closing
 * line. The first version ended on `\n  );`, which is how a short useMemo is
 * formatted and is not how a long one is — a body with a block in it closes
 * `}, [deps]);` instead, and every one of those was invisible.
 *
 * That is not a stylistic miss. `staples` is written the second way, so the
 * staples card — one of the two that had the bug — was never checked, and
 * putting the fault back into it fired nothing. Found by mutation, on the
 * assertion this whole file exists for.
 */
const memos = [];
for (const m of screen.matchAll(/const (\w+) = useMemo\(/g)) {
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < screen.length; i += 1) {
    if (screen[i] === '(') depth += 1;
    else if (screen[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const call = screen.slice(m.index, i);
  // The dependency array is the last bracketed group in the call.
  const deps = call.slice(call.lastIndexOf('['));
  memos.push({ name: m[1], deps });
}

assert(
  'both useMemo spellings are read, not just the short one',
  memos.length >= 10 && memos.some(({ name }) => name === 'staples'),
  [
    `found ${memos.length} useMemo calls: ${memos.map((x) => x.name).join(', ')}`,
    '`staples` closes with `}, [deps]);` rather than on its own line, and a',
    'matcher that misses that shape misses one of the two cards that had the bug.',
  ],
);

/*
 * Anything computed FROM a range, then anything computed from THOSE — two hops,
 * because that is where the reported bug sat: `eco` came from `ecoScoped`,
 * which came from `ecoRange`, and it was `eco.score` that hid the card.
 *
 * Repeated to a fixed point rather than twice, so a third hop cannot open the
 * same hole a second time.
 */
const scoped = new Set();
for (let changed = true; changed; ) {
  changed = false;
  for (const { name, deps } of memos) {
    if (scoped.has(name)) continue;
    const sources = [...ranges, ...scoped];
    if (sources.some((src) => new RegExp(`\\b${src}\\b`).test(deps))) {
      scoped.add(name);
      changed = true;
    }
  }
}

assert(
  'range-derived values are traceable from the ranges',
  scoped.size > 0,
  ['Nothing was found to depend on any range, so the check below tests nothing.'],
);

/* ======================== 2. none of them decides whether a card exists ==== */

/*
 * A mount condition: the `{ … && (` or `{ … ? (` that immediately precedes a
 * card element. Only these three open one on this screen.
 */
const CARD = /\{([^{}]{0,200}?)&&\s*\(\s*\n?\s*<(Card|RangeCard|EcoCard)\b/g;
const SELF_HIDDEN = [];
for (const m of screen.matchAll(CARD)) {
  const [, condition, element] = m;
  for (const name of scoped) {
    // `\b` alone would match `staples` inside `staplesShown`; the boundary has
    // to allow a property access (`eco.score`) and nothing else.
    if (new RegExp(`\\b${name}\\b(?!\\w)`).test(condition)) {
      SELF_HIDDEN.push(`<${element}> is mounted on \`${condition.trim()}\` — \`${name}\` is derived from a range`);
    }
  }
}

assert(
  'no card is hidden by a value derived from its own range',
  SELF_HIDDEN.length === 0,
  [
    ...SELF_HIDDEN,
    '',
    'A card that owns a range picker and is mounted on a range-scoped value',
    'removes its own control the moment the window comes up empty, and there is',
    'then no way back to a window with data in it.',
    '',
    'Mount on what the household has EVER logged (the unfiltered set) and pass',
    'the empty window to `empty` instead — see components/range-card.tsx.',
  ],
);

/* ================================== 3. the shared card keeps the contract == */

assert(
  'RangeCard hides itself only on `ever`',
  /if \(!ever\) return null;/.test(card) && !/if \(!?empty\) return null/.test(card),
  ['`empty` describes the window and must never remove the card or its picker.'],
);
assert(
  '...and says so when the window is empty',
  /empty \?/.test(card) && /insights\.noneInRange/.test(card),
);
assert(
  '...with the picker outside the part that swaps',
  card.indexOf('<RangePicker') < card.indexOf('empty ?'),
  ['Drawn after the empty branch it would be inside it, and vanish with it.'],
);

/*
 * EcoCard is the one range card that is not a RangeCard — its header carries an
 * (i) that opens the methodology — so it has to honour the rule by hand, and
 * that is precisely the card the bug was reported on.
 */
const eco = screen.slice(screen.indexOf('function EcoCard('));
assert(
  'EcoCard hides itself only on `ever`',
  /if \(!ever\) return null;/.test(eco),
  ['It is the one card holding a range picker that is not a <RangeCard>.'],
);
assert(
  '...and treats an unscoreable window as a message, not an absence',
  /const emptyWindow = eco\.score == null;/.test(eco) && /\{emptyWindow \?/.test(eco),
);

/* ============================ 4. every picker sits on a card that can stay = */

/*
 * A RangePicker anywhere other than these two files is a new card that has not
 * been through the rule above. Enumerated rather than pattern-matched: the
 * point is that adding one is a decision somebody makes on purpose.
 */
const OWNERS = [
  'components/range-card.tsx',
  'app/(tabs)/insights.tsx',
  // A full screen rather than a card, so it cannot vanish — but it holds a
  // range picker and an empty window, so the same rule applies and is asserted
  // for it below. Being on this list is not a pass.
  'app/climate.tsx',
];

const { readdirSync } = await import('node:fs');
const files = (function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? collect(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
})(SRC);

const strays = files
  .map((f) => f.slice(SRC.length + 1).split('\\').join('/'))
  .filter(
    (rel) =>
      rel !== 'components/range-picker.tsx' &&
      !OWNERS.includes(rel) &&
      /<RangePicker/.test(code(readFileSync(join(SRC, rel), 'utf8'))),
  );

assert(
  `only the ${OWNERS.length} known owners draw a RangePicker`,
  strays.length === 0,
  [
    ...strays.map((f) => `  ${f}`),
    '',
    'A new range control is a new card that can empty itself. Use RangeCard, or',
    'add the file here once it honours the `ever` / `empty` split by hand.',
  ],
);

/*
 * The climate screen honours the rule by hand: the picker is drawn ABOVE the
 * branch that swaps the body for an empty state, so an empty window loses the
 * list and keeps the control. Asserted by position, because "it happens to be
 * written first" is exactly the kind of thing a tidy-up reorders.
 */
const climate = code(readFileSync(join(SRC, 'app', 'climate.tsx'), 'utf8'));
const picker = climate.indexOf('<RangePicker');
const branch = climate.indexOf('eco.score == null ?');
assert(
  'the climate screen keeps its picker outside the empty branch',
  picker > 0 && branch > 0 && picker < branch,
  [
    picker < 0 ? 'no RangePicker found' : '',
    branch < 0 ? 'no empty branch found' : '',
    'Drawn inside the branch, an empty window would take the control with it —',
    'the same fault as the card, on a screen where it is harder to escape.',
  ].filter(Boolean),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
