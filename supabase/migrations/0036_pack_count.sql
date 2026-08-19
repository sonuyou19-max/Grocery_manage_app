-- ---------------------------------------------------------------------------
-- How MANY of the thing was bought, as its own number.
--
-- The model had a size and a price and no count. Four 250 ml pots of cream at
-- €2.50 each had nowhere to say "four": the shopper had to work out €10.00 in
-- their head, type that, and then decide whether `quantity` meant 250 or 1000.
-- Both answers were defensible and neither was recorded, so the same shop
-- entered twice could produce two different unit prices.
--
-- So `quantity` now means the size of ONE pack — the number on the label — and
-- `packs` is how many went in the trolley. Total volume is quantity × packs, and
-- price_cents keeps the meaning it has always had: the total actually paid.
--
-- ---------------------------------------------------------------------------
-- Why this cannot disturb existing price history
-- ---------------------------------------------------------------------------
--
-- Everything already recorded is one pack as far as the old model was
-- concerned, so the default is 1 and:
--
--   unitPrice = price_cents / (quantity * packs)
--             = price_cents / (quantity * 1)
--             = price_cents / quantity        -- exactly the old formula
--
-- Every historical row therefore keeps the identical unit price and stays
-- comparable with new ones. No backfill, no re-interpretation of old data, and
-- lib/purchase-log.ts can change its formula without a migration of its own.
--
-- `not null default 1` rather than a nullable column: "how many did you buy" has
-- no meaningful unknown state — the answer is at least one, or the row would not
-- exist — and a nullable count would put a `?? 1` at every read site, which is
-- the same default written eight times where it can drift.
-- ---------------------------------------------------------------------------

alter table list_items
  add column if not exists packs integer not null default 1
    check (packs > 0 and packs <= 999);

-- The same on the price log, or the count is lost the moment an item is checked
-- off and becomes history — which is precisely where the per-unit comparisons
-- are computed from.
alter table price_entries
  add column if not exists packs integer not null default 1
    check (packs > 0 and packs <= 999);

-- The ceiling is a typo guard, not a limit anybody will meet: 999 packs of
-- anything is a keying accident, and an unbounded integer here would let one
-- fat-fingered "4444" flatten a household's whole unit-price history for that
-- item. The floor matters more — zero would make quantity × packs zero and turn
-- every unit price into a division by zero.

-- No index: packs is never a lookup key, only ever read alongside the row it
-- belongs to.
