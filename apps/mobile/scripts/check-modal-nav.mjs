/**
 * Navigating out of a <Modal> has to wait for the Modal.
 *
 * On Android a react-native <Modal> is its own native window. Push a route while
 * one is up and the navigation lands underneath it — the user gets a blank
 * screen with no way back. It is not a rare edge: it has shipped FOUR times, in
 * four unrelated features, written weeks apart — and the fourth is the reason
 * this file no longer trusts InteractionManager as a fix.
 *
 *   recipe.tsx confirmed an import and navigated in the same commit that
 *   unmounted the review sheet. First occurrence.
 *
 *   create-sheet.tsx called onClose() and pushed on the next line. Correct for
 *   as long as closing was synchronous, and a crash the moment the sheet grew a
 *   160ms exit animation. Nobody touched the navigation; it broke anyway.
 *
 *   pantry.tsx opened the paywall from inside the staple sheet without closing
 *   it. The unlocked branch DID close first, with a comment explaining why —
 *   which is the clearest evidence available that knowing about the hazard is
 *   not sufficient to avoid it.
 *
 *   recipe.tsx again. The FIX for the first occurrence used
 *   `InteractionManager.runAfterInteractions` to wait out the review sheet's
 *   dismissal, and it shipped, and it did not work: RN's built-in <Modal>
 *   animation is native-driven and registers no interaction handle, so the
 *   callback could fire on the very next frame — before the native window
 *   had gone anywhere. The bug report was identical to the first: a blank
 *   cover, gone the instant you tap Back because the screen underneath was
 *   correct the whole time. The real fix moved the animation itself into JS
 *   (RecipeReviewSheet now drives its own fade with reanimated, exactly like
 *   create-sheet.tsx) so `useDeferUntilClosed` has something true to wait on.
 *
 * So the ordering gets a guard instead of a convention. lib/modal-nav.ts holds
 * the one implementation; this asserts the files that need it still use it —
 * and, after the fourth occurrence, that nothing has quietly gone back to
 * InteractionManager or a bare timer to get there.
 *
 * An allowlist rather than a pattern match, for the same reason check-plus-gate
 * uses one: the failure to catch is a call site QUIETLY LOSING the deferral
 * during an unrelated refactor, and anything inferred from the file's own
 * contents stops looking at exactly that moment. A new modal that navigates
 * belongs on this list — add it when you write it.
 *
 * Run with `pnpm --filter mobile check:modal-nav`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** The one place the deferral is implemented. */
const OWNER = 'lib/modal-nav.ts';

/** The shared dialog that applies the deferral for everything inside it. */
const SHEET = 'components/sheet.tsx';

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};

/** Every .ts/.tsx under src, as paths relative to it. */
const walk = (dir, base = dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else if (/\.tsx?$/.test(name)) out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
};

const read = (rel) => {
  try {
    return readFileSync(join(SRC, rel), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Source with comments removed.
 *
 * Needed because the first version of this file failed on modal-nav.ts's own
 * documentation, which names `setTimeout(nav, 300)` as the wrong approach. A
 * check that reads prose as code is the same defect in reverse as a check a
 * comment can satisfy — and this repo has now produced one of each.
 */
const code = (text) =>
  text == null ? null : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------------------- 1. the helper still exists */

const owner = read(OWNER);
if (!owner || !/export function useDeferUntilClosed/.test(owner)) {
  fail('lib/modal-nav.ts must export useDeferUntilClosed', [
    'Every site below depends on it. If it moved, move this check with it.',
  ]);
} else {
  console.log('ok   useDeferUntilClosed is where the call sites expect it');
}

/*
 * The helper must key on a caller-supplied flag, not on a timer. A setTimeout
 * would pass every other assertion here while re-encoding the exact guess —
 * "a dismissal takes about this long" — that broke create-sheet.tsx when its
 * animation duration changed.
 */
if (owner && /setTimeout/.test(code(owner))) {
  fail('the deferral must not be time-based', [
    'lib/modal-nav.ts contains setTimeout. Waiting a fixed number of milliseconds',
    'guesses at the dismissal duration; the whole point is to observe it instead.',
  ]);
} else if (owner) {
  console.log('ok   the deferral observes the close rather than timing it');
}

/* --------------------------- 2. every navigating modal defers, found not listed */

/*
 * This used to be a hand-maintained list of files known to navigate from inside
 * a Modal. It passed for months while components/household-switcher.tsx did
 * exactly the forbidden thing — `setOpen(false)` then `router.push(...)` on the
 * next line — because nobody had added it. A list of known offenders cannot
 * catch the one you did not know about, which is the only kind that ships.
 *
 * So the files are found instead of named. A file owning a raw <Modal> AND
 * navigating out of it must defer; going through <Sheet> satisfies that by
 * construction, since the only way out of a Sheet is dismiss(action).
 */
const NAVIGATES = /\brouter\.(push|replace|back|navigate)\s*\(|\brequirePlus\s*\(/;

/**
 * The JSX inside each <Modal>…</Modal>, so navigation ELSEWHERE in the file
 * does not read as navigation from inside the dialog.
 *
 * The first version compared at file level and flagged settings.tsx, which
 * presents the locale chooser in a full-screen Modal and separately pushes
 * routes from the settings list below it. A guard that cries wolf on correct
 * code gets switched off, so it has to be able to tell where the call is.
 *
 * KNOWN LIMIT: this sees navigation written in the Modal's own JSX, not
 * navigation inside a child component the Modal renders. All four historical
 * bugs were the former — an onPress written inline — so it catches the shape
 * that has actually shipped. The latter is covered from the other direction:
 * a child of a <Sheet> can only leave via dismiss(), which always waits.
 */
const modalRegions = (text) => {
  const out = [];
  let i = 0;
  for (;;) {
    const start = text.indexOf('<Modal', i);
    if (start === -1) break;
    const end = text.indexOf('</Modal>', start);
    out.push(text.slice(start, end === -1 ? text.length : end));
    i = end === -1 ? text.length : end + 8;
  }
  return out;
};

const offenders = [];
for (const rel of walk(SRC)) {
  if (rel === OWNER || rel === SHEET) continue;
  const text = code(read(rel));
  if (!text) continue;
  // Raw <Modal> only: a <Sheet> already carries the deferral.
  if (/useDeferUntilClosed|useSheetDismiss/.test(text)) continue;
  if (modalRegions(text).some((region) => NAVIGATES.test(region))) offenders.push(rel);
}

if (offenders.length) {
  fail('a modal navigates without waiting for its own window to close', [
    ...offenders.map((rel) => `  ${rel}`),
    'On Android a <Modal> is its own native window, so a route pushed while it',
    'is up lands UNDERNEATH it and the user gets a blank screen. Either render',
    `the dialog with <Sheet> (${SHEET}) and leave via dismiss(action), or call`,
    'useDeferUntilClosed keyed on the Modal\'s real visibility.',
  ]);
} else {
  console.log('ok   no modal navigates before its window is gone');
}

/* ------------------------- 2b. a transparent modal drives its own animation */

/*
 * RN's `animationType` cross-fades or slides the whole native window, which
 * cannot be coordinated with anything drawn inside it and looks nothing like
 * the rest of the app. Every dialog now scales out of the screen edge via
 * <Sheet>, so a transparent Modal must sit at "none".
 *
 * Full-screen (non-transparent) modals are exempt: settings presents the locale
 * chooser as a screen, where a native slide is exactly right.
 */
const stock = [];
for (const rel of walk(SRC)) {
  if (rel === SHEET) continue;
  const text = code(read(rel));
  if (!text) continue;
  for (const m of text.matchAll(/<Modal\b([^>]*)>/g)) {
    const props = m[1];
    if (!/\btransparent\b/.test(props)) continue;
    if (!/animationType=["']none["']/.test(props)) stock.push(rel);
  }
}

if (stock.length) {
  fail('a transparent modal uses React Native\'s own animation', [
    ...[...new Set(stock)].map((rel) => `  ${rel}`),
    'animationType fades or slides the native window, which cannot be timed',
    'against anything drawn inside it. Use <Sheet>, or set animationType="none"',
    'and drive the motion with Reanimated as item-sheet and quick-add-sheet do.',
  ]);
} else {
  console.log('ok   every transparent modal drives its own animation');
}

/* ------------------- 3. nobody trusts InteractionManager for this again */

/*
 * The exact mechanism that looked like a fix for occurrence #1 and was not:
 * it waits for JS "interactions" (gestures, explicit handles), and a native
 * Modal's own animation registers none. Its presence ANYWHERE in the modal
 * story is a sign someone is reaching for the thing that already failed here
 * once, so this fails loud rather than trusting a call site to remember why.
 */
const suspects = [...walk(SRC).filter((rel) => /<Modal\b/.test(read(rel) ?? '')), 'app/recipe.tsx'];
const reachedForIt = suspects.filter((rel) => {
  const text = read(rel);
  return text && /InteractionManager/.test(code(text));
});
if (reachedForIt.length) {
  fail('InteractionManager does not wait for a native Modal to close', [
    ...reachedForIt.map((rel) => `${rel} references InteractionManager.`),
    'It registers no handle for a native Modal animation and can fire before',
    'the window is actually gone — that shipped once already. Use',
    'useDeferUntilClosed, keyed on a boolean YOU flip once your own JS-driven',
    'exit animation has finished (see recipe-review-sheet.tsx).',
  ]);
} else {
  console.log('ok   nothing reaches for InteractionManager to wait out a Modal');
}

/*
 * recipe.tsx must not navigate straight out of its own onConfirm. The confirm
 * handler's job is to write the data and remember WHERE to go; only the
 * review sheet's `onDismissed` callback may actually call router.* — pinned
 * by name since "somewhere in this file, eventually" is exactly the gap the
 * first three occurrences of this bug all lived in.
 */
const recipe = read('app/recipe.tsx');
if (!recipe || !/onDismissed=\{onReviewDismissed\}/.test(recipe)) {
  fail('recipe.tsx must navigate from RecipeReviewSheet\'s onDismissed, not onConfirm', [
    'Look for `onDismissed={onReviewDismissed}` on the <RecipeReviewSheet /> element.',
    'Confirming a write and leaving the screen are two different moments; conflating',
    'them is the original blank-screen bug, however it is currently spelled.',
  ]);
} else {
  console.log('ok   recipe.tsx navigates from onDismissed, not from confirm');
}

/*
 * And the sheet has to actually offer that callback and fire it — a
 * `RecipeReviewSheet` that stopped calling `onDismissed` would make the check
 * above pass on dead code.
 */
const reviewSheet = read('components/recipe-review-sheet.tsx');
// Matches `onDismissed?.()` and the ref-cached `onDismissedRef.current?.()` —
// the ref exists to dodge a stale-closure problem, not to change what fires.
if (!reviewSheet || !/onDismissed(Ref\.current)?\?\.\(\)/.test(code(reviewSheet))) {
  fail('recipe-review-sheet.tsx must call onDismissed() once it has actually closed', [
    'Without this, recipe.tsx has nothing to hang the navigation on and either',
    'navigates too early (the original bug) or never navigates at all.',
  ]);
} else {
  console.log('ok   recipe-review-sheet.tsx reports its own close');
}

/* ================== a sheet can always shrink to fit the screen ============ */

/*
 * The card's tap-blocking wrapper carries three constraints — alignSelf,
 * maxHeight and flexShrink — and they are the only reason a tall sheet caps and
 * scrolls instead of running off the bottom of the screen.
 *
 * They are unusually easy to delete, because the comment right above them warns
 * the next reader NOT to put layout in that Pressable. That warning is about
 * things which ENLARGE it (padding, margin, a minimum size) and would swallow
 * backdrop taps; these three can only make it smaller. Nothing in the code says
 * which is which, so this does.
 *
 * The symptom if they go is not a crash. It is the purchase history opening
 * with its last row sliced in half by the screen edge, which reads as a
 * rendering glitch rather than a missing style.
 */
const sheetSrc = readFileSync(join(SRC, 'components', 'sheet.tsx'), 'utf8');
const sheetCode = sheetSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const wrapperStyled = /<Pressable onPress=\{\(\) => \{\}\} style=\{styles\.(\w+)\}/.exec(sheetCode);
if (!wrapperStyled) {
  fail("the sheet's card wrapper has no style", [
    'Without one it is a flex item at flexShrink: 0 with an indefinite height,',
    'so a card taller than the screen cannot shrink and a percentage maxHeight',
    'inside it resolves against nothing. Tall sheets then overflow the screen',
    'instead of scrolling. See components/sheet.tsx.',
  ]);
} else {
  const name = wrapperStyled[1];
  const decl = new RegExp(`${name}:\\s*\\{([^}]*)\\}`).exec(sheetCode);
  const body = decl?.[1] ?? '';
  const missing = [];
  if (!/maxHeight:\s*["']100%["']/.test(body)) missing.push('maxHeight: "100%"');
  if (!/flexShrink:\s*1/.test(body)) missing.push('flexShrink: 1');
  if (missing.length) {
    fail(`the sheet's card wrapper lost ${missing.join(' and ')}`, [
      'Both are load-bearing. maxHeight gives percentages inside the card a',
      'definite bound; flexShrink lets that bound actually squeeze it. Removing',
      'either makes a long sheet run off the bottom of the screen rather than',
      'scroll — silently, and only for users with enough data to notice.',
    ]);
  } else {
    console.log('ok   the sheet card can shrink and is bounded by the screen');
  }
}

/*
 * A sheet whose body is a scrolling list has to be able to shrink too, or the
 * bound above stops at the card and the list inside keeps its full content
 * height. Checked on the ledger specifically because it is the one with an
 * unbounded number of rows.
 */
const ledger = readFileSync(join(SRC, 'components', 'purchase-ledger.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
if (!/sheet:\s*\{[^}]*flexShrink:\s*1/.test(ledger)) {
  fail('the purchase ledger card can no longer shrink', [
    'Its maxHeight caps the card, but without flexShrink the cap is ignored',
    'when the rows exceed it and the list overflows the sheet.',
  ]);
} else if (/showsVerticalScrollIndicator=\{false\}/.test(ledger)) {
  fail('the purchase ledger hides its scroll indicator', [
    'It is the only thing on screen telling the user the history continues',
    'below the fold. Hiding it is what made a clipped list look like a bug.',
  ]);
} else {
  console.log('ok   the ledger shrinks and shows that it scrolls');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
