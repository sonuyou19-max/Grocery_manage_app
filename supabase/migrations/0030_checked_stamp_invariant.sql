-- ---------------------------------------------------------------------------
-- `checked` and `checked_at` must agree.
--
-- Migration 0029 added `checked_at` and the client writes both columns in one
-- UPDATE. That is discipline, not a guarantee: nothing stopped a future edit,
-- a hand-run SQL fix, or a build that predates 0029 from setting one without
-- the other, and neither disagreeing state is harmless.
--
--   checked = true,  checked_at = null
--       lib/list-sweep.isSettled treats a ticked row with no stamp as settled —
--       that is how 0029's backfill clears the old backlog. So a row written in
--       this state settles the instant it is read: the user ticks an item and
--       watches it vanish from the list rather than move to the section below.
--
--   checked = false, checked_at = <a time>
--       Harmless today, because isSettled short-circuits on `checked` before it
--       looks at the stamp. It is forbidden anyway. The value is a lie about
--       when something happened, and the only reason it is currently inert is
--       the order of two lines in one function — which is not a thing to build
--       a data invariant on.
--
-- Expressed as an equivalence rather than two separate NOT NULL-ish rules,
-- because that is exactly what it is: the stamp exists if and only if the row
-- is ticked.
-- ---------------------------------------------------------------------------

-- Repair before constraining. 0029 left the table consistent, but a client
-- running between then and now could have written either state, and a failed
-- ALTER here is a migration the operator has to debug by hand at deploy time.
-- Both repairs are the same ones 0029 performed, so re-running them is a no-op
-- on a healthy table.
update list_items
  set checked_at = created_at
  where checked and checked_at is null;

update list_items
  set checked_at = null
  where not checked and checked_at is not null;

-- Idempotent: `add constraint` has no IF NOT EXISTS, so this is guarded.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'list_items_checked_stamp'
      and conrelid = 'list_items'::regclass
  ) then
    alter table list_items
      add constraint list_items_checked_stamp
      check (checked = (checked_at is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Deploy order
--
-- This REJECTS writes from any client that sets `checked` without
-- `checked_at` — which is every build older than 0029. Apply it with the build
-- that carries the new client, never ahead of one, or ticking an item stops
-- working on phones that have not updated.
--
-- No RLS change: a CHECK constraint governs values, not visibility, and the
-- existing list_items policies already gate who may write these columns.
-- ---------------------------------------------------------------------------
