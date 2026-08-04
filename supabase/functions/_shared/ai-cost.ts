// The arithmetic behind the AI spend cap. Pure — no Deno, no network, no
// database — so check-ai-cost.mjs can exercise every branch of it, which
// matters more here than usual: this is the code that decides whether a bill
// can run away, and every one of its failure modes is silent.

/**
 * Haiku 4.5 list pricing, expressed as micro-USD (millionths of a dollar) per
 * token. $1.00 per million input tokens is exactly 1 micro-USD per token,
 * which is why these numbers look suspiciously round — the unit was chosen so
 * they would be, and so the whole ledger stays in integers. Floating-point
 * money in a spend cap is how a cap silently drifts.
 *
 * VERIFY THESE against current pricing before trusting the ceiling; they are
 * overridable at runtime (see capsFromEnv) precisely so a price change does not
 * need a code deploy to stay honest.
 */
export const INPUT_MICROS_PER_TOKEN = 1;
export const OUTPUT_MICROS_PER_TOKEN = 5;

/**
 * Rough token count for a string.
 *
 * Four characters per token is the usual English approximation and is wrong in
 * both directions — worse for the non-Latin scripts this app ships in. It is
 * only ever used for the pre-flight RESERVATION, which is reconciled against
 * the real usage figures the moment the model replies, so an inaccurate guess
 * costs a few seconds of over-reservation and nothing else. It is deliberately
 * biased high (ceil, plus a fixed overhead for message framing) because
 * over-reserving is self-correcting and under-reserving is not.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 8;
}

/** What a call actually cost, in micro-USD. Integer in, integer out. */
export function costMicros(inputTokens: number, outputTokens: number): number {
  const inTok = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.round(inputTokens) : 0;
  const outTok = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.round(outputTokens) : 0;
  return inTok * INPUT_MICROS_PER_TOKEN + outTok * OUTPUT_MICROS_PER_TOKEN;
}

/**
 * The most a call could possibly cost, charged before it is made.
 *
 * `maxTokens` is a hard ceiling the API enforces, so output cannot exceed it.
 * Input is estimated. Reserving the worst case and refunding the difference is
 * what makes the cap safe under concurrency: a thousand simultaneous requests
 * each reserve before any of them settles, so they cannot all slip through a
 * check that only looks at already-recorded spend.
 */
export function worstCaseMicros(promptText: string, maxTokens: number): number {
  return costMicros(estimateTokens(promptText), maxTokens);
}

export interface Caps {
  /** Per-caller daily spend, across every function. */
  callerMicros: number;
  /** Everyone's daily spend, together. The actual protection against a bill. */
  globalMicros: number;
  /** Per-caller daily call count for this one function. Secondary guard. */
  fnCalls: number;
}

export interface Totals {
  callerMicros: number;
  globalMicros: number;
  fnCalls: number;
}

export type DenyReason = 'caller_budget' | 'global_budget' | 'caller_calls';

export interface Verdict {
  allowed: boolean;
  reason?: DenyReason;
}

/**
 * Is this call allowed, given the totals INCLUDING its own reservation?
 *
 * Checked global-first. When the whole platform is over budget, that is the
 * true reason the request is being refused, and reporting a per-caller limit to
 * someone who has barely used the app would send them chasing the wrong thing.
 *
 * Note `>` rather than `>=`: the totals already include this call's
 * reservation, so a caller who lands exactly on the cap has spent their
 * allowance and not exceeded it. Off-by-one here would refuse the last
 * legitimate call of every day.
 */
export function verdict(totals: Totals, caps: Caps): Verdict {
  if (totals.globalMicros > caps.globalMicros) return { allowed: false, reason: 'global_budget' };
  if (totals.callerMicros > caps.callerMicros) return { allowed: false, reason: 'caller_budget' };
  if (totals.fnCalls > caps.fnCalls) return { allowed: false, reason: 'caller_calls' };
  return { allowed: true };
}

/**
 * Per-caller daily call ceilings, kept from the original limiter.
 *
 * These are no longer the primary control — spend is — but they still catch the
 * cheap-call flood that a spend cap would let through: a million categorize
 * calls that each cost a fraction of a cent add up to real infrastructure load
 * long before they add up to money.
 */
export const FN_CALL_CAPS: Record<string, number> = {
  categorize: 400,
  'quick-add-parse': 120,
  'weekly-recap': 60,
  // The most expensive call in the app — up to 1400 output tokens against
  // categorize's 160 — so its count cap is the tightest.
  //
  // Where the spend cap alone would bite depends entirely on page size: a
  // maximum-length page reserves ~9,500 micros, so the $0.25 caller cap stops
  // it at ~26 a day, while a typical recipe page settles near 2,500 and would
  // run to ~100. Forty sits inside that band, which means a heavy but honest
  // day gets refused by a limit a person can understand ("forty recipes") in
  // most cases, rather than by a budget figure that moves with page length.
  // Without an entry here it fell through to the 100 default — the loosest end
  // of that range, for the most expensive call.
  'recipe-import': 40,
};

/**
 * Caps, with environment overrides.
 *
 * Overridable without a deploy because the right ceiling is a business
 * decision that changes with the user base, and finding out you set it too low
 * means the AI features are off for everyone until a deploy lands.
 *
 * The defaults: $0.25 per caller per day is roughly two hundred quick-adds —
 * far past any real person, low enough that one abuser cannot matter. $25/day
 * globally is the circuit breaker; raise it deliberately as the user base
 * grows, and treat tripping it as an incident rather than a routine event.
 */
export function capsFromEnv(fn: string, env: (key: string) => string | undefined): Caps {
  const num = (key: string, fallback: number): number => {
    const raw = env(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    // A typo'd env var must not silently become a cap of NaN, which every
    // comparison would then wave through.
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    callerMicros: num('AI_DAILY_CAP_MICROS_CALLER', 250_000),
    globalMicros: num('AI_DAILY_CAP_MICROS_GLOBAL', 25_000_000),
    fnCalls: num('AI_DAILY_CAP_CALLS_CALLER', FN_CALL_CAPS[fn] ?? 100),
  };
}
