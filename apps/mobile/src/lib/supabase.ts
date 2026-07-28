import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

/**
 * Project URL and anon/publishable key are safe to commit: they ship inside
 * every user's app bundle regardless, and access is enforced by the
 * database's row-level security policies, not by hiding these values.
 * EXPO_PUBLIC_* env vars override them for pointing at a different project
 * (e.g. staging) without touching this file.
 */
const KORB_SUPABASE_URL = 'https://vtgmvamwspqnrmdliqhh.supabase.co';
const KORB_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Z212YW13c3BxbnJtZGxpcWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjQ4NzgsImV4cCI6MjA5OTk0MDg3OH0.GsLH0c3Wh38fHZiMcM5MLN7LyZaabSldMxeJdfmsoyQ';

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? KORB_SUPABASE_URL;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? KORB_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Headers for a call to an AI edge function.
 *
 * Sends the signed-in user's access token rather than the anon key, so the
 * server can meter spend per PERSON. Metering by IP alone is both too strict
 * and too loose — carrier-grade NAT puts a whole mobile network behind one
 * address, while any VPN hands out a fresh identity per request. See
 * functions/_shared/rate-limit.ts.
 *
 * Falls back to the anon key when signed out, which is the correct token for a
 * guest and keeps the app working exactly as before for them.
 *
 * getSession() reads from storage and refreshes if needed, so this is async;
 * every caller already awaits a network round trip, so the cost is invisible.
 */
export async function aiFunctionHeaders(): Promise<Record<string, string>> {
  let token = supabaseAnonKey;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    // Signed out, or storage unavailable — the anon key is the right answer.
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
