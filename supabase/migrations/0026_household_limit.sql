-- ---------------------------------------------------------------------------
-- Unlimited households, for real.
--
-- Korb Plus advertises "as many households as you like". Before this migration
-- that sentence was false: the cap of 10 lives in create_household and
-- join_household (migration 0012) and applied to everybody, so a subscriber
-- would have hit exactly the same wall as a free account — having paid for the
-- privilege of not hitting it.
--
-- Advertising a capability the schema refuses to grant is not a UI bug to fix
-- later; it is the app taking money for something it does not do. So the claim
-- and the enforcement are changed together, in one migration, and neither can
-- ship without the other.
--
-- ---------------------------------------------------------------------------
-- The free limit stays, and stays invisible
-- ---------------------------------------------------------------------------
--
-- Ten, unchanged, and deliberately never shown in the app. It is not a feature
-- being withheld — it is an anti-abuse bound on a table anyone can insert into,
-- and ten households is far past what any real person needs. Someone who trips
-- it is either testing or spamming. Naming a number in the UI would turn a
-- guardrail into a taunt, and would invite the obvious question of why a free
-- user is allowed nine but not eleven.
--
-- Both RPCs are recreated in full rather than patched, because that is how 0012
-- wrote them and because a partial redefinition of a SECURITY DEFINER function
-- is how you end up with two versions of an authorisation check.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The free cap. One place, so the two call sites cannot drift.
-- ---------------------------------------------------------------------------
create or replace function household_limit()
returns integer
language sql
immutable
as $$ select 10 $$;

grant execute on function household_limit() to authenticated, service_role;

create or replace function create_household(p_name text, p_display_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  h households;
  code text;
  owned integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select count(*) into owned from household_members where user_id = auth.uid();
  if not is_entitled(auth.uid()) and owned >= household_limit() then
    raise exception 'household_limit';
  end if;

  loop
    code := gen_invite_code();
    exit when not exists (select 1 from households where invite_code = code);
  end loop;

  insert into households (name, invite_code)
  values (nullif(trim(p_name), ''), code)
  returning * into h;

  insert into household_members (household_id, user_id, role, display_name)
  values (h.id, auth.uid(), 'owner', coalesce(nullif(trim(p_display_name), ''), 'Me'));

  return h;
end;
$$;

create or replace function join_household(p_code text, p_display_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  h households;
  joined integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into h from households
  where invite_code = upper(trim(p_code));

  if h.id is null then
    raise exception 'invalid_code';
  end if;

  -- Cap new memberships only. Re-running a join for a household you are already
  -- in is a harmless no-op below, so it must not trip the limit.
  select count(*) into joined from household_members where user_id = auth.uid();
  if not is_entitled(auth.uid()) and joined >= household_limit() and not exists (
    select 1 from household_members
    where user_id = auth.uid() and household_id = h.id
  ) then
    raise exception 'household_limit';
  end if;

  insert into household_members (household_id, user_id, role, display_name)
  values (h.id, auth.uid(), 'member', coalesce(nullif(trim(p_display_name), ''), 'Me'))
  on conflict (household_id, user_id) do nothing;

  return h;
end;
$$;

-- Grants are dropped with the function bodies they were attached to, so both
-- are restated. A silently unexecutable create_household would look exactly
-- like a network failure at sign-up, which is the worst place to debug it.
revoke execute on function create_household(text, text) from public, anon;
grant execute on function create_household(text, text) to authenticated;

revoke execute on function join_household(text, text) from public, anon;
grant execute on function join_household(text, text) to authenticated;
