-- ---------------------------------------------------------------------------
-- In-app account deletion (GDPR right-to-erasure + Apple App Store requirement).
--
-- Removes the caller's auth account and all data tied to it. Households are
-- unwound with the same rules as leave_household: if the user was the last
-- member the household (and its lists/pantry/recaps, via ON DELETE CASCADE) is
-- deleted; if they were the last owner but members remain, the earliest-joined
-- member is promoted so a household is never left ownerless. Finally the
-- auth.users row is deleted, which cascades any remaining references.
--
-- SECURITY DEFINER so it runs with the owner's privileges (needed to delete
-- from auth.users); it authorizes strictly against auth.uid().
-- ---------------------------------------------------------------------------

create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  h record;
  remaining int;
  owners int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Leave every household cleanly before removing the account.
  for h in select household_id from household_members where user_id = uid loop
    delete from household_members
      where household_id = h.household_id and user_id = uid;

    select count(*) into remaining
      from household_members where household_id = h.household_id;

    if remaining = 0 then
      delete from households where id = h.household_id;
    else
      select count(*) into owners
        from household_members where household_id = h.household_id and role = 'owner';
      if owners = 0 then
        update household_members
          set role = 'owner'
          where household_id = h.household_id
            and user_id = (
              select user_id from household_members
              where household_id = h.household_id
              order by joined_at asc
              limit 1
            );
      end if;
    end if;
  end loop;

  -- Remove the auth account itself (cascades any rows still referencing it;
  -- list_items.added_by is ON DELETE SET NULL).
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function delete_account() from public, anon;
grant execute on function delete_account() to authenticated;
