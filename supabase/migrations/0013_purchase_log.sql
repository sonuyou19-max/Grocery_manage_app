-- ---------------------------------------------------------------------------
-- Purchase log: price history that survives the list it was logged on.
--
-- Insights can already group spend by store, but only across items *currently*
-- sitting on a list — delete the list and the history goes with it. Trends over
-- weeks need a record that outlives the list, and the same record makes the
-- restock predictions sharper, so it is built once and used twice.
--
-- No new table. `price_entries` was created in 0001 with exactly the right
-- shape (household_id, item_name, store, price_cents, currency, recorded_at)
-- and a working RLS policy; it was simply never written to. Adding a parallel
-- table would leave two sources of truth for the same fact.
--
-- What it needs to be useful:
--   * a normalized key, so "Milk", "milk " and "milk" are one item — the same
--     identity pantry_items got in 0006;
--   * quantity/unit, so €2 for 1L and €2 for 2L aren't read as the same price;
--   * an index that answers "this household's recent history" directly, which
--     is the only shape the Insights screen ever asks for.
-- ---------------------------------------------------------------------------

alter table price_entries
  add column if not exists item_key text,
  add column if not exists quantity numeric,
  add column if not exists unit text;

-- Backfill the key for any rows written before this migration. Matches the
-- client's normalizeKey (trim + lowercase); internal whitespace is left alone
-- because Postgres has no cheap equivalent of the client's \s+ collapse and
-- these rows are pre-launch anyway.
update price_entries
  set item_key = lower(btrim(item_name))
  where item_key is null;

-- Every read is "this household, newest first", optionally narrowed to one
-- item. A household+time index serves the spend trend; adding item_key in the
-- middle serves the per-item history from the same structure.
create index if not exists idx_prices_household_time
  on price_entries (household_id, recorded_at desc);

create index if not exists idx_prices_household_item_time
  on price_entries (household_id, item_key, recorded_at desc);

-- Deliberately NOT unique on (household_id, item_key): the whole point is one
-- row per purchase, so buying milk every week must append, never upsert.

-- Deliberately NOT added to supabase_realtime. Nothing watches this live — the
-- Insights screen reads it on open, and a log row arriving mid-session doesn't
-- change any decision on screen. Publishing it would push a message to every
-- member's socket on every single check-off, which is the noisiest table in the
-- schema for the least benefit.
