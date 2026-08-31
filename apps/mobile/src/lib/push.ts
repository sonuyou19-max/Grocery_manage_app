import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { reportWriteFailure } from '@/lib/monitoring';

/**
 * Push notifications, for the two moments somebody is waiting on somebody else.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE PERMISSION IS ASKED FOR, which is the whole design
 * ---------------------------------------------------------------------------
 *
 * Not on launch. A prompt on first open is a question with no context attached
 * — the person has not yet seen anything that a notification could be about —
 * and it gets refused, once, permanently. iOS never asks again, and Android's
 * second refusal is the same. One badly-timed prompt is the difference between
 * a feature that works and one that cannot be turned on without a trip to the
 * system settings.
 *
 * So it is asked at exactly two moments, both of which have just made the
 * answer obvious:
 *
 *   - You created a household. You are its owner, and the thing you will be
 *     notified about is somebody asking to join it.
 *   - You asked to join one. The thing you will be notified about is the answer
 *     you are now waiting for.
 *
 * A shopper who never touches households is never asked, and should not be:
 * there is nothing in a solo pantry that anybody needs to be interrupted for.
 *
 * ---------------------------------------------------------------------------
 * Refusing is a complete answer
 * ---------------------------------------------------------------------------
 *
 * Nothing here nags, re-asks, or degrades. The in-app queue and the waiting
 * card are the actual mechanism — see JoinRequests and PendingJoins — and they
 * work identically for somebody who said no. A notification makes them prompt;
 * it is not what makes them work.
 */

/**
 * expo-notifications, loaded ONLY if this binary actually contains it.
 *
 * ---------------------------------------------------------------------------
 * The failure this avoids, which is worse than no notifications
 * ---------------------------------------------------------------------------
 *
 * This is a NATIVE module, and the app ships JavaScript over the air. So there
 * is a window — every time push is added, and every time somebody skips a
 * build — where a new bundle runs on an older binary that has no such native
 * module in it. A top-level `import * as Notifications` in that situation does
 * not degrade: it throws while the module graph is still being evaluated, and
 * this file is reached from the household store, which is in the provider tree.
 * The app fails to start.
 *
 * A feature that cannot work on an old binary is fine. A feature that stops the
 * old binary from opening is not, and it would take out every OTHER fix in the
 * same update with it.
 *
 * So the import is a require inside a try, resolved on first use. On a binary
 * with the module this is one lazy load; on one without, `push()` is null,
 * every function here returns quietly, and the in-app queue — which is what
 * actually makes the feature work — is untouched.
 */
type PushModule = typeof import('expo-notifications');

let loaded: PushModule | null | undefined;
function notifications(): PushModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as PushModule;
    /*
     * How a notification behaves while the app is open: banner and sound,
     * rather than the silent default. Every one of these is about a person
     * waiting on another person, and an owner with Korb open when a request
     * lands is the best possible case for answering it now.
     *
     * Set here rather than at module scope, because module scope is exactly
     * where an absent native module takes the whole app down.
     */
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    loaded = mod;
  } catch {
    loaded = null;
  }
  return loaded;
}

/**
 * Ask, register, and remember the token.
 *
 * Returns quietly on every failure — no permission, a simulator with no push
 * capability, a project id missing from the build. There is nothing a person
 * can do about any of them and nothing the app should say.
 *
 * `language` travels with the token because the message is composed on the
 * server long after this app has closed. See device_tokens.language.
 */
export async function registerForPush(language: string): Promise<void> {
  const Notifications = notifications();
  // An older binary, running a newer bundle. Everything else in this update
  // works; this one thing waits for a build.
  if (!Notifications) return;

  try {
    /*
     * Android needs a channel to exist before anything can arrive in it, and it
     * is created here rather than at launch for the same reason the permission
     * is: a device that never joins a household never needs one.
     */
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('households', {
        name: 'Households',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    /*
     * Only ever asked when the answer is not already recorded. `canAskAgain`
     * false means they have refused before, and calling again is a no-op that
     * looks like a bug when you are watching for the prompt.
     */
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return;

    /*
     * The project id passed explicitly rather than left to the manifest.
     *
     * expo-notifications can find it on its own in a built app, and cannot in
     * every development configuration — and the failure is a throw, which the
     * catch below swallows. Reading it here means the one case that would look
     * like "push silently does not work" is instead the one case that works
     * everywhere.
     */
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )).data;
    if (!token) return;

    const { data: session } = await supabase.auth.getUser();
    const userId = session.user?.id;
    if (!userId) return;

    /*
     * Upserted on (user_id, token), so reopening the app re-registers the same
     * row rather than growing the table, and a language changed in Settings
     * reaches the server the next time this runs.
     */
    const { error } = await supabase.from('device_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: Platform.OS,
        language,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
    reportWriteFailure('device_tokens.upsert', error);
  } catch {
    /*
     * Swallowed on purpose, and this is the one catch in the app that reports
     * nothing. `getExpoPushTokenAsync` throws on a simulator, in Expo Go, and
     * in any build without a project id — none of which is a fault, all of
     * which are the normal state of a development machine, and reporting them
     * would bury the real failures in noise.
     */
  }
}

/**
 * Tell the server that something worth a notification has happened.
 *
 * The request id and nothing else. Who to notify, what to say and whether it
 * has already been said are all decided server-side from that one id — see
 * functions/notify-join, where the reasoning for that is written out. A client
 * that could name its own recipients would be an open relay.
 *
 * Fire and forget. The write this follows has already succeeded, and a failed
 * notification must never turn a completed join into an error on screen.
 */
export function nudgeJoin(requestId: string): void {
  void supabase.functions.invoke('notify-join', { body: { requestId } }).catch(() => {});
}
