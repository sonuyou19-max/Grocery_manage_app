-- Household invite codes + create/join RPCs.
-- These run as SECURITY DEFINER so a caller can atomically create a household
-- and their owner membership (or join by code) without tripping over the
-- household_members RLS insert policy.

alter table households add column if not exists invite_code text unique;

-- Short, human-friendly, unambiguous invite code (no 0/O/1/I).
create or replace function gen_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           (floor(random() * 32) + 1)::int, 1),
    ''
  )
  from generate_series(1, 6);
$$;

-- Create a household and add the caller as its owner. Returns the new row.
create or replace function create_household(p_name text, p_display_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  h households;
  code text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
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

-- Join an existing household by its invite code (case-insensitive).
create or replace function join_household(p_code text, p_display_name text)
returns households
language plpgsql
security definer
set search_path = public
as $$
declare
  h households;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into h from households
  where invite_code = upper(trim(p_code));

  if h.id is null then
    raise exception 'invalid_code';
  end if;

  insert into household_members (household_id, user_id, role, display_name)
  values (h.id, auth.uid(), 'member', coalesce(nullif(trim(p_display_name), ''), 'Me'))
  on conflict (household_id, user_id) do nothing;

  return h;
end;
$$;

revoke execute on function gen_invite_code() from public, anon;
revoke execute on function create_household(text, text) from public, anon;
revoke execute on function join_household(text, text) from public, anon;
grant execute on function create_household(text, text) to authenticated;
grant execute on function join_household(text, text) to authenticated;
