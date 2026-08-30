-- ---------------------------------------------------------------------------
-- Joining a household is a request now, not an act.
--
-- An invite code let anybody who had it walk straight in. That is the whole
-- consent model: a code shared once, in a message, in a screenshot, read over
-- somebody's shoulder — and from then on there is no gate at all. The household
-- that gets joined finds out afterwards, if it looks at the member list, and
-- what the newcomer can see is everything: every list, every price, the whole
-- purchase history, who bought what and where.
--
-- So the code stops being a key and becomes an introduction. It identifies
-- which household you are asking about; the owner decides whether you come in.
--
-- ---------------------------------------------------------------------------
-- What a pending requester may NOT see, which is the awkward part
-- ---------------------------------------------------------------------------
--
-- Until they are approved they are not a member, so RLS gives them nothing:
-- not the household row, not its lists, not who else is in it. That is correct
-- and it has one consequence this table has to solve — they cannot see the NAME
-- of the household they just asked to join, which is the one thing they need in
-- order to know they typed the right code.
--
-- Hence `household_name`, denormalised onto the request. It is the only field
-- about the household that crosses the boundary, and it is copied rather than
-- joined precisely so that nothing else can come with it. A view or a join
-- would have to be written very carefully to avoid handing over `invite_code`,
-- which would let a rejected requester re-enter forever and share the code on.
--
-- A stale copy is the price, and it is the right price: if the household is
-- renamed while a request is pending, the requester sees the name they typed
-- the code for, which is arguably the more useful of the two.
-- ---------------------------------------------------------------------------

create table if not exists household_join_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  /*
   * Who is asking, as they wish to be known.
   *
   * On the request rather than looked up, for the same reason it is on
   * household_members: there is no readable user record in this schema, so a
   * display name has to travel with the row that needs it. The owner deciding
   * on this request cannot see anything else about the person at all — this
   * name is the entire basis of the decision, which is why it is required.
   */
  display_name text not null,

  /** The household's name AS IT WAS when the request was made. See above. */
  household_name text not null,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null
);

/*
 * One live request per person per household.
 *
 * Partial, on `pending` only, so a declined request does not block asking again
 * later — people fall out and back in with their households, and a permanent
 * bar would be this table remembering a grudge. What it does prevent is the
 * obvious annoyance: tapping Join four times and putting four identical cards
 * in front of the owner.
 */
create unique index if not exists idx_join_requests_pending
  on household_join_requests (household_id, user_id)
  where status = 'pending';

-- The owner's nudge reads "pending requests for the households I am in",
-- newest first. The requester's own read is by user_id.
create index if not exists idx_join_requests_household
  on household_join_requests (household_id, status, created_at desc);
create index if not exists idx_join_requests_user
  on household_join_requests (user_id, created_at desc);

alter table household_join_requests enable row level security;

/*
 * READ: the person who asked, and the household they asked about.
 *
 * Members rather than owners only, deliberately. Only an owner can decide, but
 * a household where one person is quietly admitting people is worse than one
 * where everybody can see who is at the door. It also means the nudge does not
 * silently do nothing for a member who is not the owner — they see the request
 * and see that it is not theirs to answer.
 */
create policy "requester and household read join requests"
  on household_join_requests for select
  using (user_id = auth.uid() or is_household_member(household_id));

/*
 * And NO insert, update or delete policy at all.
 *
 * Every write goes through a SECURITY DEFINER function below. A client-side
 * insert policy would have to express "you may create a request for a household
 * you can name, but only for yourself, and only if you know its invite code" —
 * and the last clause cannot be written as a policy without letting the client
 * read invite codes to check against. The definer functions have that
 * information and never hand it back.
 */

-- ---------------------------------------------------------------------------
-- Asking to join.
--
-- Replaces the code's old meaning entirely. What comes back is deliberately a
-- narrow shape and not the households row: that row carries `invite_code`, and
-- returning it to somebody who has not been let in yet would hand them the very
-- thing the approval gate exists to make insufficient.
-- ---------------------------------------------------------------------------

do $$ begin
  create type join_request_result as (
    /** 'pending' — asked and waiting. 'member' — already in, nothing to ask. */
    status text,
    household_id uuid,
    household_name text
  );
exception
  when duplicate_object then null;
end $$;

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

  /*
   * Already in: nothing to ask, and saying so is not a leak — you can only
   * reach this branch by being a member of the household you just named.
   * Idempotent on purpose, so re-entering a code you already used is a no-op
   * rather than an error about a request that cannot be made.
   */
  if exists (
    select 1 from household_members
    where household_id = h.id and user_id = auth.uid()
  ) then
    result := ('member', h.id, h.name);
    return result;
  end if;

  /*
   * The same cap join_household enforced, applied at the ASK rather than at the
   * admission. Checking it on approval instead would let somebody queue
   * requests everywhere and make the failure the owner's problem — they would
   * tap Approve and be told about a stranger's subscription.
   */
  select count(*) into joined from household_members where user_id = auth.uid();
  if not is_entitled(auth.uid()) and joined >= household_limit() then
    raise exception 'household_limit';
  end if;

  insert into household_join_requests (household_id, user_id, display_name, household_name)
  values (h.id, auth.uid(), clean, h.name)
  -- Asking twice is asking once. The partial unique index is on pending rows,
  -- so this refreshes the name on a live request and creates a new one after a
  -- decline.
  on conflict (household_id, user_id) where status = 'pending'
  do update set display_name = excluded.display_name;

  result := ('pending', h.id, h.name);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deciding.
--
-- One function for both answers rather than two, because approve and decline
-- share every line of their authorisation and differ only in what they write.
-- Two copies of an ownership check is how one of them comes to be missing it.
-- ---------------------------------------------------------------------------
create or replace function decide_join_request(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r household_join_requests;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into r from household_join_requests where id = p_request;
  if r.id is null then
    raise exception 'no_request';
  end if;

  if not exists (
    select 1 from household_members
    where household_id = r.household_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  /*
   * Already decided is not an error, it is a second tap — or the other owner's
   * phone, a second earlier. Raising here would show somebody a failure for an
   * action that has already succeeded.
   */
  if r.status <> 'pending' then
    return;
  end if;

  if p_approve then
    insert into household_members (household_id, user_id, role, display_name)
    values (r.household_id, r.user_id, 'member', r.display_name)
    on conflict (household_id, user_id) do nothing;
  end if;

  update household_join_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Withdrawing.
--
-- "I typed the wrong code" is the common case and it needs an exit that is not
-- waiting for a stranger to decline. Deleted rather than marked, because a
-- withdrawn request is not a decision anybody needs a record of, and leaving it
-- as a row would keep it in front of the owner as something to answer.
-- ---------------------------------------------------------------------------
create or replace function cancel_join_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from household_join_requests
   where id = p_request and user_id = auth.uid() and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- And the old door is closed.
--
-- join_household created a membership on the strength of a code alone. Left in
-- place it is not a legacy path, it is the feature's bypass: any build still
-- calling it walks in without asking, and the owner never sees a request.
--
-- It raises rather than quietly forwarding to the new function. Forwarding
-- would return `households` — invite code included — to somebody who is now
-- only pending, and would tell an old client it had joined when it had not, so
-- it would switch to a household it cannot read anything from. An error the
-- client turns into "update the app" is the honest answer.
-- ---------------------------------------------------------------------------
create or replace function join_household(p_code text, p_display_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'use_request_join';
end;
$$;

revoke execute on function request_join_household(text, text) from public, anon;
revoke execute on function decide_join_request(uuid, boolean) from public, anon;
revoke execute on function cancel_join_request(uuid) from public, anon;
grant execute on function request_join_household(text, text) to authenticated;
grant execute on function decide_join_request(uuid, boolean) to authenticated;
grant execute on function cancel_join_request(uuid) to authenticated;
