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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** Files that navigate, or open the paywall, from inside a Modal they own. */
const MUST_DEFER = [
  'components/create-sheet.tsx',
  'components/range-picker.tsx',
  'app/(tabs)/pantry.tsx',
  // Reports its own close via `onDismissed`, built on this same primitive —
  // see the header comment for why its old InteractionManager-based cousin in
  // recipe.tsx was not actually a fix.
  'components/recipe-review-sheet.tsx',
];

/** The one place the deferral is implemented. */
const OWNER = 'lib/modal-nav.ts';

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
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

/* ---------------------------------------- 2. every known site still uses it */

const missing = MUST_DEFER.filter((rel) => {
  const text = read(rel);
  return !text || !/useDeferUntilClosed/.test(text);
});
if (missing.length) {
  fail('every modal that navigates must defer until it has closed', [
    ...missing.map((rel) => `${rel} no longer imports useDeferUntilClosed.`),
    'If the modal genuinely no longer navigates, remove it from MUST_DEFER above',
    'and say so — do not delete the import and leave the entry.',
  ]);
} else {
  console.log(`ok   all ${MUST_DEFER.length} navigating modals defer until closed`);
}

/* ------------------- 3. nobody trusts InteractionManager for this again */

/*
 * The exact mechanism that looked like a fix for occurrence #1 and was not:
 * it waits for JS "interactions" (gestures, explicit handles), and a native
 * Modal's own animation registers none. Its presence ANYWHERE in the modal
 * story is a sign someone is reaching for the thing that already failed here
 * once, so this fails loud rather than trusting a call site to remember why.
 */
const suspects = [...MUST_DEFER, 'app/recipe.tsx'];
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
