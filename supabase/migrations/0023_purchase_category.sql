-- ---------------------------------------------------------------------------
-- The purchase log carries its own category.
--
-- The log is becoming the single source of truth for everything Korb knows
-- about a household's shopping. Restock cadence stops being stored state and
-- becomes a computation over these rows; the pantry is rebuilt from them when a
-- guest signs up and brings their history along.
--
-- That only works if the rows are self-sufficient, and they were one field
-- short. Category lived only on pantry_items, so rebuilding the pantry FROM the
-- log would have produced a pantry with no categories in it — and category is
-- not decoration here: it drives the Pantry's sections, the Insights
-- breakdown, the aisle ordering on a list, and the weekly builder.
--
-- ---------------------------------------------------------------------------
-- Why a column rather than re-deriving from the name
-- ---------------------------------------------------------------------------
--
-- The client could run each item_name back through its keyword map and the
-- shared lexicon, and for most items it would land on the same answer for free.
-- "Most" is the problem. An item the user moved by hand out of Other and into
-- Pantry would snap straight back to the guess — at the exact moment we are
-- asking them to trust us with a year of their shopping. A category the user
-- chose is a decision, and decisions are exactly what a log of events is
-- otherwise bad at keeping.
--
-- ---------------------------------------------------------------------------
-- Nullable, and backfilled where we can
-- ---------------------------------------------------------------------------
--
-- Nullable because every existing row predates the column and there is no
-- honest value to invent for them. Null means "not recorded", and the client
-- falls back to its own categorisation for those — the same behaviour as today,
-- so nothing regresses.
--
-- The backfill recovers what is recoverable: pantry_items already holds a
-- category per (household, item), and that is precisely the value that would
-- have been written had the column existed. It is a join, not a guess.
-- ---------------------------------------------------------------------------

alter table price_entries
  add column if not exists category item_category;

-- Recover the category for every logged purchase whose item is still tracked in
-- the household's pantry. Rows for items since deleted from the pantry stay
-- null, which is correct — we genuinely do not know what they were.
update price_entries e
set category = p.category
from pantry_items p
where p.household_id = e.household_id
  and p.item_key = e.item_key
  and e.category is null
  and p.category is not null;

-- Idempotent: the `e.category is null` guard means a second run updates nothing,
-- and a row whose category was later corrected by the client is not reverted to
-- whatever the pantry happens to say today.

-- No index. Category is read as a column of rows already being fetched by
-- household and time window, never filtered on by itself.

-- No RLS change: price_entries' existing household-scoped policies cover this
-- column like any other, and a category is not a visibility question.
