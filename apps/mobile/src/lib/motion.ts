import { withSpring, type WithSpringConfig } from 'react-native-reanimated';

/**
 * The app's motion vocabulary: spring presets, and the rule for when a spring
 * is the right answer at all.
 *
 * ---------------------------------------------------------------------------
 * Why springs, and specifically why *velocity*
 * ---------------------------------------------------------------------------
 *
 * A duration curve — `withTiming(0, { duration: 260 })` — always takes 260ms,
 * whatever the user just did. Nudge a row two pixels and it takes 260ms. Fling
 * it across the screen and release at 3000px/s and it *stops dead*, then takes
 * the same 260ms to drift back. That discontinuity between the finger and the
 * pixels is most of what makes an app feel like a web page.
 *
 * A spring seeded with the release velocity has no such seam: the element
 * leaves your finger at exactly the speed your finger was moving and decelerates
 * physically. Slow drags settle quickly, hard flings overshoot and come back.
 * Nothing about the timing is decided in advance, which is the point.
 *
 * ---------------------------------------------------------------------------
 * When NOT to use one
 * ---------------------------------------------------------------------------
 *
 * A spring is only meaningful when something was *dragged* — velocity has to
 * come from somewhere real. Fades, ambient loops and entrances have no gesture
 * behind them, and a "spring" on opacity is just a duration curve wearing a
 * costume, with two extra parameters to get wrong. Those stay on `withTiming`
 * deliberately; see the comments at each remaining call site.
 *
 * ---------------------------------------------------------------------------
 * Android
 * ---------------------------------------------------------------------------
 *
 * All of this is Reanimated running on the UI thread, so it behaves identically
 * on both platforms — unlike the native sheet-presentation APIs, whose grabber,
 * corner-radius and expand-on-scroll options are iOS-only. That is the reason
 * this app builds its motion here rather than delegating to the platform.
 */

/**
 * Presets, chosen by what the moving thing *is* rather than by where it's used,
 * so two sheets can never drift apart by one damping point.
 *
 * Reading them: higher stiffness = faster; higher damping = less bounce; higher
 * mass = more inertia. Damping is tuned against stiffness, so change them as a
 * pair or the character shifts.
 */
export const SPRING: Record<string, WithSpringConfig> = {
  /**
   * A small element returning home after a swipe — a list row, a card.
   * Slightly underdamped so a hard fling visibly overshoots and settles, which
   * is the feedback that says "I felt that".
   */
  settle: { damping: 18, stiffness: 190, mass: 0.85 },

  /**
   * A large surface moving under the finger: sheets, panels.
   *
   * Critically damped on purpose (`overshootClamping`). A row that bounces reads
   * as playful; a full-width sheet that bounces past its resting edge reads as
   * broken, and on a tall sheet the overshoot exposes the screen behind it.
   */
  sheet: { damping: 24, stiffness: 220, mass: 1, overshootClamping: true },

  /**
   * A selection indicator catching up with a tap — the tab-bar lozenge.
   * Quick and light, with just enough overshoot to feel eager.
   */
  snappy: { damping: 15, stiffness: 150, mass: 0.7 },

  /**
   * Something leaving the screen for good — a swiped-away card.
   *
   * Stiff and clamped so the exit is decisive whichever way it was released. A
   * spring's duration depends on distance, and the target here is off-screen;
   * without the extra stiffness a card nudged just past the threshold would
   * take an age to travel that far and read as a hang.
   */
  fling: { damping: 26, stiffness: 260, mass: 0.8, overshootClamping: true },

  /** Layout settling with no gesture behind it. Calm, no overshoot. */
  gentle: { damping: 20, stiffness: 130, mass: 1, overshootClamping: true },

  /**
   * A control acknowledging a tap — the swell half of a squash-and-settle.
   *
   * Deliberately stiff and underdamped: there is no gesture velocity to inherit
   * here, so the snap has to come from the spring itself or the element merely
   * eases up to its peak and the "I felt that" is lost. Always the first leg of
   * a withSequence, with `settle` or `snappy` landing it back at rest — used by
   * the tab icon you just selected and the bag catching an item.
   */
  punch: { damping: 12, stiffness: 320 },
};

/**
 * A spring that continues the gesture instead of restarting the motion.
 *
 * Pass the velocity straight from the gesture's `onEnd` event — Reanimated and
 * gesture-handler both work in points per second, so no conversion is needed.
 * Getting the sign right matters: this must be the velocity on the same axis
 * and in the same direction as the value being animated, or the element kicks
 * backwards before travelling the right way.
 *
 *   .onEnd((e) => { tx.value = springTo(0, e.velocityX); })
 */
export function springTo(
  toValue: number,
  velocity: number,
  config: WithSpringConfig = SPRING.settle,
) {
  'worklet';
  return withSpring(toValue, { ...config, velocity });
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard clamp (`Math.min(travel, MAX)`) makes the element stop dead while the
 * finger keeps going — the surface stops tracking, and it feels broken rather
 * than bounded. Rubber-banding keeps it moving, just less and less, so the
 * limit is communicated by feel instead of by a wall. It is the same curve iOS
 * uses at the end of a scroll view.
 *
 * `give` is the maximum extra travel allowed past `limit`, approached
 * asymptotically and never reached. It is an absolute distance in points, NOT
 * a fraction of the limit: the most useful case is a boundary at zero — a sheet
 * already fully open, a row already closed — where you still want a few points
 * of elastic give, and any formula expressed as a proportion of the limit
 * collapses to nothing exactly there.
 *
 * Default give is a little over half the limit, which is the right feel for a
 * real boundary. Pass it explicitly whenever `limit` is 0.
 */
export function rubberBand(value: number, limit: number, give = limit * 0.55): number {
  'worklet';
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  if (magnitude <= limit) return value;
  if (give <= 0) return sign * limit;
  const over = magnitude - limit;
  // Asymptotic: at `over === give` half the give is used; as over grows the
  // curve flattens towards limit + give. Continuous at the boundary (over = 0
  // yields exactly limit), so there is no visible kink as the finger crosses it.
  return sign * (limit + (over * give) / (over + give));
}
