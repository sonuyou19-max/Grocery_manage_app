import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

/**
 * The AI weekly recap: the client aggregates a snapshot (no raw history, just
 * counts + a few names), the edge function turns it into a friendly narrative,
 * and we cache it for the week so it only regenerates ~once every 7 days.
 */

export interface RecapPayload {
  itemCount: number;
  listCount: number;
  balance: Array<{ group: string; pct: number }>;
  topCategories: Array<{ label: string; count: number }>;
  staples: string[];
  lowItems: string[];
  spendEuros: number;
  pricedCount: number;
  members: number;
}

export async function generateRecap(payload: RecapPayload): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/weekly-recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { recap?: string };
    return data.recap?.trim() || null;
  } catch {
    return null;
  }
}

/** Current 7-day window index — changes once a week. */
export const weekKey = (d = new Date()): string => `${Math.floor(d.getTime() / (7 * 86_400_000))}`;

const CACHE_KEY = 'korb.weeklyRecap.v1';

interface CachedRecap {
  scope: string;
  week: string;
  text: string;
}

/** Returns this week's cached recap for the account scope, or null. */
export async function getCachedRecap(scope: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedRecap;
    return c.scope === scope && c.week === weekKey() ? c.text : null;
  } catch {
    return null;
  }
}

export async function setCachedRecap(scope: string, text: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ scope, week: weekKey(), text } satisfies CachedRecap));
  } catch {
    // best-effort
  }
}

// --- Shared (household) recap: one row per household, seen by every member ---

/** This household's stored recap, or null (also null before the table exists). */
export async function getSharedRecap(householdId: string): Promise<{ week: string; text: string } | null> {
  const { data, error } = await supabase
    .from('household_recaps')
    .select('week, text')
    .eq('household_id', householdId)
    .maybeSingle();
  if (error || !data) return null;
  return { week: data.week as string, text: data.text as string };
}

export async function setSharedRecap(householdId: string, text: string): Promise<void> {
  await supabase
    .from('household_recaps')
    .upsert(
      { household_id: householdId, week: weekKey(), text, updated_at: new Date().toISOString() },
      { onConflict: 'household_id' },
    );
}
