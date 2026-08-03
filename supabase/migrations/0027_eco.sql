-- ---------------------------------------------------------------------------
-- Sustainability: a shared climate band per term, and a per-item bio/local flag.
--
-- Two columns doing quite different jobs, which is why the reasoning below is
-- split rather than shared.
--
-- ---------------------------------------------------------------------------
-- item_lexicon.carbon — a fact about a WORD
-- ---------------------------------------------------------------------------
--
-- "Beef is high impact" is true for every household in Europe, exactly like
-- "milk is measured in litres" (0021) and "an apple is 🍎" (0019). So it rides
-- the lexicon: asked of the model once, ever, per term, on a call the
-- categorize function was already making, and published so the next person to
-- type the word gets it for nothing.
--
-- It is deliberately the LAST source the client consults. lib/eco.ts resolves
-- the terms that actually move a basket from a table in code, because this
-- feature is a comparison and a comparison needs the same answer on every
-- device — two members of one household must not see different dots on the
-- same row. The lexicon fills the long tail, where being consistent matters
-- more than being precise and where there is no local answer at all.
--
-- NULL means the model was asked and declined, or was never asked. As with
-- unit, the client cannot act differently on those two and so does not try:
-- both fall through to the food-group default.
--
-- ---------------------------------------------------------------------------
-- bio — a fact about YOUR SHOPPING
-- ---------------------------------------------------------------------------
--
-- The opposite kind of thing. Whether the milk you bought was organic is not a
-- property of the word "milk", it is a property of that purchase, so it lives
-- on the row and never goes near the lexicon.
--
-- It is added in two places for the same reason `category` was in 0023: an
-- insight computed from the live list dies when the list is deleted. The list
-- item carries it so the basket bar on an open list is live; the purchase log
-- carries a copy so the weekly and by-shop history survives the list being
-- cleared, which is the whole point of an event log.
--
-- NOT NULL DEFAULT false, unlike almost every other optional field here. A
-- nullable boolean would have three states for a checkbox that has two, and
-- "unknown" and "not organic" are the same thing to every calculation that
-- reads it. Existing rows becoming false is correct, not a backfill guess:
-- nobody could have ticked a box that did not exist.
--
-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Nothing to add, and that is worth stating rather than leaving implied. Both
-- new columns sit on tables whose policies are row-scoped to the household
-- (list_items via its list, price_entries directly), and adding a column to a
-- row does not widen who can see the row. item_lexicon still has no client
-- write policy at all — that absence is the control, and the CHECK below is
-- the second line: a bad generation that slips past the function's own
-- validation still cannot put a junk band in front of every customer.
-- ---------------------------------------------------------------------------

alter table item_lexicon
  add column if not exists carbon text
  check (carbon is null or carbon in ('low', 'medium', 'high'));

-- No index: carbon is only ever read as a column of a row already being
-- fetched by term or by the published/updated_at delta, never filtered on.

alter table list_items
  add column if not exists bio boolean not null default false;

alter table price_entries
  add column if not exists bio boolean not null default false;

-- No index on either bio column. Both are read as part of rows already being
-- fetched by list or by household+date, and a boolean that is false for the
-- overwhelming majority of rows is close to the worst possible index key.
