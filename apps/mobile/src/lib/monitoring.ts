/**
 * Crash & error monitoring seam.
 *
 * This module is provider-agnostic on purpose: the app reports through
 * `captureException`, and a reporter (Sentry) is plugged in at startup via
 * `setReporter` — but only when the native SDK is installed and a DSN is set.
 * Until then it's a safe no-op (plus a dev console log), so the app runs
 * unchanged in Expo Go and in builds without a DSN.
 *
 * ── Enabling Sentry (do this during the EAS build phase) ────────────────────
 *   1. Install:  npx expo install @sentry/react-native
 *   2. app.json → add the plugin:  "plugins": ["@sentry/react-native/expo"]
 *   3. Set EXPO_PUBLIC_SENTRY_DSN in your env / eas.json.
 *   4. In initMonitoring() below, replace the DSN-present branch with:
 *          const Sentry = require('@sentry/react-native');
 *          Sentry.init({ dsn: DSN, tracesSampleRate: 0.2, sendDefaultPii: false });
 *          setReporter((e, ctx) => Sentry.captureException(e, { extra: ctx }));
 *   (kept out of the bundle until the package exists so Metro doesn't fail).
 */

type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let reporter: Reporter | null = null;
let initialized = false;

/** Register the active crash reporter. Called once at startup when configured. */
export function setReporter(fn: Reporter): void {
  reporter = fn;
}

/** Whether a DSN is configured (used to decide if Sentry should be wired). */
export function monitoringEnabled(): boolean {
  return DSN.length > 0;
}

/** Initialise monitoring once at app start. No-op until a reporter is wired. */
export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;
  // Intentionally empty until Sentry is enabled (see header). Reading the DSN
  // here keeps the seam ready without importing a package that may be absent.
  if (__DEV__ && !monitoringEnabled()) {
    // eslint-disable-next-line no-console
    console.log('[monitoring] no DSN set — crash reporting disabled');
  }
}

/** Report a handled error. Safe everywhere; never throws. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[monitoring]', error, context ?? '');
  }
  try {
    reporter?.(error, context);
  } catch {
    // reporting must never crash the app
  }
}
