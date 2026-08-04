-- ---------------------------------------------------------------------------
-- How far back a person can read their own spending.
--
-- This is the paid boundary. Everything else in Korb is free once you have an
-- account — lists, cloud backup, realtime, INVITING OTHER PEOPLE, and the whole
-- pantry with its burn-rate prediction. What Plus buys is depth: the full year
-- of purchase history instead of the last few weeks, plus the cards that can
-- only exist with it (price moves over time, cheaper-elsewhere across shops,
-- the weekly recap).
--
-- ---------------------------------------------------------------------------
-- This supersedes the sharing gate, and deliberately does not remove it
-- ---------------------------------------------------------------------------
--
-- Migration 0024 built the vocabulary for charging to share a household:
-- can_write_household() and household_access(). Nothing calls them any more and
-- nothing in the app is going to. They are left in place rather than dropped
-- because they are correct, they cost nothing unexecuted, and the decision they
-- encode is one a pricing change could reverse — at which point the SQL is
-- already written and tested. 0024 said the consuming policies would land "in a
-- later migration"; this is that migration saying they never will.
--
-- What changed the decision: every comparable app (Bring!, OurGroceries,
-- Listonic) lets people share a list for free. Charging for it would have made
-- Korb's free tier visibly worse than the app a new user already has, and it
-- would have taxed the one channel that brings new users in — an invite is
-- someone installing Korb because a person they live with asked them to. Depth
-- of history has no such competitor and no such side effect, and it is the one
-- boundary that gets MORE valuable the longer someone stays rather than less.
--
-- ---------------------------------------------------------------------------
-- Why the cutoff comes from the server
-- ---------------------------------------------------------------------------
--
-- Not for enforcement. The rows are the user's own and RLS already lets them
-- read every one; a patched client could ask for all of it, and the worst
-- outcome is that somebody sees their own groceries. It is here so that "the
-- free tier is five weeks" has exactly ONE definition. Put it in the client and
-- it is a constant in a bundle that ships on its own schedule, drifts from the
-- copy in the paywall, and cannot be changed without a store release.
--
-- Returned from my_entitlement() rather than as its own RPC because the client
-- already calls that on launch and on every foreground. The window costs no
-- extra round trip.
--
-- ---------------------------------------------------------------------------
-- Nothing is ever deleted
-- ---------------------------------------------------------------------------
--
-- Lapsing narrows a query. It does not touch a row. Somebody who subscribes,
-- accumulates a year of history and then stops paying still has all of it in
-- price_entries; they see the free window until they resubscribe, at which
-- point the whole year is simply there again. There is no archival job, no
-- grace-period deletion, and no code path in this schema that removes history
-- for non-payment. That is a promise the app makes in the UI, so it had better
-- be structurally true here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The free window — and the launch kill switch.
--
-- Ships at 520 weeks (ten years), which is longer than any account can possibly
-- have existed, so this migration changes what every current user sees by
-- exactly nothing. The gate is live, wired and testable from the day it lands;
-- it just isn't biting yet.
--
-- When billing goes live, this becomes `interval '5 weeks'` (migration 0028 —
-- four was the original plan and is two days short of the 30-day default the
-- Insights cards offer; see that file). That is a one-line
-- change to one function: no app release, no store review, no client deploy,
-- and it can be reverted in seconds if conversion or complaints say it was
-- wrong. Shipping the boundary and turning it on are two different decisions
-- and they should not need the same lead time.
-- ---------------------------------------------------------------------------
create or replace function free_history_weeks()
returns interval
language sql
immutable
as $$ select interval '520 weeks' $$;

-- ---------------------------------------------------------------------------
-- The paid window.
--
-- Matches PURCHASE_WINDOW_WEEKS in the client and the 52-week horizon already
-- baked into the pantry views (migration 0020). A subscriber is not unlimited;
-- they get the whole of what Korb retains, which is a year — enough to answer
-- "what did Christmas cost last year?", which is most of why anyone opens a
-- spend history at all.
-- ---------------------------------------------------------------------------
create or replace function paid_history_weeks()
returns interval
language sql
immutable
as $$ select interval '52 weeks' $$;

-- ---------------------------------------------------------------------------
-- my_entitlement(), now carrying the cutoff.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE cannot change a
-- function's OUT columns, and this one gains a fourth. Dropping is safe because
-- the only caller is the app, which reads columns by name.
-- ---------------------------------------------------------------------------
drop function if exists my_entitlement();

create or replace function my_entitlement()
returns table (
  entitled boolean,
  trial_ends_at timestamptz,
  subscribed_until timestamptz,
  -- The oldest recorded_at this user may see. The client passes it straight
  -- into its price_entries query; it never computes a window of its own.
  history_cutoff timestamptz,
  -- Is the paid boundary switched on at all?
  --
  -- Needed because the kill switch above only narrows a date range, and Plus is
  -- more than a date range: it also hides three Insights cards (price moves,
  -- cheaper elsewhere, the weekly recap). Without this the launch default would
  -- be incoherent — a tester past day 30 would keep an unlimited history, since
  -- free_history_weeks() is ten years, but lose the recap, since `entitled` is
  -- false. One user, two different answers about whether they are on the free
  -- tier.
  --
  -- Derived rather than stored so it cannot disagree with the switch it
  -- describes: the gate is on exactly when free is narrower than paid. Setting
  -- free_history_weeks() to 5 weeks turns the whole of Plus on in one edit;
  -- setting it back to 520 turns all of it off again.
  plus_gate_active boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    is_entitled(auth.uid()),
    (select u.created_at + trial_length() from auth.users u where u.id = auth.uid()),
    (select s.current_period_end from subscriptions s where s.user_id = auth.uid()),
    now() - case
      when is_entitled(auth.uid()) then paid_history_weeks()
      else free_history_weeks()
    end,
    free_history_weeks() < paid_history_weeks();
$$;

-- Same grants as before the drop. Spelled out rather than assumed: dropping a
-- function drops its grants with it, and a silently unexecutable my_entitlement
-- would leave every client stuck on `loaded: false`.
revoke execute on function my_entitlement() from public, anon;
grant execute on function my_entitlement() to authenticated;

-- The two window functions are immutable constants and reveal nothing about any
-- user, so the app may read them directly — useful for the paywall, which has
-- to tell people what they are buying without hard-coding the window a second
-- time in a translated string.
grant execute on function free_history_weeks() to authenticated, anon, service_role;
grant execute on function paid_history_weeks() to authenticated, anon, service_role;
