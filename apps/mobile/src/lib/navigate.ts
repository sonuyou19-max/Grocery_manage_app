import { router } from 'expo-router';

/**
 * Leave the current screen — without stranding anyone on it.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * Create an account, type your name, tap Done — and nothing happens. The screen
 * stays. In development the reason is on the console:
 *
 *     The action 'GO_BACK' was not handled by any navigator.
 *     Is there any screen to go back to?
 *
 * and in production that warning is silenced, so what ships is a Done button
 * that does nothing to somebody thirty seconds into their first use of the app.
 *
 * There was nothing to go back to. A first launch goes onboarding → REPLACE →
 * get-started → REPLACE → sign-in, and each replace swaps the screen rather
 * than stacking on it, so sign-in is the only entry in the history. The same
 * `back()` works perfectly when sign-in is opened from Settings, which is how
 * it was written and tested.
 *
 * ---------------------------------------------------------------------------
 * Why one function rather than a guard at each call site
 * ---------------------------------------------------------------------------
 *
 * The check already existed. `get-started` and `onboarding` both wrote
 * `if (router.canGoBack()) router.back(); else router.replace('/')` — and
 * get-started is the file that navigates TO sign-in, with a comment explaining
 * that the replace is deliberate so "sign-in's own back() lands on the
 * dashboard". Two files knew about the hazard, and the screen they hand off to
 * did not.
 *
 * Whether a screen has anything behind it is not a property of that screen. It
 * depends on how it was reached, and every one of these can be reached both
 * ways — pushed from a tab, or restored into as the first route after a cold
 * start. So the answer cannot live at the call sites; it lives here, and
 * check-navigate asserts nothing calls `router.back()` directly.
 *
 * Identical behaviour whenever there IS somewhere to go back to. The only
 * difference is the case that currently does nothing at all.
 */
export function goBack(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  /*
   * The lists tab, not a re-render of this screen. `replace` rather than
   * `push`, so the screen being left does not stay in the history to be
   * swiped back into — a sign-up screen you can return to after signing up is
   * its own small confusion.
   */
  router.replace('/');
}
