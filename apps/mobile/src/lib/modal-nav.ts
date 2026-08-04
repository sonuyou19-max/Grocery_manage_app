import { useCallback, useEffect, useRef } from 'react';

/**
 * Do a thing AFTER the react-native <Modal> you are inside has gone.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to stop happening a fourth time
 * ---------------------------------------------------------------------------
 *
 * On Android a <Modal> is its own native window, not a view in the tree. Push a
 * route while one is up and the navigation lands underneath it; what the user
 * gets is a blank screen with no way back. It has now happened three times, in
 * three unrelated features, written weeks apart:
 *
 *   The recipe review sheet confirmed an import and navigated to the new list
 *   in the same commit that unmounted itself.
 *
 *   The create sheet called onClose() and pushed /recipe on the next line. That
 *   one was latent for as long as closing was synchronous, and became a crash
 *   the moment the sheet grew an exit animation — the close now takes 160ms and
 *   the push did not wait for it.
 *
 *   The staple sheet's Purchase History row called requirePlus() for a free
 *   account without closing the sheet first. The unlocked branch DID close it,
 *   and a comment above it explains why, which is the clearest possible sign
 *   that knowing about the hazard is not enough to avoid it.
 *
 * Three sites, three authors' worth of care, three failures. So the ordering
 * stops being something each call site remembers and becomes something the type
 * signature enforces: you cannot express "navigate now" here, only "navigate
 * once this is closed".
 *
 * ---------------------------------------------------------------------------
 * Why it keys on a boolean instead of just deferring a frame
 * ---------------------------------------------------------------------------
 *
 * setTimeout(nav, 300) would paper over all three, and it would be wrong in the
 * way that matters: it encodes a guess about how long a dismissal takes, and it
 * is the animation duration — a design decision — that would silently break it
 * again. `open` is the same expression that drives the Modal's own mounting, so
 * the deferred action runs exactly when the Modal is really gone and never
 * earlier, whatever anyone does to the animation later.
 *
 * The extra frame after that is for the native window teardown, which happens
 * off the JS thread and which React knows nothing about.
 *
 *     const whenClosed = useDeferUntilClosed(stapleKey != null);
 *     …
 *     whenClosed(() => requirePlus());
 *     setStapleKey(null);
 *
 * Order does not matter between those last two — the action is held until the
 * flag actually goes false, so queueing it first is safe and reads better.
 */
export function useDeferUntilClosed(open: boolean): (action: () => void) => void {
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open || !pending.current) return;
    const run = pending.current;
    // Cleared before running, not after: a queued action that itself navigates
    // can unmount this component, and a stale ref would then fire twice.
    pending.current = null;
    const frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return useCallback((action: () => void) => {
    pending.current = action;
  }, []);
}
