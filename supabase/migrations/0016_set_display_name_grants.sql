-- ---------------------------------------------------------------------------
-- Lock down set_display_name to match every other RPC in this schema.
--
-- 0002 established the pattern for definer functions: revoke EXECUTE from
-- public/anon, then grant it to `authenticated`. `set_display_name` (0012) was
-- added without it, so it inherited Postgres's default of EXECUTE to PUBLIC —
-- which includes the `anon` role.
--
-- The function is not exploitable as written (it raises `not_authenticated`
-- when auth.uid() is null, and only ever touches rows belonging to the caller),
-- so this is defence-in-depth and consistency rather than a fix for a live hole.
-- Worth doing anyway: "every definer RPC is authenticated-only" is a rule that
-- is cheap to hold and expensive to rediscover.
--
-- Deliberately a separate migration rather than an edit to 0012: if 0012 has
-- already been applied to a database, editing it would never re-run and the
-- grant would silently never land. GRANT/REVOKE are idempotent, so this is
-- correct whether 0012 went in a minute ago or a month ago.
-- ---------------------------------------------------------------------------

revoke execute on function set_display_name(text) from public, anon;
grant execute on function set_display_name(text) to authenticated;
