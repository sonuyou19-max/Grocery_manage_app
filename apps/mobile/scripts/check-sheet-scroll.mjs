#!/usr/bin/env node
/**
 * A scrollable list may not be rendered inside a touchable.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * "I am still not able to scroll up and down the 'Your Staple'. It is stuck at
 * the same view. I can scroll in android though."
 *
 * The staples sheet had 56 rows in a frame that showed 16, so the ScrollView
 * was genuinely scrollable and genuinely refused to scroll — on iOS only. The
 * height arithmetic was fine; the touch never reached the scroll view.
 *
 * `Pressable` claims the JS responder on touch DOWN — `onStartShouldSetResponder`
 * is unconditionally true — and components/sheet.tsx wrapped every sheet's card
 * in TWO of them: one filling the window to catch a tap outside, one hugging the
 * card so a tap on it would not close the sheet. Both were ancestors of every
 * ScrollView in every sheet in the app.
 *
 * On Android the native ScrollView intercepts the following move, the responder
 * is terminated, and the drag becomes a scroll. On iOS the responder is already
 * held by an ancestor at the moment UIScrollView's pan would begin, so the pan
 * never starts. The finger moves, the list does not, and nothing is logged.
 *
 * The two sheets that predate that component — item-sheet and quick-add-sheet —
 * both scroll on iOS, and both put the tap-catcher UNDER the card as a sibling
 * rather than around it. That is now what Sheet does, and what this asserts.
 *
 * ---------------------------------------------------------------------------
 * Why the rule is stated this way
 * ---------------------------------------------------------------------------
 *
 * Not "sheet.tsx has no nested Pressables", which is the shape of the fix in
 * one file, and not a list of the sheets that must scroll, which is a list that
 * goes stale the next time somebody writes a sheet. The defect is a containment
 * relationship — a scroller with a touchable ancestor — and that is checkable
 * everywhere, including in files nobody has written yet.
 *
 * It found recipe-review-sheet.tsx, which had its own copy of the same two
 * wrapped Pressables and was never reported because its ingredient list is
 * usually short enough to fit.
 *
 * Run with `pnpm --filter mobile check:sheet-scroll`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');

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
 * that matches the PROSE about a rule rather than the rule — and the files this
 * reads explain the hazard at length, in comments that name both tags.
 *
 * Newlines are preserved so the line numbers in a failure are the real ones.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, '$1');

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.tsx')) files.push(full);
  }
})(SRC);

/* ================================================ 1. what counts as either == */

/**
 * Anything that takes the responder on touch down.
 *
 * PressScale and PrimaryButton are in here because they are Pressables with a
 * spring on them — the wrapper is not the point, the responder is.
 */
const TOUCHABLE = [
  'Pressable',
  'PressScale',
  'PrimaryButton',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
];

/** Anything that scrolls natively and therefore needs the touch to reach it. */
const SCROLLER = [
  'ScrollView',
  'Animated.ScrollView',
  'FlatList',
  'Animated.FlatList',
  'SectionList',
  'VirtualizedList',
];

/**
 * The JSX tags in a file, in source order, each with whether it opens, closes,
 * or does both.
 *
 * Written as a scanner rather than a regex per tag because SELF-CLOSING is the
 * whole question: `<Pressable … />` is a leaf and may sit anywhere, while
 * `<Pressable …>` opens a subtree that a ScrollView must not be in. Telling
 * them apart means finding the `>` that ends the tag, and a tag's props contain
 * braces, strings and arrow functions with `>` in them — so the scan tracks
 * brace depth and skips quoted text instead of taking the first `>` it sees.
 *
 * Only tags whose name begins with a capital letter are considered, and only
 * when the name is flush against the `<`. `a < B` is a comparison; `<B` is a
 * component. That is what keeps arithmetic out of the tag stream.
 */
function tags(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '<') continue;
    const closing = text[i + 1] === '/';
    let j = i + (closing ? 2 : 1);
    const start = j;
    while (j < text.length && /[A-Za-z0-9_.]/.test(text[j])) j += 1;
    const name = text.slice(start, j);
    if (!name || !/^[A-Z]/.test(name)) continue;

    if (closing) {
      out.push({ name, opens: false, closes: true, at: i });
      i = j;
      continue;
    }

    // Forward to the `>` that ends this tag, ignoring any inside props.
    let depth = 0;
    let quote = null;
    let end = -1;
    for (; j < text.length; j += 1) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const selfClosing = text[end - 1] === '/';
    out.push({ name, opens: !selfClosing, closes: false, at: i });
    i = end;
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* =========================== 2. a touchable ancestor crosses files ========= */

/*
 * The bug that started this is INVISIBLE to a per-file containment check, and
 * finding that out is the reason this section exists.
 *
 * The staples sheet is `<OverflowSheet><ScrollView>…`, and there is no Pressable
 * anywhere near it. The Pressables were in components/sheet.tsx, wrapped around
 * `{children}` — so from the ScrollView's point of view they are ancestors at
 * runtime and nowhere at all in the source. Run against the pre-fix tree, a
 * per-file scan reported one offender (recipe-review-sheet, which happened to
 * have its own copy) and cleanly missed the one that was reported by a user.
 *
 * So a component that renders `{children}` inside a touchable IS a touchable, to
 * everyone who uses it. That is computed here rather than listed, and to a
 * fixpoint, because a wrapper around such a component inherits the same
 * property — which is exactly how `Sheet` and its eleven call sites relate.
 */
const sources = files.map((file) => {
  const text = code(readFileSync(file, 'utf8'));
  return { file, text, tags: tags(text) };
});

/** Where each component in a file begins, so a slot can be attributed to one. */
function componentsIn(text) {
  const found = [];
  const re = /(?:export\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*=)/g;
  for (const m of text.matchAll(re)) found.push({ name: m[1] ?? m[2], at: m.index });
  return found;
}

/** `{children}` and the handful of ways it is spelled. */
const SLOT = /\{\s*(?:children|props\.children)\s*\}/g;

const derived = new Set();
for (let round = 0; round < 8; round += 1) {
  const before = derived.size;
  for (const { text, tags: stream } of sources) {
    const isTouchable = (n) => TOUCHABLE.includes(n) || derived.has(n);
    const events = stream
      .filter((tg) => isTouchable(tg.name))
      .map((tg) => ({ at: tg.at, open: tg.opens, close: tg.closes }));
    const slots = [...text.matchAll(SLOT)].map((m) => ({ at: m.index, slot: true }));
    if (slots.length === 0) continue;

    const parts = componentsIn(text);
    let depth = 0;
    for (const e of [...events, ...slots].sort((a, b) => a.at - b.at)) {
      if (e.slot) {
        if (depth === 0) continue;
        const owner = parts.filter((p) => p.at < e.at).pop();
        if (owner) derived.add(owner.name);
        continue;
      }
      if (e.open) depth += 1;
      else if (e.close && depth > 0) depth -= 1;
    }
  }
  if (derived.size === before) break;
}

/*
 * Only the touchables are tracked, not the whole element tree. Knowing when a
 * Pressable closes needs its own opens and closes and nothing else, and a stack
 * of every View in the app is a stack that mismatches on the first conditional
 * fragment and then reports nonsense.
 */
const offenders = [];
let scanned = 0;
let scrollersSeen = 0;
let touchablesSeen = 0;

for (const { file, text, tags: stream } of sources) {
  const stack = [];
  scanned += 1;
  for (const tag of stream) {
    if (TOUCHABLE.includes(tag.name) || derived.has(tag.name)) {
      if (tag.opens) {
        touchablesSeen += 1;
        stack.push(tag);
      } else if (tag.closes && stack.length > 0) stack.pop();
      continue;
    }
    if (!SCROLLER.includes(tag.name) || !tag.opens) continue;
    scrollersSeen += 1;
    if (stack.length === 0) continue;
    offenders.push({
      file: relative(ROOT, file),
      line: lineOf(text, tag.at),
      scroller: tag.name,
      touchable: stack[stack.length - 1].name,
      touchableLine: lineOf(text, stack[stack.length - 1].at),
    });
  }
}

/*
 * The scanner has to have found something, or the assertion below is a pass by
 * blindness — a rename of ScrollView, a change to how tags are written, or a
 * broken walk would each leave nothing to check and nothing to say so.
 */
assert(
  'the scan reaches the screens it is about',
  scanned > 50 && scrollersSeen >= 10 && touchablesSeen >= 50,
  [
    `${scanned} .tsx files, ${scrollersSeen} scrollers, ${touchablesSeen} touchables`,
    'Too few to be the real tree — the walk or the tag scanner has stopped working.',
  ],
);

assert(
  'no scroller is rendered inside a touchable',
  offenders.length === 0,
  offenders
    .map(
      (o) =>
        `${o.file}:${o.line} <${o.scroller}> is inside <${o.touchable}> opened at line ${o.touchableLine}`,
    )
    .concat([
      'The touchable takes the responder on touch down and iOS never starts the',
      'scroll. Put the tap target BESIDE the scroller — an absolutely filled',
      'Pressable under the card — not around it. See components/sheet.tsx.',
    ]),
);

/* ============================ 3. and the sheet keeps its tap-to-dismiss ==== */

/*
 * Deleting the outer Pressable would satisfy §2 completely and leave every
 * sheet in the app impossible to dismiss by tapping outside it, which is the
 * cheapest possible way to pass this file. So the catcher has to still be
 * there, still be full-bleed, and still close the sheet.
 */
const sheet = code(readFileSync(join(SRC, 'components', 'sheet.tsx'), 'utf8'));
const catcher = /<Pressable\s+style=\{StyleSheet\.absoluteFill\}\s+onPress=\{onClose\}\s*\/>/.test(
  sheet,
);
assert(
  'Sheet still closes on a tap outside the card',
  catcher,
  ['No full-bleed <Pressable onPress={onClose} /> in components/sheet.tsx.'],
);

/*
 * And the layers that lay the card out must be transparent to touches, or that
 * catcher is covered by the very views that replaced the Pressables: a tap in
 * the gutter would hit a plain View, claim nothing, and do nothing.
 *
 * Counted rather than located, because both the alignment layer and the card
 * wrapper need it and one of the two being right is the failure mode.
 */
const boxNone = [...sheet.matchAll(/pointerEvents="box-none"/g)].length;
assert(
  'the layers between the catcher and the card pass touches through',
  boxNone >= 2,
  [
    `found ${boxNone} box-none layers, expected the alignment layer and the card wrapper`,
    'Without it a tap outside the card lands on a View that closes nothing.',
  ],
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
