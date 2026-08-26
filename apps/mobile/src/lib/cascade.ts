import { FadeInDown, ReduceMotion } from 'react-native-reanimated';

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
