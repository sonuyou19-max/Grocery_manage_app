-- ---------------------------------------------------------------------------
-- One "Onion" per list, even when two people add it at the same moment.
--
-- The client already refuses to add an item that's on the list — but it checks
-- against the copy of the list *it* holds. Two members adding "Onion" seconds
-- apart both look at a list that doesn't have it yet, both pass the check, and
-- both insert. Realtime then delivers each row to the other phone and the
-- household ends up with two. No amount of client-side care fixes this: the
-- check and the insert happen on different devices, so only the database sees
-- both in time.
--
-- So the rule moves to where both writes meet. `item_key` mirrors the client's
-- normalizeKey() — trim, collapse runs of whitespace, lowercase — as a stored
-- generated column, and a unique index on (list_id, item_key) over the *unticked*
-- rows makes the second insert fail instead of duplicating. The client turns that
-- failure into a refetch, so the loser of the race simply sees the row the
-- winner created, which is what they wanted anyway.
--
-- Why partial (`where not checked`):
--   * A ticked "Onion" is last week's shop. Buying onions again next week must
--     be allowed to create a new row, and a full unique index would block it.
--   * It's also the smaller index — most rows on an active list are unticked,
--     but history accumulates on the checked side.
--
-- The client's own duplicate check stays. It's still the right first line:
-- it gives the immediate, offline-capable "already on the list" answer without
-- a round trip. This is the backstop for the case it cannot see.
-- ---------------------------------------------------------------------------

-- Normalized identity, kept in step with the client's normalizeKey().
-- POSIX [[:space:]] rather than \s so tabs and non-breaking runs collapse the
-- same way the JS regex does. All three functions are IMMUTABLE, which a
-- generated column requires.
alter table list_items
  add column if not exists item_key text
    generated always as (lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))) stored;

-- Existing duplicates would make the index creation fail, so clear them first.
-- Only unticked rows in the same list with the same normalized name qualify —
-- these are exactly the accidental pairs the bug produced. The earliest row is
-- kept (it's the one whose id other clients already have); the later copies go.
delete from list_items dup
using list_items keep
where dup.list_id = keep.list_id
  and dup.item_key = keep.item_key
  and not dup.checked
  and not keep.checked
  and (keep.created_at, keep.id) < (dup.created_at, dup.id);

create unique index if not exists idx_items_unique_open
  on list_items (list_id, item_key)
  where not checked;

-- No RLS change: item_key is derived from a column the existing policies
-- already govern, and the index enforces a constraint rather than granting
-- any read.
