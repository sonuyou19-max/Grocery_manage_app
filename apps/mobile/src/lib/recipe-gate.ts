import { router } from 'expo-router';
import { useCallback } from 'react';

import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useAuth } from '@/store/auth';

/**
 * Whether `/recipe` is reachable right now, and where to send someone who
 * cannot reach it — computed once so the three places that open this screen
 * (the create sheet, a list's ✨ button, and the route itself for a deep link)
 * cannot give three different answers to "why can't I get in".
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to close
 * ---------------------------------------------------------------------------
 *
 * All three sites checked ONLY `usePlusGate().locked`, which is
 * `gateActive && !entitled`. For a signed-OUT visitor, `EntitlementProvider`
 * sets `gateActive = false` — deliberately, because every other Plus surface
 * (Pantry, Insights, the dashboard) is already wrapped in its own "signed out
 * → teaser screen" check before Plus is ever consulted, so `gateActive` never
 * has to account for auth there. Recipe import is the one Plus feature reached
 * from a route rather than a tab, and it never grew that first check — so
 * `locked` evaluated to `false` for a signed-out visitor and the importer
 * opened for free, no prompt, no sign-in wall, nothing.
 *
 * The fix is not a smarter `locked`. It is asking the right QUESTION first:
 * signed out is a different problem from unentitled, and it needs a different
 * screen — see the two-step check below.
 */
export type RecipeGateReason = 'signin' | 'paywall' | false;

export interface RecipeGate {
  /** Reason nobody may open the importer right now, or `false` if they may. */
  blocked: RecipeGateReason;
  /**
   * Tap-time entry: open `open()` if allowed, otherwise push toward whichever
   * step is missing. Callers already inside a Modal must wrap the WHOLE call
   * in `useDeferUntilClosed`'s `whenClosed` — every branch here navigates.
   */
  openOrRedirect: (open: () => void) => void;
  /**
   * Already-on-the-route guard: bounce out via `replace` rather than `push`,
   * so backing out lands wherever the visitor was, not on the screen they
   * were not allowed to open. For the deep-link case only — the two buttons
   * that open this screen never render it locked in the first place.
   */
  redirectIfBlocked: () => void;
}

export function useRecipeGate(): RecipeGate {
  const { user } = useAuth();
  const { locked, requirePlus } = usePlusGate();

  const blocked: RecipeGateReason = !user ? 'signin' : locked ? 'paywall' : false;

  const openOrRedirect = useCallback(
    (open: () => void) => {
      if (blocked === 'signin') {
        haptics.tick();
        router.push('/auth/sign-in');
        return;
      }
      if (blocked === 'paywall') {
        requirePlus();
        return;
      }
      open();
    },
    [blocked, requirePlus],
  );

  const redirectIfBlocked = useCallback(() => {
    if (blocked === 'signin') router.replace('/auth/sign-in');
    else if (blocked === 'paywall') router.replace('/paywall');
  }, [blocked]);

  return { blocked, openOrRedirect, redirectIfBlocked };
}
