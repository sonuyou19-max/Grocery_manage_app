import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { useAuth } from '@/store/auth';

/**
 * The household the signed-in user belongs to, plus its members. A user has at
 * most one household in the MVP (multi-household comes later). Grocery data
 * moves into this household in the next phase — for now it establishes the
 * shared account and invite flow.
 */

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

export interface Member {
  user_id: string;
  role: 'owner' | 'member';
  display_name: string;
}

interface HouseholdContext {
  household: Household | null;
  members: Member[];
  loading: boolean;
  refresh: () => Promise<void>;
  createHousehold: (name: string, displayName: string) => Promise<{ error?: string }>;
  joinHousehold: (code: string, displayName: string) => Promise<{ error?: string }>;
  renameHousehold: (name: string) => Promise<{ error?: string }>;
  leaveHousehold: () => Promise<{ error?: string }>;
  removeMember: (userId: string) => Promise<{ error?: string }>;
}

const Ctx = createContext<HouseholdContext | null>(null);

const friendlyError = (message: string): string => {
  if (message.includes('invalid_code')) return 'That invite code didn’t match any household.';
  if (message.includes('not_authenticated')) return 'Please sign in first.';
  if (message.includes('not_owner')) return 'Only the owner can remove members.';
  if (message.includes('use_leave')) return 'Use “Leave household” to remove yourself.';
  return message;
};

export function HouseholdProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const appActive = useAppActive();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  // Signature of the last-applied membership, so background polling only
  // re-renders when something actually changed.
  const sigRef = useRef<string>('');

  const refresh = useCallback(async () => {
    if (!user) {
      sigRef.current = '';
      setHousehold(null);
      setMembers([]);
      return;
    }
    setLoading(true);
    try {
      const { data: membership } = await supabase
        .from('household_members')
        .select('household_id, households(id, name, invite_code, created_at)')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      const h = (membership?.households as unknown as Household) ?? null;
      let rows: Member[] = [];
      if (h) {
        const { data } = await supabase
          .from('household_members')
          .select('user_id, role, display_name')
          .eq('household_id', h.id);
        rows = (data as Member[] | null) ?? [];
      }

      const sig = JSON.stringify({
        h: h?.id ?? null,
        m: rows.map((r) => `${r.user_id}:${r.role}:${r.display_name}`).sort(),
      });
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setHousehold(h);
        setMembers(rows);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Membership changes (e.g. being removed by the owner) have no realtime
  // path that reaches the removed member, so keep it fresh by re-checking when
  // the app returns to the foreground and on a slow interval while open.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const interval = setInterval(() => void refresh(), 25000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [user, refresh]);

  const value = useMemo<HouseholdContext>(
    () => ({
      household,
      members,
      loading,
      refresh,
      createHousehold: async (name, displayName) => {
        const { error } = await supabase.rpc('create_household', {
          p_name: name,
          p_display_name: displayName,
        });
        if (error) return { error: friendlyError(error.message) };
        await refresh();
        return {};
      },
      joinHousehold: async (code, displayName) => {
        const { error } = await supabase.rpc('join_household', {
          p_code: code,
          p_display_name: displayName,
        });
        if (error) return { error: friendlyError(error.message) };
        await refresh();
        return {};
      },
      renameHousehold: async (name) => {
        if (!household) return {};
        const clean = name.trim();
        if (!clean || clean === household.name) return {};
        // Optimistic: reflect the new name immediately, then persist. RLS lets
        // only the owner update; a failure rolls back via refresh().
        setHousehold((prev) => (prev ? { ...prev, name: clean } : prev));
        const { error } = await supabase
          .from('households')
          .update({ name: clean })
          .eq('id', household.id);
        if (error) {
          await refresh();
          return { error: friendlyError(error.message) };
        }
        // Keep the signature in step so the next poll/realtime tick doesn't
        // think nothing changed and skip re-applying the server truth.
        sigRef.current = '';
        return {};
      },
      leaveHousehold: async () => {
        if (!household) return {};
        const { error } = await supabase.rpc('leave_household', { p_household: household.id });
        if (error) return { error: friendlyError(error.message) };
        await refresh();
        return {};
      },
      removeMember: async (userId) => {
        if (!household) return {};
        const { error } = await supabase.rpc('remove_member', {
          p_household: household.id,
          p_user: userId,
        });
        if (error) return { error: friendlyError(error.message) };
        await refresh();
        return {};
      },
    }),
    [household, members, loading, refresh],
  );

  // Live household updates (e.g. a rename by another member) reach everyone via
  // the realtime channel; the membership poll/foreground refresh is the backstop.
  // While backgrounded we hold no socket — the foreground refresh above catches
  // any rename that landed while we were away, then this re-subscribes.
  useEffect(() => {
    if (!household || !appActive) return;
    const channel = supabase
      .channel(`household-${household.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${household.id}` },
        () => {
          sigRef.current = '';
          void refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [household?.id, refresh, appActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider');
  return ctx;
}
