-- ---------------------------------------------------------------------------
-- Nobody should wait on a request with no way to tell it is being waited on.
--
-- 0042 made joining a household somebody's decision, which was the right change
-- and shipped with the wrong silence attached: a requester saw "waiting to be
-- let in" and nothing else, ever. They could not tell whether the code was
-- wrong, the app was broken, the owner had seen it and said nothing, or the
-- owner had not opened Korb since. Those are four completely different
-- situations and the app showed one screen for all of them.
--
-- An approval gate that leaves people unable to tell which is worse than no
-- gate at all. The old behaviour let anyone in with a code — too permissive,
-- but nobody was ever stranded by it.
--
-- Three things, smallest first.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. HAS ANYBODY LOOKED?
--
-- One timestamp, and it changes what the waiting screen can say from a single
-- ambiguous sentence to two useful ones: "nobody has opened Korb since you
-- asked" and "seen — waiting on a decision".
--
-- Stamped only by an OWNER, deliberately. The queue is readable by every member
-- (see 0042 — a household where one person quietly admits people is worse than
-- one where everybody can see who is at the door), but only an owner can
-- answer. A housemate glancing at the card is not the event the requester cares
-- about, and stamping it would turn "seen" into a claim that somebody with the
-- power to decide has decided not to.
-- ---------------------------------------------------------------------------
alter table household_join_requests
  add column if not exists seen_at timestamptz;

comment on column household_join_requests.seen_at is
  'When an OWNER first had this request on screen. Null means nobody who can '
  'answer it has opened the app since it was made.';

create or replace function mark_join_requests_seen(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  /*
   * Owners only, and silent for everybody else rather than an error. A member
   * rendering the queue is doing something perfectly legitimate; there is
   * simply nothing to stamp.
   */
  if not exists (
    select 1 from household_members
    where household_id = p_household
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    return;
  end if;

  -- FIRST sight only. `seen_at` answers "has anybody looked", and an owner who
  -- opens the app daily without deciding would otherwise keep refreshing it to
  -- now, which reads to the requester as a decision being made repeatedly.
  update household_join_requests
     set seen_at = now()
   where household_id = p_household
     and status = 'pending'
     and seen_at is null;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. AND IF NOBODY EVER ANSWERS?
--
-- A pending row lives forever, and the partial unique index from 0042 means the
-- person who made it cannot ask again — so an owner who never opens the app
-- leaves somebody permanently unable to join, with no error and nothing to
-- retry.
--
-- Fourteen days, and NOT enforced by a scheduler.
--
-- A cron job would need pg_cron, a schedule to keep, and a failure mode where
-- the job stops and nothing says so. The expiry is a property of the row's age,
-- which is already stored, so it can simply be READ that way: the client shows
-- an old pending request as lapsed, and the one place where a stale row would
-- actually block something — asking again — clears it first.
--
-- Self-healing, no infrastructure, and nothing to notice has stopped running.
-- ---------------------------------------------------------------------------
create or replace function join_request_ttl()
returns interval
language sql
immutable
as $$ select interval '14 days' $$;

grant execute on function join_request_ttl() to authenticated, service_role;

comment on function join_request_ttl is
  'How long a pending join request stands. Read by request_join_household to '
  'clear an expired one out of the way, and mirrored in the client so the '
  'requester is told it lapsed rather than left waiting.';


-- ---------------------------------------------------------------------------
-- 3. THE TOKENS A NOTIFICATION NEEDS.
--
-- One row per device, not per user: people have a phone and a tablet, and the
-- owner deciding on their tablet should still reach the requester's phone.
--
-- The token is the address of a device, so it is treated like one. A user may
-- write and delete only their own; NOBODY may read them, not even their owner,
-- because nothing in the app has any reason to and a readable token table is a
-- list of everyone's push addresses one policy mistake away from being public.
-- The function that sends notifications reads them with the service role, which
-- bypasses RLS by design and is the only thing that ever should.
-- ---------------------------------------------------------------------------
create table if not exists device_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  /** The Expo push token for this install. */
  token text not null,
  platform text,
  /*
   * What this DEVICE reads.
   *
   * A notification is composed on the server, long after the app that would
   * have translated it has been closed — so the language has to travel with the
   * address. On the device rather than on the user because it is the device's
   * setting, and because the two people in one notification are frequently not
   * the same reader: a German owner approving a French housemate has to be told
   * in German and reply in French, from one send.
   */
  language text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table device_tokens enable row level security;

create policy "own device tokens in"
  on device_tokens for insert
  with check (user_id = auth.uid());

create policy "own device tokens updated"
  on device_tokens for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own device tokens out"
  on device_tokens for delete
  using (user_id = auth.uid());

-- Deliberately NO select policy. See above.

-- The send path reads "every token for these users", which is the only query
-- this table ever serves.
create index if not exists idx_device_tokens_user on device_tokens (user_id);


-- ---------------------------------------------------------------------------
-- 4. SENT ONCE.
--
-- Two columns rather than one, because they are two different events and a
-- single "notified" flag would have to be cleared and re-set, which is a state
-- machine where a pair of timestamps will do.
--
-- They exist to make the send IDEMPOTENT. The notification is triggered by the
-- client after its write succeeds — the alternative is pg_net and a database
-- webhook, which is more moving parts for the same result — and a client can be
-- retried, backgrounded, or simply tapped twice. Stamping here means the second
-- attempt sends nothing.
-- ---------------------------------------------------------------------------
alter table household_join_requests
  add column if not exists asked_notified_at timestamptz,
  add column if not exists decided_notified_at timestamptz;


-- ---------------------------------------------------------------------------
-- 5. The request's own id comes back.
--
-- The client has to name the request when it asks the server to send the
-- notification — see functions/notify-join, where naming a request rather than
-- a recipient is what stops the endpoint being an open relay. Without the id
-- the client would have to go and look its own row up, which is a second round
-- trip to learn something the insert already knew.
--
-- Dropped and recreated rather than altered: `alter type ... add attribute` on
-- a composite a function returns is the kind of statement that works until the
-- day it does not, and the function is being recreated below anyway. Order
-- matters — the function depends on the type, so it goes first.
-- ---------------------------------------------------------------------------
drop function if exists request_join_household(text, text);
drop type if exists join_request_result;

create type join_request_result as (
  /** 'pending' — asked and waiting. 'member' — already in, nothing to ask. */
  status text,
  /** The pending request, or null when there was nothing to create. */
  request_id uuid,
  household_id uuid,
  household_name text
);


-- ---------------------------------------------------------------------------
-- 6. Asking again, once a request has lapsed.
--
-- request_join_household is recreated in full rather than patched: it is
-- SECURITY DEFINER, and a partial redefinition of one of those is how you end
-- up with two versions of an authorisation check. The only change is the delete
-- at the top.
-- ---------------------------------------------------------------------------
create or replace function request_join_household(p_code text, p_display_name text)
returns join_request_result
language plpgsql
security definer
set search_path = public
as $$
declare
  h households;
  clean text := coalesce(nullif(btrim(p_display_name), ''), 'Me');
  joined integer;
  asked uuid;
  result join_request_result;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into h from households
  where invite_code = upper(trim(p_code));

  if h.id is null then
    raise exception 'invalid_code';
  end if;

  if exists (
    select 1 from household_members
    where household_id = h.id and user_id = auth.uid()
  ) then
    -- Nothing was created, so there is nothing to notify anybody about.
    result := ('member', null, h.id, h.name);
    return result;
  end if;

  /*
   * Clear the caller's OWN lapsed request for this household, so the partial
   * unique index does not hold a fourteen-day-old row against them. Scoped to
   * this user and this household and to rows that are genuinely past the TTL —
   * it must never reach a live request or somebody else's.
   */
  delete from household_join_requests
   where household_id = h.id
     and user_id = auth.uid()
     and status = 'pending'
     and created_at < now() - join_request_ttl();

  select count(*) into joined from household_members where user_id = auth.uid();
  if not is_entitled(auth.uid()) and joined >= household_limit() then
    raise exception 'household_limit';
  end if;

  insert into household_join_requests (household_id, user_id, display_name, household_name)
  values (h.id, auth.uid(), clean, h.name)
  on conflict (household_id, user_id) where status = 'pending'
  do update set display_name = excluded.display_name
  returning id into asked;

  result := ('pending', asked, h.id, h.name);
  return result;
end;
$$;

revoke execute on function mark_join_requests_seen(uuid) from public, anon;
grant execute on function mark_join_requests_seen(uuid) to authenticated;
-- Re-granted: the drop above took the old grants with it.
revoke execute on function request_join_household(text, text) from public, anon;
grant execute on function request_join_household(text, text) to authenticated;
