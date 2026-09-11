import { FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { DURATION } from '@/lib/motion';

/**
 * Things arriving one after another, rather than all at once.
 *
 * Three screens had grown their own copy of this — basket, pantry mix and the
 * climate detail page — with three sets of constants (12 steps of 28ms, 12 of
 * 28, 10 of 30) and two nearly identical comments explaining the cap. They are
 * the same gesture and they should be the same numbers, or the app has a house
 * style that varies by screen, which is not a house style.
 *
 * ---------------------------------------------------------------------------
 * The cap is the whole design
 * ---------------------------------------------------------------------------
 *
 * Uncapped, the delay is proportional to position and a long list punishes its
 * own length: the fortieth row of a big shop waits over a second to appear.
 * That stops reading as a flourish and starts reading as the screen being slow,
 * which is the opposite of what an entrance animation is for.
 *
 * Capped at twelve, everything past the twelfth item arrives together at
 * 336ms. Nobody counts the twelfth row, and by then the eye has already
 * received the message — the screen is filling in, from the top.
 *
 * ---------------------------------------------------------------------------
 * Reduce Motion
 * ---------------------------------------------------------------------------
 *
 * Stated rather than inherited. Reanimated's default for layout animations is
 * to follow the system setting, which is what we want — but "what we want"
 * matching "what the library happens to do" is not a reason to leave it
 * unwritten, and a default that changes in a minor release would take a whole
 * accessibility behaviour with it silently.
 */

/** ms between one item and the next. */
export const CASCADE_STEP = 28;
/** Beyond this many items, everything arrives together. */
export const CASCADE_CAP = 12;
/** How long one item takes to arrive. */
export const CASCADE_MS = 240;

/**
 * The entering animation for the `order`-th thing on a screen.
 *
 * `order` is a position, not an index into anything — a screen whose cards are
 * conditional can number them 0..n and simply skip a few when some are hidden.
 * A gap in the numbering costs one 28ms step, which is not a thing anyone can
 * see, and it is much cheaper than making every screen build an array to count
 * with.
 */
export function cascade(order: number) {
  const step = Math.min(Math.max(0, Math.floor(order)), CASCADE_CAP);
  return FadeInDown.delay(step * CASCADE_STEP)
    .duration(CASCADE_MS)
    .reduceMotion(ReduceMotion.System);
}

/**
 * A row leaving.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Swiping a pantry row right takes it out of Running low, so the row unmounted
 * on the same frame the state changed and the next row jumped up into its
 * place. Two discontinuities at once, in the same 16ms: reported as "it is so
 * fast disappearing and the next item takes its place — it is creating a
 * flickering effect".
 *
 * The exiting view keeps its space while it fades, so nothing is ever
 * double-booked and the gap opens at the speed of the fade rather than
 * instantly.
 *
 * ---------------------------------------------------------------------------
 * Why there is no `reflow` beside it
 * ---------------------------------------------------------------------------
 *
 * There was one — a LinearTransition on the same wrapper — and the comment here
 * said the two belonged together, that exiting without layout animates the
 * wrong thing. On a real pantry it did something worse than nothing: a row that
 * MOVED rather than left came to rest overlapping its neighbour, with a hole
 * where it had been. Reported as "there is a big gap between eggplant and the
 * next item".
 *
 * Two reasons, and the second is the one that makes it unfixable here. A swipe
 * usually REORDERS a row rather than removing it — same key, new index — so
 * React re-parents the view and no exit ever runs; it is purely a layout
 * animation, racing the re-parent. And the stack spaces its rows with a flex
 * `gap`, which LinearTransition does not account for when it interpolates a
 * position, so every animated move lands short by exactly one gap.
 *
 * So: fade what leaves, and let what stays be where the layout says it is.
 * If a settled reorder is wanted, it needs a measured list, not this.
 *
 * Duration from lib/motion, whose `exit` is described in as many words as
 * "something leaving on its own: a toast, a chip, a row".
 */
export function depart() {
  return FadeOut.duration(DURATION.exit).reduceMotion(ReduceMotion.System);
}
