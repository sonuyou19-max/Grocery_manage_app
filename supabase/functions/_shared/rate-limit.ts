// Spend cap for the AI edge functions.
//
// Replaces the call counter from 0010. The unit is money, the bucket prefers
// the signed-in user over the client IP, and there is now a ceiling across all
// callers — see migration 0022 for why each of those changed.
//
// Usage is two-phase. Before the model call:
//
//     const guard = await reserveBudget(req, 'categorize', promptText, MAX_TOKENS);
//     if (guard.denied) return guard.denied;
//
// ...and after it returns, with the real figures off the response:
//
//     await guard.settle(message.usage);
//
// Skipping settle() is safe in the direction that matters: the worst-case
// reservation simply stands for the rest of the UTC day. Skipping it often
// would make the cap bite early, which is why every path settles.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { capsFromEnv, costMicros, verdict, worstCaseMicros } from './ai-cost.ts';

/**
 * Best-effort client IP from the proxy headers Supabase forwards.
 *
 * Exported because the lexicon needs the same value: it is the only stable
 * per-caller identifier available for a signed-out caller, and it is hashed
 * with a secret salt before it goes anywhere near the database (see
 * _shared/lexicon.ts).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Who to bill: the signed-in user if the client sent its session token,
 * otherwise the IP.
 *
 * Why this matters more than it looks. An IP bucket is simultaneously too
 * strict and too loose: carrier-grade NAT hides an entire mobile network behind
 * one address, so a cap sized for one abuser throttles a city, while any VPN
 * hands an abuser a fresh bucket per request. A user id fixes both — it follows
 * the person across networks, and rotating it costs a signup.
 *
 * The JWT payload is read WITHOUT verifying the signature. That is safe only
 * because the Supabase gateway verifies it before this function runs (the
 * default; these are not deployed with --no-verify-jwt). If that ever changed,
 * a forged `sub` would buy a fresh bucket — no worse than the IP rotation
 * available today, and still caught by the global ceiling, but the guarantee
 * would be gone. Do not disable JWT verification on these functions.
 */
export function callerBucket(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      // Base64URL, and atob is strict about padding.
      const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
      const claims = JSON.parse(atob(padded)) as { sub?: string; role?: string };
      // The anon key is itself a valid JWT, with role 'anon' and no subject.
      // Only a real end-user session carries both.
      if (claims.role === 'authenticated' && claims.sub) return `user:${claims.sub}`;
    } catch {
      // Malformed token — fall through to the IP.
    }
  }
  return `ip:${clientIp(req)}`;
}

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}

interface BudgetRow {
  caller_micros: number;
  global_micros: number;
  fn_calls: number;
}

/** One atomic move against the ledger. Null when the RPC failed. */
async function adjust(
  bucket: string,
  fn: string,
  micros: number,
  input = 0,
  output = 0,
  calls = 0,
): Promise<BudgetRow | null> {
  try {
    const { data, error } = await adminClient().rpc('adjust_ai_budget', {
      p_bucket: bucket,
      p_fn: fn,
      p_delta_micros: micros,
      p_delta_input: input,
      p_delta_output: output,
      p_delta_calls: calls,
    });
    if (error || !data) return null;
    // The RPC returns a one-row table.
    const row = (Array.isArray(data) ? data[0] : data) as BudgetRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export interface Guard {
  /** Non-null when the request must be refused; return it as-is. */
  denied: Response | null;
  /** Reconcile the worst-case reservation against what the call really used. */
  settle: (usage?: { input_tokens?: number; output_tokens?: number }) => Promise<void>;
}

const ALLOWED: Guard = { denied: null, settle: async () => {} };

/**
 * Reserve this call's worst-case cost and decide whether it may proceed.
 *
 * **This fails CLOSED**, deliberately reversing how 0010 behaved. Failing open
 * is right when a limiter's job is fairness — better to serve everyone than to
 * lock them out over a hiccup. It is wrong when the job is to stop a bill: a
 * cost control that stops working must stop the spending, not stop the
 * checking, because the failure it exists to prevent is exactly "nobody
 * noticed for six hours". A brief AI outage is recoverable; an uncapped bill is
 * not.
 *
 * `AI_LIMITER_FAIL_OPEN=1` restores the old behaviour as a documented escape
 * hatch, for an emergency where the ledger is broken and the spend is known to
 * be fine. It is not a default and should not quietly become one.
 */
export async function reserveBudget(
  req: Request,
  fn: string,
  promptText: string,
  maxTokens: number,
): Promise<Guard> {
  const bucket = callerBucket(req);
  const caps = capsFromEnv(fn, (k) => Deno.env.get(k));
  const reserved = worstCaseMicros(promptText, maxTokens);

  const totals = await adjust(bucket, fn, reserved, 0, 0, 1);

  if (!totals) {
    if (Deno.env.get('AI_LIMITER_FAIL_OPEN') === '1') return ALLOWED;
    return {
      denied: Response.json(
        { error: 'AI is briefly unavailable. Please try again shortly.' },
        { status: 503 },
      ),
      settle: async () => {},
    };
  }

  const call = verdict(
    {
      callerMicros: totals.caller_micros,
      globalMicros: totals.global_micros,
      fnCalls: totals.fn_calls,
    },
    caps,
  );

  if (!call.allowed) {
    // Hand the reservation back — a refused request costs nothing, and keeping
    // the charge would push the caller further over on every retry, turning a
    // one-day limit into a permanent one.
    await adjust(bucket, fn, -reserved, 0, 0, -1);
    const globalTrip = call.reason === 'global_budget';
    return {
      denied: Response.json(
        {
          error: globalTrip
            ? 'AI features are paused for today. Please try again tomorrow.'
            : 'Daily limit reached. Please try again tomorrow.',
          reason: call.reason,
        },
        // 503 for the global breaker: that is our ceiling, not this caller's
        // fault, and a 429 would tell them to slow down when they have done
        // nothing wrong.
        { status: globalTrip ? 503 : 429 },
      ),
      settle: async () => {},
    };
  }

  return {
    denied: null,
    settle: async (usage) => {
      const input = usage?.input_tokens ?? 0;
      const output = usage?.output_tokens ?? 0;
      const actual = costMicros(input, output);
      // The delta refunds the unused portion of the reservation and records the
      // true token counts for the daily report. Calls are not adjusted: the
      // call happened.
      await adjust(bucket, fn, actual - reserved, input, output, 0);
    },
  };
}

/**
 * Call-count-only guard, for a caller with no prompt to size.
 *
 * Kept so a half-deployed rollout degrades to the old behaviour rather than to
 * no guard at all. Everything with a model call behind it should use
 * reserveBudget instead — this one cannot see spend.
 */
export async function rateLimit(req: Request, fn: string): Promise<Response | null> {
  const caps = capsFromEnv(fn, (k) => Deno.env.get(k));
  const totals = await adjust(callerBucket(req), fn, 0, 0, 0, 1);
  if (!totals) return null;
  if (totals.fn_calls > caps.fnCalls) {
    return Response.json(
      { error: 'Daily limit reached. Please try again tomorrow.' },
      { status: 429 },
    );
  }
  return null;
}
