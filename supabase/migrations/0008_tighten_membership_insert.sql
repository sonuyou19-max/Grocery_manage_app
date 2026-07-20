-- ---------------------------------------------------------------------------
-- Security hardening: stop arbitrary self-joins into households.
--
-- The original household_members INSERT policy allowed `user_id = auth.uid()`
-- with ANY household_id, so any authenticated user who learned a household's
-- UUID could insert themselves as a member — bypassing the invite code and
-- bypassing owner removal. Joining is meant to go only through the
-- join_household(code) RPC (SECURITY DEFINER), which requires the invite code.
--
-- All membership writes (create/join/leave/remove) run as SECURITY DEFINER and
-- bypass RLS, so removing the permissive self-insert breaks none of them. We
-- keep only an owner-adds-member path for direct inserts; everything else must
-- go through the invite-code RPC.
-- ---------------------------------------------------------------------------

drop policy if exists "users join or owners add" on household_members;

create policy "owners add members"
  on household_members for insert
  with check (
    exists (
      select 1 from household_members m
      where m.household_id = household_members.household_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- Households are likewise created only through the create_household RPC
-- (SECURITY DEFINER). Drop the direct-insert policy so authenticated users
-- can't create orphaned household rows straight against the table.
drop policy if exists "authenticated users create households" on households;
