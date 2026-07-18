import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/lib/supabase';
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
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
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
      setHousehold(h);

      if (h) {
        const { data: rows } = await supabase
          .from('household_members')
          .select('user_id, role, display_name')
          .eq('household_id', h.id);
        setMembers((rows as Member[] | null) ?? []);
      } else {
        setMembers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider');
  return ctx;
}
