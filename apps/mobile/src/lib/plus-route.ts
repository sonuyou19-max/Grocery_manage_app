import { router } from 'expo-router';
import { useCallback } from 'react';

import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useAuth } from '@/store/auth';

/**
 * Whether a Plus-only ROUTE is reachable right now, and where to send someone
 * who cannot reach it — computed once so every place that opens such a screen
 * gives the same answer to "why can't I get in".
 *
 * Two routes use it. `/recipe`, the importer, reached from the create sheet, a
 * list's ✨ button, and its own deep link. And `/receipts`, the scanned-receipt
 * archive, reached from the Insights card and its own deep link.
 *
 * It was `useRecipeGate`, named for the first of those, and the second one
 * needed exactly this and nothing else — so the name moved to the concept
 * rather than a second copy of it being written. A tab does not need this: the
 * tabs are already behind their own "signed out → teaser" screens, which is the
 * whole reason `gateActive` does not account for auth.
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
export type PlusRouteReason = 'signin' | 'paywall' | false;

export interface PlusRoute {
  /** Reason nobody may open the importer right now, or `false` if they may. */
  blocked: PlusRouteReason;
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

export function usePlusRoute(): PlusRoute {
  const { user } = useAuth();
  const { locked, requirePlus } = usePlusGate();

  const blocked: PlusRouteReason = !user ? 'signin' : locked ? 'paywall' : false;

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
