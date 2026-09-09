import { FadeInDown, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';

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
 * A row leaving, and the rows below closing over the gap.
 *
 * ---------------------------------------------------------------------------
 * Why both, and never one without the other
 * ---------------------------------------------------------------------------
 *
 * Swiping a pantry row right takes it out of Running low, so the row unmounted
 * on the same frame the state changed and the next row jumped up into its
 * place. Two discontinuities at once, in the same 16ms: reported as "it is so
 * fast disappearing and the next item takes its place — it is creating a
 * flickering effect".
 *
 * `depart` is only half a fix. A row that fades while its neighbours snap is
 * still a snap — the eye follows the MOVEMENT, and the movement is the gap
 * closing, not the pixels dimming. `reflow` on the same wrapper is what makes
 * the list settle rather than cut, and the two belong together: exiting without
 * layout animates the wrong thing.
 *
 * The exiting view keeps its space while it fades and the rows below travel
 * into it, so nothing is ever double-booked and no row moves before there is
 * somewhere for it to move to.
 *
 * Durations from lib/motion, whose `exit` is described in as many words as
 * "something leaving on its own: a toast, a chip, a row". `settle` is the
 * longer of the two on purpose — the gap closing is the part meant to be
 * followed, and matching them reads as a cut with a crossfade over it.
 */
export function depart() {
  return FadeOut.duration(DURATION.exit).reduceMotion(ReduceMotion.System);
}

/** The gap closing. Goes on the SAME wrapper as `depart` — see above. */
export function reflow() {
  return LinearTransition.duration(DURATION.settle).reduceMotion(ReduceMotion.System);
}
