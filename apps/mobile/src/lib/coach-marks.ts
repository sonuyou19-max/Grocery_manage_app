import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';

/**
 * Coach marks — the tips that teach Korb's gestures, shown once each, in place.
 *
 * ---------------------------------------------------------------------------
 * Why these are not part of the welcome tour
 * ---------------------------------------------------------------------------
 *
 * app/onboarding.tsx already exists and does the job a card deck can do: it
 * says what Korb is for. What it cannot do is teach a gesture, because on first
 * launch there is nothing to gesture at. No lists, no pantry rows, no purchase
 * history — a swipe demo at that moment is a drawing of a swipe, and a coach
 * mark is an arrow pointing at empty space.
 *
 * So these fire LATER, each one the first time its screen has something real
 * on it. The pantry swipe tip waits until there are pantry rows; the delete tip
 * waits until a list has items. The user learns the gesture on their own data,
 * at the moment it is useful, which is also the moment they will remember it.
 *
 * The cost is that the tips arrive spread over the first few sessions rather
 * than all at once, and that is the right trade: a wall of tips at install is
 * skipped as a matter of reflex.
 *
 * ---------------------------------------------------------------------------
 * The rules that keep them from being an irritation
 * ---------------------------------------------------------------------------
 *
 * - Once each, ever. Dismissing writes the id and it never returns.
 * - One at a time. `coachMarkDue` answers for one id, and a screen holding two
 *   tips orders them itself so the second waits for a later visit.
 * - "Skip tips" kills all of them at once, everywhere. Somebody who does not
 *   want to be taught should have to say so exactly once.
 * - Decided SYNCHRONOUSLY from a cache hydrated at boot, like onboarding.ts.
 *   Reading storage after mount is what made the welcome tour appear a beat
 *   late, sliding over a screen that had already painted.
 * - Fail closed. If storage cannot be read, nothing is due — a tip that fails
 *   to appear is invisible, and one that appears every launch is a bug report.
 */

/** The tips, and the order they are meant to be met in. */
export type CoachMark =
  /** Swipe a list row left to delete it. */
  | 'listSwipeDelete'
  /** Swipe a pantry row: left adds to a list, right says it is still good. */
  | 'pantrySwipe'
  /** Tap a pantry row for its purchase history and "let it rest". */
  | 'pantryDetails';

const KEY = 'korb.coachMarks.v1';
/** Written into the same map when "Skip tips" is used, so one read answers
 *  both questions and there is no second key to fall out of step. */
const SKIP_ALL = '__all';

let cache: Record<string, true> | null = null;

export async function hydrateCoachMarks(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    // Unreadable storage means every tip stays hidden rather than every tip
    // reappearing on every launch. See "fail closed" above.
    cache = { [SKIP_ALL]: true };
  }
}

/**
 * Is this tip still owed? `null` while hydration is in flight — callers must
 * treat that as "not yet", never as "yes", or the tip races the first paint.
 */
export function coachMarkDue(id: CoachMark): boolean | null {
  if (cache === null) return null;
  return !cache[SKIP_ALL] && !cache[id];
}

const persist = async (next: Record<string, true>) => {
  cache = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The in-memory cache is already updated, so the tip will not come back
    // this session. Losing it across a restart is a far smaller problem than
    // failing the interaction the user just completed.
  }
};

export async function markCoachMarkSeen(id: CoachMark): Promise<void> {
  await persist({ ...(cache ?? {}), [id]: true });
}

export async function dismissAllCoachMarks(): Promise<void> {
  await persist({ ...(cache ?? {}), [SKIP_ALL]: true });
}

/** Dev/Settings: let the tips be seen again. */
export async function resetCoachMarks(): Promise<void> {
  await persist({});
}

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How long to wait after `ready` before measuring and showing.
 *
 * Long enough for the screen's entrance and its layout animations to finish,
 * because measuring mid-animation returns where the row WAS and the spotlight
 * lands next to it. Short enough that the tip still reads as part of arriving
 * on the screen rather than as an interruption.
 */
const SETTLE_MS = 700;

/**
 * Drive one coach mark: wait until it is due and its target exists, measure the
 * target in window coordinates, then show.
 *
 * `measureInWindow`, not `onLayout`. onLayout gives a position relative to the
 * parent, and the overlay is a full-screen Modal — its own native window on
 * Android, with no shared coordinate space to convert through. Window
 * coordinates are the only ones both sides agree on.
 */
export function useCoachMark(
  id: CoachMark,
  ready: boolean,
  /**
   * The view to point at. Passed in rather than owned here because two tips can
   * share one target — the Pantry teaches both the swipe and the tap on its
   * first row — and a ref can only be attached to an element once.
   */
  ref: RefObject<View | null>,
) {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [visible, setVisible] = useState(false);
  /** Guards a second show after dismissal within the same mount — `cache` is
   *  written asynchronously, so `coachMarkDue` can still say true for a frame. */
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current || coachMarkDue(id) !== true) return;
    const timer = setTimeout(() => {
      ref.current?.measureInWindow((x, y, width, height) => {
        // A zero-sized measurement means the target is not laid out after all
        // (collapsed, or scrolled out of an unmounted window). Showing a
        // spotlight over nothing is worse than showing nothing, and the tip is
        // still owed, so it simply waits for the next visit.
        if (width <= 0 || height <= 0) return;
        setRect({ x, y, width, height });
        setVisible(true);
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, id]);

  const close = (all: boolean) => {
    done.current = true;
    setVisible(false);
    void (all ? dismissAllCoachMarks() : markCoachMarkSeen(id));
  };

  return {
    rect,
    visible,
    dismiss: () => close(false),
    skipAll: () => close(true),
  };
}
