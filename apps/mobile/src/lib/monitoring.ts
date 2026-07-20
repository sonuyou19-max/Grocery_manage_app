import * as Sentry from '@sentry/react-native';

/**
 * Crash & error monitoring.
 *
 * The app reports through `captureException`; Sentry is the active reporter,
 * wired up in `initMonitoring` when a DSN is present. It stays fully dormant
 * until `EXPO_PUBLIC_SENTRY_DSN` is set (e.g. via an EAS build secret), so the
 * app runs unchanged in Expo Go and in builds without a DSN — importing the
 * package alone does nothing until `Sentry.init` is called.
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

/** Initialise monitoring once at app start. No-op until a DSN is configured. */
export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;
  if (!monitoringEnabled()) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[monitoring] no DSN set — crash reporting disabled');
    }
    return;
  }
  try {
    Sentry.init({ dsn: DSN, tracesSampleRate: 0.2, sendDefaultPii: false });
    setReporter((e, ctx) => Sentry.captureException(e, { extra: ctx }));
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[monitoring] Sentry init failed', err);
    }
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
