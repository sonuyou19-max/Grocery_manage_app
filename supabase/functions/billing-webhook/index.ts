// Supabase Edge Function: billing-webhook
//
// The only thing in the entire system permitted to grant Korb Plus.
//
// RevenueCat posts here on every subscription event — first purchase, renewal,
// cancellation, expiry, billing issue, refund. It writes one row per user in
// `subscriptions` (migration 0024), whose `current_period_end` is what
// `is_entitled()` reads. No client can reach that table: it has a SELECT policy
// and no INSERT, UPDATE or DELETE policy at all, so the absence of those
// policies is what makes a self-granted subscription impossible rather than
// merely discouraged.
//
// Deploy:  supabase functions deploy billing-webhook --no-verify-jwt
// Secrets: supabase secrets set REVENUECAT_WEBHOOK_SECRET=$(openssl rand -hex 32)
//
// --no-verify-jwt is REQUIRED and is not a weakening. RevenueCat is not a Korb
// user and has no Supabase token to present; if the platform rejects the
// request before it reaches this file, no subscription is ever recorded. The
// authentication that replaces it is the shared secret checked below, which is
// the scheme RevenueCat itself specifies.

import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Events that mean "this person has access until X".
 *
 * Deliberately a list of what grants, not a list of what revokes. Anything
 * unrecognised — a new event type RevenueCat adds next year, a test ping —
 * falls through and changes nothing, which is the safe direction: an unknown
 * event that quietly extended access would be a free subscription forever.
 *
 * CANCELLATION is on the list on purpose, and it surprises people. Cancelling
 * means "do not renew"; it does not mean "refund the rest of the month". The
 * user has paid through `expiration_at_ms` and keeps Plus until then, exactly
 * as the Terms say. The lapse happens on its own when that timestamp passes,
 * with no event required — which is the whole reason the schema stores an
 * expiry rather than a status.
 */
const GRANTING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'CANCELLATION',
  // Play's grace period after a failed payment. Access continues while Google
  // retries the card — locking someone out mid-retry punishes them for their
  // bank's timing, and Play will send EXPIRATION if it truly fails.
  'BILLING_ISSUE',
  'SUBSCRIPTION_EXTENDED',
]);

/**
 * Events that end access immediately, whatever the expiry says.
 *
 * A refund is not a lapse: the money has gone back, so the access goes with it
 * rather than running out the period that was paid for and then reversed.
 */
const REVOKING = new Set(['CANCELLATION_REFUND', 'REFUND', 'EXPIRATION', 'TRANSFER']);

interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  expiration_at_ms?: number | null;
  store?: string;
  id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constant-time string compare.
 *
 * A plain `===` on a secret leaks its length and, in principle, its prefix
 * through timing. The comparison here is cheap and the attack is exotic, but
 * this is the single check standing between the open internet and the table
 * that decides who has paid, so it is not the place to be relaxed.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
  // Fail closed. An unset secret must not mean "accept everything" — that is
  // the exact configuration mistake that turns a webhook into a public
  // "give me a subscription" endpoint.
  if (!secret) return new Response('Not configured', { status: 503 });

  const presented = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(presented, secret)) return new Response('Unauthorized', { status: 401 });

  const body = await req.json().catch(() => null);
  const event = (body?.event ?? {}) as RevenueCatEvent;
  const type = event.type ?? '';

  // The app user id IS the Supabase user id — set at Purchases.configure/logIn
  // (see lib/billing.ts), so there is no mapping table to be missing a row.
  // original_app_user_id is the fallback for an alias created before sign-in.
  const rawUser = event.app_user_id ?? event.original_app_user_id ?? '';
  if (!UUID.test(rawUser)) {
    // Anonymous RevenueCat ids ($RCAnonymousID:…) reach here when a purchase
    // somehow happened before the account was identified. There is nobody to
    // credit, and 200 stops RevenueCat retrying a message that can never
    // succeed. Retrying it forever would bury the real failures.
    return Response.json({ ok: true, skipped: 'not a korb user id' });
  }

  const granting = GRANTING.has(type);
  const revoking = REVOKING.has(type);
  if (!granting && !revoking) return Response.json({ ok: true, skipped: type });

  // Service role: this is the writer the RLS policies were written to exclude
  // everyone else from. It never leaves the function.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Revocation writes a past timestamp rather than deleting the row. Same
  // outcome for is_entitled(), but the history of what happened survives —
  // which is what you need when somebody writes in asking why their access
  // stopped.
  const periodEnd = revoking
    ? new Date().toISOString()
    : new Date(event.expiration_at_ms ?? Date.now()).toISOString();

  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: rawUser,
      current_period_end: periodEnd,
      store: event.store === 'APP_STORE' ? 'app_store' : 'play',
      external_id: event.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    // 500 so RevenueCat retries. A dropped RENEWAL would silently expire a
    // paying customer at the end of their period, and they would have no way
    // to tell that anything had gone wrong except losing access.
    console.error('subscriptions upsert failed', error.message);
    return new Response('Write failed', { status: 500 });
  }

  return Response.json({ ok: true, type, until: periodEnd });
});
