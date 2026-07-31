import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { useAuth } from '@/store/auth';

/**
 * Whether this person may share a household, and which of their households are
 * still writable.
 *
 * ---------------------------------------------------------------------------
 * This is a MIRROR, never the decision
 * ---------------------------------------------------------------------------
 *
 * Everything here is for rendering: greying a frozen household, showing the
 * paywall on the invite button, telling someone their trial ends on Friday. The
 * actual enforcement lives in Postgres (migration 0024) and in the policies
 * built on it — a client that lied about `entitled` would get a row-level
 * security error on the first write, not a free subscription.
 *
 * Saying that plainly matters, because the temptation with a flag like this is
 * to start trusting it. If you ever find yourself wanting to *skip* a server
 * call because this says the user isn't entitled, that is fine; if you find
 * yourself wanting to *allow* something because it says they are, the check
 * belongs on the server.
 *
 * ---------------------------------------------------------------------------
 * Why access is a map and not a boolean
 * ---------------------------------------------------------------------------
 *
 * Entitlement is per-user but writability is per-household, and they are not
 * the same question. Aparna is unsubscribed yet writes freely to her own
 * household, and — while Sonu pays — to his. One flag could not express that,
 * so the server returns a row per household and the client just looks it up.
 */

interface EntitlementContext {
  /** May this user invite anyone into a household? The one paid capability. */
  entitled: boolean;
  /** When the free month runs out. Null once it has, or before we know. */
  trialEndsAt: number | null;
  /** End of a paid period, when there is one. */
  subscribedUntil: number | null;
  /** False until the first answer arrives — callers must not gate on a guess. */
  loaded: boolean;
  /**
   * Can the current user write to this household right now?
   *
   * Optimistic before the first load: an unknown household reads as writable,
   * because briefly showing a live list that turns out to be frozen is a much
   * smaller harm than greying out a household the user is paying for while a
   * request is in flight.
   */
  canWrite: (householdId: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<EntitlementContext | null>(null);

interface EntitlementRow {
  entitled: boolean;
  trial_ends_at: string | null;
  subscribed_until: string | null;
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
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      // Signed out there is nothing to be entitled to, and this state is
      // "loaded" — a caller waiting for an answer would otherwise wait forever.
      setEntitled(false);
      setTrialEndsAt(null);
      setSubscribedUntil(null);
      setAccess({});
      setLoaded(true);
      return;
    }
    try {
      const [mine, households] = await Promise.all([
        supabase.rpc('my_entitlement'),
        supabase.rpc('household_access'),
      ]);
      if (!mine.error && mine.data) {
        const row = (Array.isArray(mine.data) ? mine.data[0] : mine.data) as
          | EntitlementRow
          | undefined;
        if (row) {
          setEntitled(row.entitled === true);
          setTrialEndsAt(ms(row.trial_ends_at));
          setSubscribedUntil(ms(row.subscribed_until));
        }
      }
      if (!households.error && Array.isArray(households.data)) {
        const map: Record<string, boolean> = {};
        for (const r of households.data as Array<{ household_id: string; can_write: boolean }>) {
          map[r.household_id] = r.can_write === true;
        }
        setAccess(map);
      }
    } catch {
      // Offline. Keep whatever we last knew rather than flipping the whole app
      // into a frozen state over a dropped request — the server is still the
      // one refusing writes, so a stale optimistic view costs one failed write
      // and an explanation, not a wrong grant.
    } finally {
      setLoaded(true);
    }
  }, [user]);

  // Entitlement changes on a clock (a trial ending, a period lapsing) rather
  // than on anything happening in the app, so there is no event to subscribe
  // to. Re-reading on foreground is what catches it: the interesting
  // transitions all happen while the app is closed.
  useEffect(() => {
    void refresh();
  }, [refresh, appActive]);

  const value = useMemo<EntitlementContext>(
    () => ({
      entitled,
      trialEndsAt,
      subscribedUntil,
      loaded,
      canWrite: (householdId) => access[householdId] ?? true,
      refresh,
    }),
    [entitled, trialEndsAt, subscribedUntil, loaded, access, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntitlement(): EntitlementContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEntitlement must be used within EntitlementProvider');
  return ctx;
}
