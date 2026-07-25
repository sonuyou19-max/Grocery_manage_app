-- ---------------------------------------------------------------------------
-- Multiple households per user.
--
-- The schema already supported this: household_members is keyed
-- (household_id, user_id) with no unique constraint on user_id, every data
-- table carries household_id, and RLS is already is_household_member(). Only
-- the client enforced one household. So this migration adds just the two things
-- that genuinely need server support.
-- ---------------------------------------------------------------------------

-- 1. Renaming yourself.
--
-- A user has one display name, shown in every household. It has to be written
-- onto each household_members row because that column is the only thing other
-- members can read — they cannot see your user record. household_members has
-- SELECT and INSERT policies but deliberately no UPDATE policy, so this cannot
-- be done from the client; it goes through a definer function that only ever
-- touches the caller's own rows.
create or replace function set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(btrim(p_name), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if clean is null then
    raise exception 'name_required';
  end if;

  update household_members
    set display_name = clean
    where user_id = auth.uid();
end;
$$;

-- 2. A cap on households per user.
--
-- Creating a household used to be a once-ever action; now it is routine, and
-- unbounded creation is an easy way to spam the table. Re-declared in full
-- because create_household is replaced wholesale.
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
  if owned >= 10 then
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

-- Same cap when joining, so the limit can't be walked around with invite codes.
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
  if joined >= 10 and not exists (
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
