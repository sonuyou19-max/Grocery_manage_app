import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/store/auth';

/**
 * The name you're known by, asked once at sign-up.
 *
 * It used to be asked on the household screen, which meant typing it again for
 * every household you created — the same answer, five times. It belongs to the
 * person, not to the household, so it's captured with the account and reused.
 *
 * The server's copy lives on `household_members.display_name`, which is the
 * source of truth for what other members see — but it only exists once you're
 * in a household, and this has to work *before* that. So the name is also kept
 * on-device, keyed per user (a shared device must not leak one person's name
 * into another's sign-up), and pushed to the server as soon as there's a
 * membership to put it on.
 */

const keyFor = (userId: string) => `korb.profileName.v1.${userId}`;

/**
 * Everyone currently reading the name.
 *
 * Each useProfileName() call owns its own useState, so without this a write
 * from one caller is invisible to the others until something remounts them.
 * That is not hypothetical: the name is typed on the sign-in screen but the
 * dashboard greeting reads it through the household store, and the two are
 * different instances of this hook — the greeting would have stayed nameless
 * until the next launch. AsyncStorage has no change event, so the broadcast
 * has to be ours.
 */
type Listener = (userId: string, name: string) => void;
const listeners = new Set<Listener>();

/**
 * Read a user's remembered name outside React.
 *
 * Used the instant a sign-in completes, when the auth context hasn't re-rendered
 * with the new user yet — passing the id explicitly avoids racing that update
 * and reading the previous (or no) user's slot.
 */
export async function readProfileName(userId: string): Promise<string> {
  try {
    return ((await AsyncStorage.getItem(keyFor(userId))) ?? '').trim();
  } catch {
    return '';
  }
}

/** Write a user's name outside React. See readProfileName for why. */
export async function writeProfileName(userId: string, name: string): Promise<void> {
  const clean = name.trim();
  try {
    if (clean) await AsyncStorage.setItem(keyFor(userId), clean);
    else await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Best-effort: losing the cache costs one extra prompt, not the account.
  }
  // Told even if the write threw: the name is right in memory for this session
  // either way, and a silently un-greeted user is the worse failure.
  for (const notify of listeners) notify(userId, clean);
}

export interface ProfileName {
  /** The remembered name, or '' before one is known (or while loading). */
  name: string;
  /** False until storage has been read, so callers don't act on a false empty. */
  ready: boolean;
  /** Remember a name for this user. Trimmed; empty clears it. */
  remember: (next: string) => Promise<void>;
}

export function useProfileName(): ProfileName {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setName('');
    if (!userId) {
      // Signed out there is no name to remember — that state is "ready" too,
      // otherwise a signed-out caller waits forever.
      setReady(true);
      return () => {
        alive = false;
      };
    }
    AsyncStorage.getItem(keyFor(userId))
      .then((raw) => {
        if (alive) setName(raw ?? '');
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Stay in step with writes made through any other instance of this hook.
  useEffect(() => {
    if (!userId) return;
    const notify: Listener = (id, next) => {
      if (id === userId) setName(next);
    };
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, [userId]);

  const remember = useCallback(
    async (next: string) => {
      // Signed out there is nowhere to persist it, so the local state is all
      // there is; signed in, writeProfileName broadcasts and sets it for us.
      if (userId) await writeProfileName(userId, next);
      else setName(next.trim());
    },
    [userId],
  );

  return { name, ready, remember };
}

/**
 * Drop a user's remembered name — called on sign-out and account deletion.
 *
 * Goes through writeProfileName so the clear is broadcast like any other
 * change; a listener still holding the old name would greet the next person to
 * sign in on this device by the previous one's name.
 */
export async function forgetProfileName(userId: string): Promise<void> {
  await writeProfileName(userId, '');
}
