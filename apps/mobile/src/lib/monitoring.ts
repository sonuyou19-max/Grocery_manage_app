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

/**
 * A write to the server failed and the user was not told.
 *
 * ---------------------------------------------------------------------------
 * Why this needs to exist
 * ---------------------------------------------------------------------------
 *
 * Every mutation in this app is optimistic: the row appears the instant you tap,
 * and the network call follows. When that call fails the store re-reads from the
 * server, so the optimistic row quietly disappears and the screen goes back to
 * the truth. That recovery is correct — the alternative is a UI that insists on
 * a row the database never accepted — but it is also completely silent. The
 * user sees an item they added not be there, and nobody else ever learns it
 * happened.
 *
 * The unique-violation case makes the point. `recoverFrom` has always had a
 * branch for SQLSTATE 23505, so the code has always KNOWN this occurs, and said
 * nothing. Some of those are the deliberate two-members-added-the-same-thing
 * race that migration 0018 pushes onto the database — a steady trickle there is
 * the design working. A spike is not: it is the client and the database
 * disagreeing about what counts as the same item, which is exactly the kind of
 * fault that never reproduces on the developer's phone.
 *
 * ---------------------------------------------------------------------------
 * What is sent, and what is deliberately not
 * ---------------------------------------------------------------------------
 *
 * `op` is a fixed string per call site (`list_items.insert`), never
 * interpolated, so one issue in Sentry means one code path. `code` is the
 * SQLSTATE. `message` is Postgres's own summary, which names the constraint
 * rather than the data.
 *
 * `details` and `hint` are dropped on purpose: PostgREST puts the offending
 * VALUES in them — `Key (list_id, item_key)=(…, milk) already exists` — and
 * that is the user's shopping list leaving the device through the crash
 * reporter. Same reason trackRoute sends `/list/[id]` and not the id.
 */
export function reportWriteFailure(
  op: string,
  error: { code?: string; message?: string } | null | undefined,
): void {
  if (!error) return;
  // An Error, not the raw object: Sentry groups by stack and message, and a
  // bare `{code, message}` from PostgREST collapses every failure in the app
  // into one unreadable issue.
  captureException(new Error(`write failed: ${op}`), {
    op,
    code: error.code ?? 'unknown',
    message: error.message ?? '',
  });
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
