-- ---------------------------------------------------------------------------
-- The shared lexicon learns units too.
--
-- 0019 made a term's emoji and category a fact worth learning once and sharing
-- with everyone. Its unit is the same kind of fact: milk is litres and potatoes
-- are kilos for every household in Europe, not just the one that happened to
-- ask. Adding it here means the model is asked once, ever, per term — the
-- categorize function already resolves this term, so the unit rides along on a
-- call that was being made anyway and costs a handful of output tokens.
--
-- ---------------------------------------------------------------------------
-- Why nullable, and why that is not the same as "no answer yet"
-- ---------------------------------------------------------------------------
--
-- NULL here means the model was asked and was NOT confident — sriracha could
-- reasonably be ml or g, so it declines rather than guessing. That is a real
-- answer and the client honours it by leaving the picker empty for the user to
-- set, instead of falling back to a category default that would be a guess
-- wearing a confident face.
--
-- It follows that the client must distinguish "row absent" from "row present
-- with unit null", and it does — see unitFor() in lib/item-unit.ts.
--
-- ---------------------------------------------------------------------------
-- Gates
-- ---------------------------------------------------------------------------
--
-- Unchanged, and they did not need changing. A unit is written by the same
-- service-role path, on the same row, published under the same four gates as
-- the emoji and category (0019). There are still no client write policies on
-- this table; that absence is the control. The one thing added is a CHECK, so
-- a bad generation that slipped past the function's own validation still cannot
-- put a junk unit in front of every customer.
-- ---------------------------------------------------------------------------

alter table item_lexicon
  add column if not exists unit text
  check (unit is null or unit in ('g', 'kg', 'ml', 'L', 'pcs'));

-- No index: the unit is only ever read as a column of a row already being
-- fetched by term or by the published/updated_at delta, never filtered on.

-- No backfill. Existing rows keep unit NULL, which reads as "not established
-- yet" rather than as a wrong answer — the client falls through to its own
-- curated table and category defaults for those terms, exactly as it does
-- today. The rows fill in as the model is asked about each term again.
--
-- Note this makes NULL slightly overloaded: "never asked" and "asked, not
-- confident" look the same in the column. That is deliberate — separating them
-- would need a second column to serve a distinction the client cannot act on
-- differently anyway, since both end in "leave it to the user".
