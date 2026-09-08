-- ---------------------------------------------------------------------------
-- Registering a push token, without the client naming whose it is.
--
-- ---------------------------------------------------------------------------
-- What went wrong
-- ---------------------------------------------------------------------------
--
-- Signing up wrote to the console:
--
--   [monitoring] write failed: device_tokens.upsert
--   {"code":"42501","message":"new row violates row-level security policy
--    for table \"device_tokens\""}
--
-- The client was doing `.upsert({ user_id, token, … }, { onConflict: … })`,
-- which PostgREST turns into `INSERT … ON CONFLICT DO UPDATE`. Two things make
-- that statement a bad fit for this table in particular:
--
--   IT NEEDS TO READ. Postgres applies the SELECT policies to the row an
--   ON CONFLICT DO UPDATE would touch, and 0043 gave this table NO select
--   policy on purpose — nobody may read the push addresses, which was and
--   remains the right call. So the one write path the app has was resting on a
--   permission the table is designed never to grant.
--
--   IT NAMES A USER. `user_id` travelled from the client, and the INSERT policy
--   existed to check that the client had not lied about it. A value that has to
--   be policed is a value that should not have been sent.
--
-- ---------------------------------------------------------------------------
-- The fix, and why an RPC rather than a select policy
-- ---------------------------------------------------------------------------
--
-- Adding `for select using (user_id = auth.uid())` would make the upsert work
-- and would leak nothing a person does not already have — it is their own
-- device's address. But it turns "nobody reads this table" into "nobody reads
-- anybody else's rows", and the first is an invariant while the second is a
-- policy to get right every time somebody touches this file.
--
-- A security-definer function keeps the stronger invariant. The row is written
-- as `auth.uid()`, so the client cannot name a user at all; the table stays
-- unreadable by anyone but the service role; and the conflict is resolved
-- inside the function, where RLS is not in the way.
--
-- Idempotent throughout, because the state of a database that has already had
-- 0043 applied — in whole or in part — is not knowable from here.
-- ---------------------------------------------------------------------------

-- 0043 created these; recreated here so a database that got the table without
-- them ends up in the same place as one that got both.
drop policy if exists "own device tokens in" on device_tokens;
drop policy if exists "own device tokens updated" on device_tokens;
drop policy if exists "own device tokens out" on device_tokens;

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

-- Still deliberately NO select policy. See 0043, and the note above for why the
-- write path no longer needs one.

create or replace function register_device_token(
  p_token text,
  p_platform text,
  p_language text
)
returns void
language plpgsql
security definer
-- Pinned, because a security-definer function inherits the caller's
-- search_path otherwise and a shadowing schema would decide which
-- `device_tokens` this writes to.
set search_path = public
as $$
begin
  -- Signed out is not an error worth raising: the client fires this after a
  -- household is created or joined, and a session that has just expired should
  -- lose a notification rather than surface a failure.
  if auth.uid() is null then
    return;
  end if;

  -- A token is the address of a device and an empty one is not an address.
  if p_token is null or length(trim(p_token)) = 0 then
    return;
  end if;

  insert into device_tokens (user_id, token, platform, language, updated_at)
  values (auth.uid(), p_token, p_platform, p_language, now())
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        language = excluded.language,
        updated_at = now();
end;
$$;

revoke all on function register_device_token(text, text, text) from public;
grant execute on function register_device_token(text, text, text) to authenticated;

comment on function register_device_token is
  'Record this device''s Expo push token for the calling user. The user id is '
  'taken from auth.uid() rather than from the caller, and the upsert runs as '
  'definer so device_tokens can stay unreadable — see 0043.';
