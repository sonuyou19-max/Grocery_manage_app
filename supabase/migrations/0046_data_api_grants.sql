-- ---------------------------------------------------------------------------
-- Restore the table grants the platform used to add for us.
--
-- Until now, every table in `public` reached the Data API for free: Supabase
-- granted the API roles — `anon`, `authenticated`, `service_role` — access to
-- new tables automatically, and this schema leaned on it entirely. There is not
-- one `grant ... on <table>` anywhere in 0001–0045; the only grants are
-- `grant execute on function` for the RPCs. RLS was written on every table, the
-- table grant was assumed.
--
-- From 30 October 2025 that automatic grant stops for new tables in `public`.
-- Existing databases keep the grants they already have, so PRODUCTION IS NOT
-- AFFECTED by this migration landing or not. What breaks is any schema rebuilt
-- from these migrations AFTER that date — a fresh project, a preview branch, a
-- local `supabase db reset` — where the tables are created anew and now arrive
-- with no grant. supabase-js then gets `permission denied` on `.from(...)` for
-- the fifteen tables the app reads and writes directly, and no RLS policy is
-- ever consulted: the grant is the gate that opens before RLS, and without it
-- the row rules never run.
--
-- ---------------------------------------------------------------------------
-- Why a blanket grant is safe here
-- ---------------------------------------------------------------------------
--
-- RLS is the real gate on every one of these tables, and it is unchanged. A
-- grant only lets a role ATTEMPT an operation; which rows it may actually touch
-- is still decided by the policies already in force. A table with no policy for
-- an operation refuses it whatever the grant says. So granting full CRUD to
-- `anon` and `authenticated` restores exactly the access the platform used to
-- give — no more — and the service-side tables (`subscriptions`, `ai_usage`,
-- `scan_jobs`, …) stay shut to clients because their RLS says so, not because
-- the grant was withheld.
--
-- Matching the old behaviour deliberately: full privileges to all three API
-- roles on every existing table, so a fresh schema behaves identically to the
-- one in production today.
--
-- ---------------------------------------------------------------------------
-- Idempotent, and ordered after every CREATE TABLE
-- ---------------------------------------------------------------------------
--
-- GRANT is idempotent, so this is correct whether a database already has these
-- grants (production — a no-op) or is building from scratch (a fresh reset —
-- the whole point). It is a new migration rather than an edit to each table's
-- own: an edited migration never re-runs on a database that already applied it,
-- so the grant would silently never land where it matters.
-- ---------------------------------------------------------------------------

grant all on public.subscriptions            to anon, authenticated, service_role;
grant all on public.households               to anon, authenticated, service_role;
grant all on public.household_members        to anon, authenticated, service_role;
grant all on public.shopping_lists           to anon, authenticated, service_role;
grant all on public.list_items               to anon, authenticated, service_role;
grant all on public.pantry_items             to anon, authenticated, service_role;
grant all on public.consumption_events       to anon, authenticated, service_role;
grant all on public.price_entries            to anon, authenticated, service_role;
grant all on public.ai_usage_global          to anon, authenticated, service_role;
grant all on public.scan_jobs                to anon, authenticated, service_role;
grant all on public.ai_usage                 to anon, authenticated, service_role;
grant all on public.item_swaps               to anon, authenticated, service_role;
grant all on public.household_recaps         to anon, authenticated, service_role;
grant all on public.item_lexicon             to anon, authenticated, service_role;
grant all on public.item_lexicon_sightings   to anon, authenticated, service_role;
grant all on public.device_tokens            to anon, authenticated, service_role;
grant all on public.household_join_requests  to anon, authenticated, service_role;
grant all on public.receipts                 to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- And keep it from recurring.
--
-- The grants above cover the eighteen tables that exist as of 0045. A table
-- added in 0047+ would hit the exact same wall on a fresh schema unless its own
-- migration remembers to grant — which is precisely the kind of thing that is
-- forgotten, because it was never needed before. Default privileges restore the
-- old automatic behaviour for anything this migration role creates from here on,
-- so a future table is granted the moment it is created, the way it always was.
--
-- This affects only objects created AFTER this runs, which is why the explicit
-- grants above are still required for 0001–0045: those tables are created
-- earlier in the same reset, before this statement is in force.
--
-- No sequences clause: every primary key in this schema is a uuid default, so
-- there is no sequence for an INSERT to need USAGE on.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
