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
