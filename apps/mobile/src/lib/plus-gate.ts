import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { billingAvailable } from '@/lib/billing';
import { haptics } from '@/lib/haptics';
import { useEntitlement } from '@/store/entitlement';

/**
 * The one place that decides whether Korb Plus is withholding something.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module and not two lines in each screen
 * ---------------------------------------------------------------------------
 *
 * The rule is `gateActive && !entitled`, which is short enough that every
 * screen could just write it. Seven screens now need it — Insights, Pantry,
 * the dashboard, the Vibe Check, the item history, the household switcher,
 * Settings — and seven copies of a two-term boolean is precisely the shape of
 * the bug that shipped in this codebase twice already: the plural rule that
 * only covered Polish, and the category table that only covered English. Both
 * were "obviously fine" duplicates that quietly stopped agreeing.
 *
 * So there is one definition, one prompt, and a check that fails the build if
 * a screen writes its own.
 *
 * ---------------------------------------------------------------------------
 * Both halves of `locked` are load-bearing
 * ---------------------------------------------------------------------------
 *
 * `gateActive` alone would lock out a paying subscriber. `!entitled` alone
 * would lock out everyone the moment their free month ended, INCLUDING right
 * now, before billing exists and before anything is actually for sale — which
 * would mean shipping a wall with no door. The server derives `gateActive`
 * from whether the free history window is narrower than the paid one
 * (migration 0025), so one SQL function turns the whole tier on or off without
 * an app release.
 *
 * ---------------------------------------------------------------------------
 * Three shapes of gating, and when to use which
 * ---------------------------------------------------------------------------
 *
 *   HIDE      The card is not rendered. For things that are meaningless
 *             without the data behind them — a pantry mix with nothing in it,
 *             a staples list of nothing. A locked shell would be worse than
 *             absence.
 *
 *   PROMPT    The card stays, tapping it calls requirePlus(). For things whose
 *             VALUE IS VISIBLE FROM THE OUTSIDE: the Vibe Check card still
 *             says how many items are low, an item still shows it has a
 *             history. Removing those would look like the app forgot a feature
 *             rather than that a feature is for sale.
 *
 *   NARROW    Show less of the same thing, silently. Only the history window
 *             does this, and only because four weeks of your own spending is a
 *             coherent product rather than a broken one.
 */
export interface PlusGate {
  /** Is Plus withholding something from this account right now? */
  locked: boolean;
  /** True when this account HAS Plus — for the badge, not for gating. */
  entitled: boolean;
  /**
   * Is the paid tier switched on at all, regardless of who is asking?
   *
   * Distinct from `locked`, and the difference is not academic. A trial user is
   * entitled, so `locked` is false for them — but the trial nudge needs to know
   * whether anything will ACTUALLY be withheld when that trial ends, which is a
   * question about the tier, not about them. Before billing goes live nothing
   * is withheld from anyone, and a banner warning about a downgrade that will
   * not happen is worse than no banner.
   *
   * Exposed here rather than letting callers read `gateActive` off the
   * entitlement store, so the concept still has one home.
   */
  tierLive: boolean;
  /**
   * Ask for the subscription.
   *
   * Routes to the paywall when there is something to sell, and does nothing at
   * all when there isn't — no key, no store, no dead-end screen. Callers can
   * fire this unconditionally; it decides whether the tap goes anywhere.
   */
  requirePlus: () => void;
  /**
   * Wrap a locked action.
   *
   *     onPress={guard(() => router.push('/vibe-check'))}
   *
   * Runs the action when unlocked, prompts when not. Exists so a screen never
   * writes `locked ? prompt() : doThing()` by hand and never gets the branches
   * the wrong way round.
   */
  guard: (action: () => void) => () => void;
}

export function usePlusGate(): PlusGate {
  const { entitled, gateActive } = useEntitlement();
  const locked = gateActive && !entitled;

  const requirePlus = useCallback(() => {
    // Nothing to sell means nothing to say. A paywall that cannot take money
    // reads as a broken app, not an unfinished feature.
    if (!billingAvailable()) return;
    haptics.tick();
    router.push('/paywall');
  }, []);

  const guard = useCallback(
    (action: () => void) => () => {
      if (locked) requirePlus();
      else action();
    },
    [locked, requirePlus],
  );

  return useMemo(
    () => ({ locked, entitled, tierLive: gateActive, requirePlus, guard }),
    [locked, entitled, gateActive, requirePlus, guard],
  );
}
