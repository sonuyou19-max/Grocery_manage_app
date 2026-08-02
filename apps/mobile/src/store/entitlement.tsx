import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { initBilling } from '@/lib/billing';
import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { useAuth } from '@/store/auth';

/**
 * Korb Plus: what this person has paid for, and how far back they may look.
 *
 * ---------------------------------------------------------------------------
 * What Plus is, and what it deliberately is not
 * ---------------------------------------------------------------------------
 *
 * Plus buys DEPTH, not features. Free accounts get lists, cloud backup,
 * realtime, the entire pantry with its burn-rate prediction, and — this is the
 * part that changed — inviting other people into a household. Plus adds the
 * full year of spending history instead of the last few weeks, and the three
 * Insights cards that cannot exist without it: price moves over time, cheaper
 * elsewhere across shops, and the weekly recap.
 *
 * Sharing used to be the paid feature, and migration 0024 still carries the
 * vocabulary for it. It was dropped because every comparable app gives sharing
 * away, so charging for it made Korb's free tier visibly worse than whatever
 * the user already has — and because an invite is how a second person comes to
 * install the app at all. Taxing that taxes growth. See migration 0025.
 *
 * ---------------------------------------------------------------------------
 * This is a MIRROR, and the thing it mirrors is not a lock
 * ---------------------------------------------------------------------------
 *
 * The old version of this file said enforcement lived in RLS, which was true
 * when the paid thing was writing to someone else's household: lying about
 * `entitled` got you a row-level security error, not a free subscription.
 *
 * That is no longer the shape of it, and pretending otherwise would be worse
 * than saying nothing. The rows behind the history window are the user's OWN
 * purchases, and RLS lets them read every one — as it should. `historyCutoff`
 * is a product boundary the client is trusted to honour, and a patched client
 * could ask for more.
 *
 * That is an acceptable trade because of what is behind the boundary: somebody
 * sees their own groceries. It would not be acceptable for anything involving
 * another person's data, another household, or the ability to write. If a
 * future paid feature touches any of those, it needs a server check of its own
 * and must not be added to this object and treated as done.
 *
 * The cutoff still comes from the server, though — see below.
 */

interface EntitlementContext {
  /** Does this person have Plus (paid, or still inside the free month)? */
  entitled: boolean;
  /** When the free month runs out. Null once it has, or before we know. */
  trialEndsAt: number | null;
  /** End of a paid period, when there is one. */
  subscribedUntil: number | null;
  /**
   * The oldest purchase timestamp this account may see, as epoch ms.
   *
   * Computed by Postgres (`my_entitlement()`), never here. Not for enforcement
   * — see above — but so "the free tier is four weeks" has exactly one
   * definition. A constant in this bundle would ship on its own schedule, drift
   * from the number printed on the paywall, and need a store release to change.
   * The server can change it between two app opens.
   *
   * Null before the first answer arrives, and null when signed out. Callers
   * must treat null as "no window yet" and fall back to their own default
   * rather than to zero, which would show an empty history.
   */
  historyCutoff: number | null;
  /**
   * Is anything actually withheld from a free account right now?
   *
   * False until billing goes live, and false again the moment it is switched
   * off — the server derives it from whether the free window is narrower than
   * the paid one (migration 0025), so ONE change to one SQL function turns the
   * whole tier on or off without an app release.
   *
   * Kept distinct from `!entitled`, and the difference matters: before launch
   * every account past its free month is unentitled, but nothing is being
   * withheld from it. Gating on `!entitled` alone would take the recap away
   * from testers while leaving their history untouched — one user given two
   * different answers about which tier they are on.
   */
  gateActive: boolean;
  /** False until the first answer arrives — callers must not gate on a guess. */
  loaded: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<EntitlementContext | null>(null);

interface EntitlementRow {
  entitled: boolean;
  trial_ends_at: string | null;
  subscribed_until: string | null;
  history_cutoff: string | null;
  plus_gate_active: boolean;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function EntitlementProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const appActive = useAppActive();
  const [entitled, setEntitled] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<number | null>(null);
  const [subscribedUntil, setSubscribedUntil] = useState<number | null>(null);
  const [historyCutoff, setHistoryCutoff] = useState<number | null>(null);
  const [gateActive, setGateActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      // Signed out there is nothing to be entitled to, and this state is
      // "loaded" — a caller waiting for an answer would otherwise wait forever.
      setEntitled(false);
      setTrialEndsAt(null);
      setSubscribedUntil(null);
      setHistoryCutoff(null);
      setGateActive(false);
      setLoaded(true);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('my_entitlement');
      if (!error && data) {
        const row = (Array.isArray(data) ? data[0] : data) as EntitlementRow | undefined;
        if (row) {
          setEntitled(row.entitled === true);
          setTrialEndsAt(ms(row.trial_ends_at));
          setSubscribedUntil(ms(row.subscribed_until));
          setHistoryCutoff(ms(row.history_cutoff));
          setGateActive(row.plus_gate_active === true);
        }
      }
    } catch {
      // Offline. Keep whatever we last knew rather than narrowing someone's
      // history because a request timed out — a stale generous view costs
      // nothing, and the next foreground corrects it.
    } finally {
      setLoaded(true);
    }
  }, [user]);

  /**
   * Bind the store SDK to this account.
   *
   * Here rather than in the root layout because the RevenueCat app user id must
   * BE the Supabase user id — that identity is the entire mechanism by which a
   * webhook knows whose subscription row to write, and this is the component
   * that already tracks who is signed in. Keeping the two in one place means
   * they cannot get out of step on a sign-out/sign-in.
   *
   * No-op in every build without a RevenueCat key, which currently is all of
   * them. See lib/billing.ts.
   */
  useEffect(() => {
    void initBilling(user?.id ?? null);
  }, [user?.id]);

  // Entitlement changes on a clock (a trial ending, a period lapsing) rather
  // than on anything happening in the app, so there is no event to subscribe
  // to. Re-reading on foreground is what catches it: the interesting
  // transitions all happen while the app is closed.
  useEffect(() => {
    void refresh();
  }, [refresh, appActive]);

  const value = useMemo<EntitlementContext>(
    () => ({ entitled, trialEndsAt, subscribedUntil, historyCutoff, gateActive, loaded, refresh }),
    [entitled, trialEndsAt, subscribedUntil, historyCutoff, gateActive, loaded, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntitlement(): EntitlementContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEntitlement must be used within EntitlementProvider');
  return ctx;
}
