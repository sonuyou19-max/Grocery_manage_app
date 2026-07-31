-- ---------------------------------------------------------------------------
-- Who is allowed to share a household.
--
-- One paid feature: putting another person in a household with you. Everything
-- else — lists, pantry, insights, cloud backup — is free once you have an
-- account. So this migration answers exactly two questions, and nothing else:
--
--   is_entitled(user)          — is this person subscribed (or still in trial)?
--   can_write_household(hid)   — may the CURRENT user write to this household?
--
-- The policies that consume the second one land in a later migration. Splitting
-- them means this one cannot break anything that works today: it only adds
-- vocabulary.
--
-- ---------------------------------------------------------------------------
-- The write rule
-- ---------------------------------------------------------------------------
--
-- You may write to a household if ANY of:
--
--   * you own it            — your own data is never held hostage. Sonu keeps
--                             writing to Sonu's Korb forever, subscribed or not.
--   * its owner is entitled — Sonu pays, so Aparna can write to Sonu's Korb.
--   * YOU are entitled      — Sonu lapses but Aparna subscribes: she is paying,
--                             so she keeps her access. Without this she would
--                             pay and still be locked out of the household she
--                             cares about, which reads as a bug rather than a
--                             policy.
--
-- Everything the product needs falls out of those three lines. A household with
-- one member is always writable by that member, which is what makes the free
-- tier "cloud backup, solo" without a single extra rule.
--
-- ---------------------------------------------------------------------------
-- The trial has no rows
-- ---------------------------------------------------------------------------
--
-- Every new account gets a month, and it is derived from auth.users.created_at
-- rather than stored. That is not a shortcut — it is the only version that
-- cannot be gamed or corrupted. There is no row to delete and restart, no row
-- to fail to create at signup, no race between the account existing and its
-- trial existing, and no device clock anywhere in the calculation.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Paid subscriptions. Written ONLY by the billing webhook (service role).
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- The moment access ends. A single timestamp rather than a status enum: it is
  -- what every check actually needs, it survives a missed webhook (access
  -- lapses on its own rather than hanging open), and a renewal is one update.
  current_period_end timestamptz not null,
  -- Which store sold it, for support and for reconciling refunds.
  store text not null default 'play' check (store in ('play', 'app_store')),
  -- The store's own identifier, so a replayed webhook is recognisable.
  external_id text,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- Read your own, so the app can show "your plan renews on…". No INSERT, UPDATE
-- or DELETE policy anywhere: a client that could write here could grant itself
-- a subscription, and the absence of those policies is what makes that
-- impossible rather than merely discouraged.
create policy "read own subscription"
  on subscriptions for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- How long a new account gets for free. One place to change it.
-- ---------------------------------------------------------------------------
create or replace function trial_length()
returns interval
language sql
immutable
as $$ select interval '30 days' $$;

-- ---------------------------------------------------------------------------
-- Is this user subscribed, or still inside their trial?
--
-- SECURITY DEFINER because it reads auth.users, which ordinary roles cannot.
-- STABLE so Postgres evaluates it once per statement rather than once per row —
-- this sits inside RLS policies, where a VOLATILE function would turn every
-- list query into one auth lookup per row.
-- ---------------------------------------------------------------------------
create or replace function is_entitled(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    exists (
      select 1 from auth.users u
      where u.id = p_user and now() < u.created_at + trial_length()
    )
    or exists (
      select 1 from subscriptions s
      where s.user_id = p_user and s.current_period_end > now()
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- May the current user write to this household?
--
-- The three-way rule above. Note it returns false for a household the caller is
-- not a member of at all — membership is checked first, so this is safe to use
-- as the whole of a policy rather than as an extra condition on one.
-- ---------------------------------------------------------------------------
create or replace function can_write_household(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members m
    where m.household_id = p_household
      and m.user_id = auth.uid()
      and (
        m.role = 'owner'
        or is_entitled(auth.uid())
        or exists (
          select 1 from household_members o
          where o.household_id = p_household
            and o.role = 'owner'
            and is_entitled(o.user_id)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- What the app needs to render: my own status, and which of my households are
-- writable. Two small reads rather than letting the client infer either.
--
-- Deliberately does NOT expose whether another member is subscribed. Aparna
-- learns that Sonu's Korb is frozen, never that Sonu stopped paying — that is
-- his billing relationship, not hers.
-- ---------------------------------------------------------------------------
create or replace function my_entitlement()
returns table (entitled boolean, trial_ends_at timestamptz, subscribed_until timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    is_entitled(auth.uid()),
    (select u.created_at + trial_length() from auth.users u where u.id = auth.uid()),
    (select s.current_period_end from subscriptions s where s.user_id = auth.uid());
$$;

create or replace function household_access()
returns table (household_id uuid, can_write boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.household_id, can_write_household(m.household_id)
  from household_members m
  where m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- is_entitled takes an arbitrary user id, so it stays service-role only: an
-- authenticated caller could otherwise probe any user's subscription status.
-- The two RPCs above are the sanctioned way to ask, and both are scoped to
-- auth.uid() by construction.
-- ---------------------------------------------------------------------------
revoke execute on function is_entitled(uuid) from public, anon, authenticated;
grant execute on function is_entitled(uuid) to service_role;

revoke execute on function can_write_household(uuid) from public, anon;
grant execute on function can_write_household(uuid) to authenticated, service_role;

revoke execute on function my_entitlement() from public, anon;
grant execute on function my_entitlement() to authenticated;

revoke execute on function household_access() from public, anon;
grant execute on function household_access() to authenticated;

-- No index on subscriptions: it is keyed on user_id and every lookup is by it.
-- No realtime publication: a subscription change is not something another
-- device needs within milliseconds, and the client re-reads on foreground.
