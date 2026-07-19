import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Tracks whether the app is in the foreground.
 *
 * Realtime subscriptions gate on this: when the app is backgrounded we tear the
 * websockets down (a phone with Korb swiped away shouldn't hold a paid-for
 * connection), and when it returns we reopen them and refetch once to catch up.
 * Supabase bills realtime on *peak concurrent connections*, so this keeps the
 * peak tracking people actually looking at Korb — not everyone who has it
 * installed and backgrounded.
 *
 * We only flip on the terminal 'active'/'background' states and ignore the
 * transient iOS 'inactive' state (app switcher, Control Center pull, an
 * incoming call) so brief interruptions don't churn every subscription.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') setActive(true);
      else if (state === 'background') setActive(false);
      // 'inactive' is transient on iOS — leave the current state untouched.
    });
    return () => sub.remove();
  }, []);

  return active;
}
