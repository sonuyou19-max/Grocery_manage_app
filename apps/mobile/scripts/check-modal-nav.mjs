/**
 * Navigating out of a <Modal> has to wait for the Modal.
 *
 * On Android a react-native <Modal> is its own native window. Push a route while
 * one is up and the navigation lands underneath it — the user gets a blank
 * screen with no way back. It is not a rare edge: it has shipped three times, in
 * three unrelated features, written weeks apart.
 *
 *   recipe.tsx confirmed an import and navigated in the same commit that
 *   unmounted the review sheet.
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
 * So the ordering gets a guard instead of a convention. lib/modal-nav.ts holds
 * the one implementation; this asserts the files that need it still use it.
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

/* --------------------------- 3. nobody re-implements it next to a modal */

/*
 * recipe.tsx does the same thing by hand, because its trigger is the review
 * sheet's own unmount rather than a boolean this component owns. That is a
 * legitimate second shape, and it is pinned here so it cannot quietly become a
 * bare router call again.
 */
const recipe = read('app/recipe.tsx');
if (!recipe || !/InteractionManager\.runAfterInteractions/.test(recipe)) {
  fail('recipe.tsx must not navigate straight out of the review sheet', [
    'The confirm handler queues the move and runs it once the <Modal> is gone.',
    'Dropping that wait is the original blank-screen bug.',
  ]);
} else {
  console.log('ok   recipe.tsx still waits for the review sheet to go');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
