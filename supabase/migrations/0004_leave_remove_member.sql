-- Leaving a household and removing members. household_members has no delete
-- RLS policy (deletes are blocked), so these run as SECURITY DEFINER with their
-- own authorization checks.

-- Leave the household you're in. Cleans up: if you were the last member the
-- household is deleted; if you were the last owner but members remain, the
-- earliest-joined member is promoted so a household always has an owner.
create or replace function leave_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
  owners int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from household_members
  where household_id = p_household and user_id = auth.uid();

  select count(*) into remaining
  from household_members where household_id = p_household;

  if remaining = 0 then
    delete from households where id = p_household;
    return;
  end if;

  select count(*) into owners
  from household_members where household_id = p_household and role = 'owner';

  if owners = 0 then
    update household_members
    set role = 'owner'
    where household_id = p_household
      and user_id = (
        select user_id from household_members
        where household_id = p_household
        order by joined_at asc
        limit 1
      );
  end if;
end;
$$;

-- Owner removes another member. Owners can't remove themselves here (use
-- leave_household) nor another owner.
create or replace function remove_member(p_household uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from household_members
    where household_id = p_household and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  if p_user = auth.uid() then
    raise exception 'use_leave';
  end if;

  delete from household_members
  where household_id = p_household
    and user_id = p_user
    and role <> 'owner';
end;
$$;

revoke execute on function leave_household(uuid) from public, anon;
revoke execute on function remove_member(uuid, uuid) from public, anon;
grant execute on function leave_household(uuid) to authenticated;
grant execute on function remove_member(uuid, uuid) to authenticated;
