import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CoachMarkOverlay, type CoachMarkContent } from '@/components/coach-mark';

/**
 * Where coach marks are actually drawn: once, at the root, above everything.
 *
 * A tip rendered inside its own screen can only dim that screen. The tab bar
 * belongs to the navigator and the status bar area to the window, so both
 * stayed lit while the rest went dark — the spotlight read as a panel over the
 * page rather than a light on one row.
 *
 * The obvious fix, a <Modal>, is the one that must not be used: on Android it
 * is a separate native window, and the overlay positions itself from a rect
 * measured in the screen's window (see coach-mark.tsx). Crossing windows is
 * what put the spotlight on the wrong row in the first place.
 *
 * So the overlay moves UP the same tree instead of out of it. Rendered as the
 * last child at the root it paints over the navigator and the safe areas, and
 * it is still in one window, so measuring its own origin and subtracting keeps
 * working exactly as before.
 */

interface HostApi {
  set: (content: CoachMarkContent | null) => void;
}

const Ctx = createContext<HostApi | null>(null);

export function CoachMarkHost({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<CoachMarkContent | null>(null);
  const api = useMemo<HostApi>(() => ({ set: setContent }), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {content && <CoachMarkOverlay content={content} />}
    </Ctx.Provider>
  );
}

/**
 * Publish a coach mark to the host, or clear it.
 *
 * The handlers are held in a ref and re-read through stable wrappers, so a
 * parent re-render does not churn the host's state and restart the overlay's
 * entrance animation mid-tip.
 */
export function useCoachMarkPortal(content: CoachMarkContent | null) {
  const api = useContext(Ctx);
  const latest = useRef(content);
  latest.current = content;

  // Only the identity-stable parts of the content take part in the dependency
  // list; everything else is read through the ref at call time.
  const key = content
    ? `${content.textKey}|${content.gesture}|${content.rect.x},${content.rect.y},${content.rect.width},${content.rect.height}`
    : null;

  useEffect(() => {
    if (!api) return;
    if (key === null) {
      api.set(null);
      return;
    }
    const c = latest.current!;
    api.set({
      rect: c.rect,
      textKey: c.textKey,
      gesture: c.gesture,
      onDismiss: () => latest.current?.onDismiss(),
      onSkipAll: () => latest.current?.onSkipAll(),
    });
    return () => api.set(null);
  }, [api, key]);
}
