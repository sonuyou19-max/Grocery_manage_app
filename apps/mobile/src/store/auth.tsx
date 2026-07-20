import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Authentication. Sign-in is optional — the app works fully logged-out with
 * local data; signing in unlocks household sharing and sync. Session is
 * persisted by the Supabase client (AsyncStorage).
 *
 * The production sign-in is passwordless email codes (sendCode / verifyCode),
 * which requires a working email sender in Supabase (Auth → SMTP). The
 * password methods are kept as a fallback but are no longer used by the UI.
 */

interface AuthContext {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  /** Send a 6-digit login code to the email. */
  sendCode: (email: string) => Promise<{ error?: string }>;
  /** Verify the code and start a session. */
  verifyCode: (email: string, token: string) => Promise<{ error?: string }>;
  /** Create an account with email + password. */
  signUpPassword: (email: string, password: string) => Promise<{ error?: string }>;
  /** Sign in with email + password. */
  signInPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /** Permanently delete the account and all its data, then sign out. */
  deleteAccount: () => Promise<{ error?: string }>;
}

const Ctx = createContext<AuthContext | null>(null);

/** Turn raw/verbose auth errors into a short, human message. */
function cleanError(raw: unknown, fallback: string): string {
  const msg = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
  if (!msg) return fallback;
  // A JSON blob or a huge string means an unexpected server/transport failure.
  if (msg.trim().startsWith('{') || msg.length > 140) return fallback;
  if (/otp|magic link|email/i.test(msg) && /send|deliver|smtp|500/i.test(msg)) {
    return 'Couldn’t send the code — email delivery failed. Check your SMTP settings and try again.';
  }
  return msg;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContext>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      sendCode: async (email) => {
        try {
          const { error } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: true },
          });
          if (error) {
            return { error: cleanError(error, 'Couldn’t send the code — email delivery failed. Check your SMTP settings and try again.') };
          }
          return {};
        } catch (e) {
          return { error: cleanError(e, 'Couldn’t reach the server. Check your connection and try again.') };
        }
      },
      verifyCode: async (email, token) => {
        try {
          const { error } = await supabase.auth.verifyOtp({
            email: email.trim(),
            token: token.trim(),
            type: 'email',
          });
          if (error) {
            return { error: cleanError(error, 'That code didn’t work. Check it and try again.') };
          }
          return {};
        } catch (e) {
          return { error: cleanError(e, 'Couldn’t reach the server. Check your connection and try again.') };
        }
      },
      signUpPassword: async (email, password) => {
        try {
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
          });
          if (error) return { error: cleanError(error, 'Couldn’t create the account.') };
          if (!data.session) {
            return {
              error:
                'Account made, but email confirmation is on. Turn off “Confirm email” in Supabase → Authentication → Providers → Email, then try again.',
            };
          }
          return {};
        } catch (e) {
          return { error: cleanError(e, 'Couldn’t reach the server. Check your connection and try again.') };
        }
      },
      signInPassword: async (email, password) => {
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) return { error: cleanError(error, 'Couldn’t sign in. Check your email and password.') };
          return {};
        } catch (e) {
          return { error: cleanError(e, 'Couldn’t reach the server. Check your connection and try again.') };
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      deleteAccount: async () => {
        try {
          const { error } = await supabase.rpc('delete_account');
          if (error) return { error: cleanError(error, 'Couldn’t delete your account. Please try again.') };
          // The account is gone; drop the now-invalid session locally.
          await supabase.auth.signOut();
          return {};
        } catch (e) {
          return { error: cleanError(e, 'Couldn’t reach the server. Check your connection and try again.') };
        }
      },
    }),
    [session, initializing],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
