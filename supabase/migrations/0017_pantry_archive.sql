-- ---------------------------------------------------------------------------
-- Resting: retire an item from prediction without losing it.
--
-- Korb learns from every check-off, which is the right default and occasionally
-- the wrong one. You buy a jar of tahini once for a recipe; six weeks later the
-- Vibe Check is still politely asking whether you're running low on tahini. The
-- existing tools don't fit: "Still good" only snoozes, so it comes back, and
-- there is no delete — deleting would throw away the purchase history the item
-- has already contributed to the household's spend and price trends.
--
-- So: a third state. An item that is *resting* keeps every byte of its history
-- and stops being predicted. It leaves the Vibe Check deck, leaves Running low
-- and In stock, and stops being offered by the weekly list builder. It sits on
-- its own quiet shelf in the Pantry until the user brings it back.
--
-- Stored as a timestamp rather than a boolean because "when did we stop caring
-- about this" is worth knowing: the client shows "Resting since March", which
-- is what tells you whether bringing it back is a good idea.
--
-- Deliberately NOT a filter on the purchase log. price_entries rows are history
-- and stay exactly as they are; resting only changes what Korb predicts.
-- ---------------------------------------------------------------------------

alter table pantry_items
  -- Null = actively tracked. Non-null = resting since that moment.
  add column if not exists archived_at timestamptz;

-- Every prediction path filters `archived_at is null`, and resting items are
-- the minority, so the partial index covers the common read rather than the
-- rare one.
create index if not exists idx_pantry_active
  on pantry_items (household_id)
  where archived_at is null;

-- No RLS change: the existing "members manage pantry" policy is table-wide, and
-- this is a column on rows it already covers.

-- Already published to supabase_realtime (0006), so one member resting an item
-- reaches the others live with nothing further to do here.
