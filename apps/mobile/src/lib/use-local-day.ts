import { useEffect, useState } from 'react';

import { useAppActive } from '@/lib/use-app-active';

/**
 * The start of today, local time, as epoch ms — and a re-render when that
 * changes.
 *
 * The list sweep (lib/list-sweep.ts) settles a ticked item at the end of the
 * day it was ticked on, which means the answer to "what is on this list?"
 * changes at midnight with no user action and no data change. Nothing would
 * re-render for that on its own: React has no reason to, and a component that
 * read Date.now() during render would keep the value it captured until
 * something unrelated woke it up. A shop finished at 9pm would still be sitting
 * on the list at 9am, and would clear the instant the user typed something.
 *
 * Two triggers, because either alone leaves a real gap:
 *
 *   - a timer to the next local midnight, for an app left open overnight;
 *   - the app coming back to the foreground, because timers do not fire
 *     reliably on a suspended Android process, so the timer above is exactly
 *     the thing that will not have run.
 *
 * Emitting the day's START rather than `now` is what keeps this cheap: the
 * value is stable for twenty-four hours, so memos keyed on it hold all day.
 */
const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function useLocalDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()));
  const active = useAppActive();

  useEffect(() => {
    // Re-checked on every wake, not just on the timer: see above.
    setDay((prev) => {
      const today = startOfLocalDay(Date.now());
      return today === prev ? prev : today;
    });

    /*
     * setTimeout takes a delay, not a deadline, so this is re-armed from the
     * current clock each time rather than scheduled once for 24h out — a device
     * whose timezone or clock changes mid-day would otherwise fire at the wrong
     * moment and stay wrong. +1s of slack so the timer cannot land a hair
     * before midnight and compute yesterday.
     */
    const nextMidnight = startOfLocalDay(Date.now()) + 24 * 60 * 60 * 1000 + 1000;
    const id = setTimeout(() => setDay(startOfLocalDay(Date.now())), nextMidnight - Date.now());
    return () => clearTimeout(id);
  }, [active, day]);

  return day;
}
