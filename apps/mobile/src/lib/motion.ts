import { useRef } from 'react';
import { Easing, withSpring, type WithSpringConfig } from 'react-native-reanimated';

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

  /**
   * A button coming back up after a press.
   *
   * Stiff and well damped: the finger has already left, so this is not a
   * flourish to be watched — it is the control catching up, and it should be
   * over before anyone decides it is an animation. Overshoot is left ON, so the
   * return carries the faintest bounce that makes a tap feel like it pushed
   * something physical rather than toggling a state.
   *
   * Used through components/press-scale, which is the only thing that should
   * need it: one preset means every button in the app answers a finger the same
   * way.
   */
  press: { damping: 25, stiffness: 400, mass: 1 },
};

/**
 * DURATIONS, named by what is moving rather than by how long it takes.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, written down because the symptom was mine
 * ---------------------------------------------------------------------------
 *
 * The springs above have been a system since they were written: chosen by what
 * the moving thing IS, shared, and impossible to drift apart by one damping
 * point. Durations had none of that. There were sixteen `_MS` constants in
 * sixteen files, every one a private opinion invented at the moment it was
 * needed — and two of them were the same number for the same thing in two
 * files, which is the drift a vocabulary exists to prevent. A sheet closed in
 * 200ms here and 160ms there, for no reason either file could give.
 *
 * That is what "I have to ask for every animation" looks like from the inside.
 * There was nothing to reach for, so each new component reached for a number,
 * and nothing in the codebase could tell the next person what a fade costs in
 * this app. A design system is not a folder of components; it is the set of
 * decisions you no longer have to make.
 *
 * ---------------------------------------------------------------------------
 * The rule these encode: LEAVING IS FASTER THAN ARRIVING
 * ---------------------------------------------------------------------------
 *
 * Not symmetry, and this is the one number-choice worth arguing for. An
 * entrance is something you are being shown and it can afford to be watched. An
 * exit is something you have already decided about — you tapped Done, you
 * dismissed the sheet — and every millisecond after that decision is the app
 * making you wait to see a screen you asked for. So exits are roughly two
 * thirds of their entrance, everywhere, and check-motion asserts it rather than
 * trusting anyone to remember.
 */
export const DURATION = {
  /**
   * The OUT half of a value being replaced in place — a figure recalculating.
   *
   * The shortest thing here on purpose: nothing is arriving or leaving, the
   * same element is showing a different number, and a long fade would read as
   * the screen being uncertain rather than as an update.
   */
  swap: 90,

  /**
   * ...and the IN half, deliberately almost twice as long.
   *
   * The asymmetry is the whole effect. Clearing fast and arriving slower reads
   * as the new value being PLACED; matched durations read as a crossfade, which
   * is a transition between two things rather than one thing changing.
   */
  settle: 170,

  /** Something leaving on its own: a toast, a chip, a row. */
  exit: 160,

  /**
   * ...and something leaving with a DIM SETTLING BEHIND IT.
   *
   * Longer than a plain exit, and this is the one value here that was already
   * argued out in the codebase before there was a vocabulary to put it in. The
   * sheet's close eases OUT, which puts the slow part at the end — and a scrim
   * needs that tail or the dim reads as the background light being switched
   * rather than fading. 160ms leaves the tail nowhere to happen.
   *
   * Two sheets disagreed about this, 200 here and 160 there, with only one of
   * them having a reason. Naming it is how the one with the reason wins.
   */
  scrimExit: 200,

  /** Something arriving. The default for an entrance. */
  enter: 220,

  /**
   * Something crossing the screen, or a number counting up to its value.
   *
   * Long enough to be followed by eye, which is the entire point — this is the
   * only class here meant to be WATCHED rather than merely not noticed.
   */
  travel: 480,

  /**
   * A loop that OSCILLATES — a glow breathing, a card rocking on a long press.
   *
   * Slow enough that nobody reads it as progress. The app had 1200 at three
   * sites and 1400 at two, which is not a decision anybody made twice; it is
   * the same idea typed out five times.
   */
  breathe: 1200,

  /** A loop that TRAVERSES — a scanning line crossing a frame. */
  sweep: 1800,
} as const;

/**
 * EASINGS, and there are only three because there are only three situations.
 *
 * Cubic rather than quad throughout: the app had both, at eight sites and seven,
 * with nothing distinguishing them — which is two vocabularies for one idea and
 * the reason a screen can feel subtly inconsistent without anyone being able to
 * point at why.
 */
export const EASE = {
  /**
   * Arriving. Fast at first, decelerating into place — the shape of something
   * with momentum coming to rest, and the only one of the three that should
   * ever be used on an entrance.
   */
  enter: Easing.out(Easing.cubic),
  /**
   * Leaving. Slow at first, accelerating away. It reads as the element being
   * released rather than yanked, and it puts the fast part of the motion at the
   * end, where nobody is looking any more.
   */
  exit: Easing.in(Easing.cubic),
  /**
   * Moving between two known places, both ends anchored: a lozenge sliding
   * between tabs, a value recalculating. Neither end is an appearance.
   */
  move: Easing.inOut(Easing.cubic),
} as const;

/**
 * Keep rendering the thing you were given, after you stop being given it.
 *
 * ---------------------------------------------------------------------------
 * The flicker this exists to remove, written out because it happened four times
 * ---------------------------------------------------------------------------
 *
 * Every sheet in this app is opened by handing it a subject and closed by
 * handing it null. Both go to null on the SAME FRAME, because the caller closes
 * by clearing the key the subject is looked up by — so the obvious
 * `if (!item) return null` unmounts the whole sheet before its exit animation
 * can play a single frame. The sheet does not animate away. It stops existing,
 * which on screen is a flash.
 *
 * It is not a bug you can see in a diff, it is not a bug a typecheck can find,
 * and every component that renders a nullable subject has it until somebody
 * notices. Four of them worked it out independently — staple-sheet, item-sheet,
 * purchase-sheet, purchase-ledger — each with its own ref, its own naming and
 * its own paragraph explaining the same thing. That is the shape of a missing
 * abstraction: not duplicated code, duplicated REASONING.
 *
 * So it has a name now. `useLastPresent(item)` returns the item while it is
 * there and the last one afterwards, which is exactly what a component needs to
 * draw itself out of existence.
 *
 * ---------------------------------------------------------------------------
 * Why a ref rather than state
 * ---------------------------------------------------------------------------
 *
 * Writing it during render is deliberate and safe here: it is a cache of a prop,
 * not a source of truth, and the value it returns is derived from the prop on
 * every render. Putting it in state would need an effect, which lands a frame
 * late — and a frame late is precisely the flash this removes.
 */
export function useLastPresent<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(null);
  if (value != null) last.current = value;
  return last.current;
}

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
