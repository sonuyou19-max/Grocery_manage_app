-- ---------------------------------------------------------------------------
-- When an item was ticked, so a finished shop can leave the list.
--
-- Ticked items stayed on their list forever. After a month of weekly shops a
-- list carried a hundred rows of which ten mattered, and the counter beside the
-- bag read "10/120 bought" — true, and a description of a list nobody would
-- recognise as their own.
--
-- The rule (lib/list-sweep.ts owns it, and is the only place it is written
-- down): a ticked item settles at the end of the local day it was ticked on,
-- and settled items leave the list. Until then it stays visible and untickable,
-- so a whole shopping trip remains one undoable unit. Unticked items never
-- settle however old — an unmet intention does not expire on its own.
--
-- `checked` alone cannot express that, because it says nothing about WHEN. This
-- adds the timestamp, set on tick and cleared on untick by the client.
--
-- Why the client sets it rather than a trigger: the same value has to exist on
-- device-local lists, which have no database at all, and one rule implemented
-- twice is how the two backends drift. The client writes both columns together
-- in the same UPDATE.
-- ---------------------------------------------------------------------------

alter table list_items
  add column if not exists checked_at timestamptz;

-- Backfill: every row already ticked is, by definition, from a shop that has
-- already happened — this backlog is exactly what the rule exists to clear.
-- created_at is the only timestamp those rows carry; it is when the item was
-- added rather than ticked, which is earlier or equal, so it can only make a
-- row settle sooner. For rows this old that is the intended outcome: they all
-- settle on the first launch after the update, and the lists come back.
update list_items
  set checked_at = created_at
  where checked and checked_at is null;

-- Unticked rows must have no timestamp, or unticking would leave a stale one
-- behind and the row could settle while still on the list.
update list_items
  set checked_at = null
  where not checked and checked_at is not null;

-- No index: the sweep addresses rows by list, and every query that reads items
-- already filters on list_id via idx_items_list. A partial index here would
-- cost writes on the hottest column in the table to serve a scan of a few
-- dozen rows.

-- No RLS change. checked_at is governed by the existing list_items policies —
-- it is written by the same UPDATE that writes `checked`, which those policies
-- already gate on household membership.
