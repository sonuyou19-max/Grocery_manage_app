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

/**
 * Record which screen the user is on.
 *
 * Added because the reports coming back were not answerable. A native crash or
 * an ANR carries a native stack and a list of network calls, and nothing that
 * says what the person was actually doing — every screen in this app fetches
 * the same few tables, so "GET shopping_lists" narrows it down to "the app was
 * open". Two of the three issues in the first batch took a full read of the
 * codebase to place, and one of those was only placeable because the fetches
 * happened to bracket the moment precisely.
 *
 * Recorded two ways, because they answer different questions:
 *
 *  - a **breadcrumb**, so the report shows the path through the app that led to
 *    the failure, not just where it ended;
 *  - a **tag**, so the last screen is a filterable field — "every ANR on the
 *    scan step" is then one search rather than a manual read of every event.
 *
 * The value is the route PATTERN, not the resolved URL: `/list/[id]`, never
 * `/list/6f2c…`. That is deliberate on both counts. It groups — a hundred
 * crashes on a hundred different lists are one issue, and as resolved paths
 * they would be a hundred tag values, which is also how you exhaust Sentry's
 * tag cardinality. And it means no household or list identifier leaves the
 * device through this channel, which keeps it consistent with
 * `sendDefaultPii: false` above.
 */
export function trackRoute(route: string): void {
  try {
    Sentry.addBreadcrumb({ category: 'navigation', level: 'info', message: route });
    Sentry.setTag('route', route);
  } catch {
    // Same rule as captureException: telemetry never breaks navigation.
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
