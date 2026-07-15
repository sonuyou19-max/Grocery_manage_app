import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Scaffold phase: the app runs without a backend; queries are wired up later.
  console.warn(
    'Supabase env vars missing — copy .env.example to .env and fill in your project values.',
  );
}

export const supabase = createClient(supabaseUrl ?? 'http://localhost:54321', supabaseAnonKey ?? 'anon', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
