-- ---------------------------------------------------------------------------
-- From a call counter to a spend cap.
--
-- 0010 counted CALLS per caller per function per day. That was the right first
-- guard and it is now the wrong one, for three reasons the code made obvious:
--
--   1. Calls are not comparable. quick-add-parse accepts 1000 characters of
--      input and was allowed 1024 output tokens; categorize is capped at 140.
--      One quick-add can cost thirty categorize calls, so a cap of "120
--      quick-adds" and "400 categorizes" were not two versions of the same
--      limit — they were two unrelated numbers that happened to look alike.
--
--   2. There was no global ceiling. Per-caller caps bound what ONE abuser can
--      do; they say nothing about ten thousand of them, which is exactly the
--      shape of a runaway bill.
--
--   3. The bucket was the client IP. Carrier-grade NAT puts a whole mobile
--      network behind one address (so a cap meant to stop one abuser silently
--      throttles a city), and a VPN gives an abuser a fresh bucket per request.
--      It was simultaneously too strict and too loose.
--
-- This migration makes SPEND the unit, adds a ceiling across all callers, and
-- lets the functions key on the signed-in user when there is one.
--
-- ---------------------------------------------------------------------------
-- Reserve, then settle
-- ---------------------------------------------------------------------------
--
-- The cost of a call is not known until it returns, but the decision to allow
-- it has to be made before it is made. Checking already-recorded spend and then
-- calling would let a thousand concurrent requests all pass the same check
-- before any of them recorded anything — which is precisely the burst a
-- scripted abuser generates.
--
-- So a call reserves its WORST CASE up front (estimated input + the hard
-- max_tokens ceiling), and the difference is refunded once the real usage is
-- known. Over-reserving is self-correcting; under-reserving is not. One
-- function does all three moves — reserve, refund, release — because they are
-- the same atomic adjustment with different signs, and three near-identical
-- RPCs would be three places for the arithmetic to drift.
--
-- ---------------------------------------------------------------------------
-- Money is integers
-- ---------------------------------------------------------------------------
--
-- Everything is micro-USD (millionths of a dollar) in bigint. Haiku's $1 per
-- million input tokens is exactly 1 micro-USD per token, so the conversion is a
-- multiply with no rounding anywhere. A spend cap kept in floating point drifts,
-- and it drifts silently in whichever direction the accumulated error happens
-- to go.
-- ---------------------------------------------------------------------------

-- Per-caller, per-function, per-day. Columns added rather than a new table so
-- the existing rows and the bump_ai_usage RPC keep working during a rollout
-- where functions and database are not deployed in the same instant.
alter table ai_usage
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists cost_micros bigint not null default 0;

-- ---------------------------------------------------------------------------
-- The ceiling that actually protects the bill.
--
-- One row per UTC day, every caller's spend together. Separate from ai_usage
-- because it is read on EVERY request: summing a per-caller table that grows
-- with the user base would make the cheapest possible query get slower exactly
-- as the thing it protects gets more expensive.
-- ---------------------------------------------------------------------------
create table if not exists ai_usage_global (
  day date primary key,
  cost_micros bigint not null default 0,
  calls bigint not null default 0
);

-- No policies on either table. RLS on with no policy denies every command for
-- anon and authenticated; only the service role (inside the edge functions)
-- bypasses it. That absence IS the control — do not "fix" it by adding one.
alter table ai_usage_global enable row level security;

-- ---------------------------------------------------------------------------
-- The one adjustment primitive.
--
-- Positive deltas reserve, negative deltas refund or release. Returns the
-- running totals AFTER the adjustment, so the caller decides from the same
-- numbers it just wrote — no read-after-write race between the two.
--
-- `p_delta_calls` is separate from the spend delta because a refund adjusts
-- money without un-counting the call: the call happened, and the call-count cap
-- exists to catch floods of cheap calls that never trouble the spend cap.
-- ---------------------------------------------------------------------------
create or replace function adjust_ai_budget(
  p_bucket text,
  p_fn text,
  p_delta_micros bigint,
  p_delta_input bigint default 0,
  p_delta_output bigint default 0,
  p_delta_calls integer default 0
)
returns table (caller_micros bigint, global_micros bigint, fn_calls bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_caller bigint;
  v_calls bigint;
  v_global bigint;
begin
  insert into ai_usage (bucket, fn, day, count, input_tokens, output_tokens, cost_micros)
  values (p_bucket, p_fn, v_today, greatest(p_delta_calls, 0),
          greatest(p_delta_input, 0), greatest(p_delta_output, 0), p_delta_micros)
  on conflict (bucket, fn, day) do update set
    count = ai_usage.count + p_delta_calls,
    input_tokens = ai_usage.input_tokens + p_delta_input,
    output_tokens = ai_usage.output_tokens + p_delta_output,
    -- Clamped at zero: a refund larger than the reservation (a settle whose
    -- reserve never landed, say, because the row was reset at midnight
    -- mid-request) must not push the day's spend negative and hand the caller
    -- free budget.
    cost_micros = greatest(ai_usage.cost_micros + p_delta_micros, 0)
  returning ai_usage.cost_micros, ai_usage.count into v_caller, v_calls;

  insert into ai_usage_global (day, cost_micros, calls)
  values (v_today, p_delta_micros, greatest(p_delta_calls, 0))
  on conflict (day) do update set
    cost_micros = greatest(ai_usage_global.cost_micros + p_delta_micros, 0),
    calls = ai_usage_global.calls + p_delta_calls
  returning ai_usage_global.cost_micros into v_global;

  -- The per-caller SPEND cap counts every function together, so one caller
  -- cannot spread an abusive day across three endpoints and stay under three
  -- separate limits. The CALL cap stays per-function, which is why only the
  -- money is summed here.
  select coalesce(sum(u.cost_micros), 0) into v_caller
  from ai_usage u
  where u.bucket = p_bucket and u.day = v_today;

  return query select v_caller, v_global, v_calls;
end;
$$;

-- Callable only from inside the edge functions. An authenticated user able to
-- call this directly could refund their own spend to zero.
revoke execute on function
  adjust_ai_budget(text, text, bigint, bigint, bigint, integer)
  from public, anon, authenticated;
grant execute on function
  adjust_ai_budget(text, text, bigint, bigint, bigint, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- What yesterday cost, for the dashboard and the alert.
--
-- A cap nobody looks at is a cap that gets discovered at its ceiling. This is
-- the query to put on a schedule.
-- ---------------------------------------------------------------------------
create or replace view ai_spend_daily as
select
  g.day,
  g.cost_micros,
  -- Two decimal places of USD, for humans.
  round(g.cost_micros / 1000000.0, 2) as cost_usd,
  g.calls,
  (select count(distinct u.bucket) from ai_usage u where u.day = g.day) as callers
from ai_usage_global g
order by g.day desc;

-- The view inherits no RLS of its own, so it must not be readable by clients:
-- it would expose the platform's aggregate usage to anyone with the anon key.
revoke all on ai_spend_daily from public, anon, authenticated;
grant select on ai_spend_daily to service_role;
