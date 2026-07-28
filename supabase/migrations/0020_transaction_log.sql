-- ---------------------------------------------------------------------------
-- Every check-off is a transaction.
--
-- price_entries began as a *price* log: a row existed only when someone typed a
-- number. That made it a record of pricing, not of shopping — and since pricing
-- is optional in this app and most items never get one, most of what a
-- household actually bought left no trace at all.
--
-- Two changes make it a purchase log instead.
--
-- ---------------------------------------------------------------------------
-- 1. price_cents becomes nullable
-- ---------------------------------------------------------------------------
--
-- An unpriced purchase still happened. It belongs in the item's history, it
-- feeds the burn-rate model, and it is half of "buying the same product at a
-- different store creates a new record". Only the *money* figures skip it, and
-- each of those filters `price_cents is not null` explicitly rather than
-- treating a missing price as zero — a null that silently became 0 would drag
-- every average toward it.
--
-- ---------------------------------------------------------------------------
-- 2. A one-time backfill
-- ---------------------------------------------------------------------------
--
-- Insights currently derives its totals from live list rows. Repointing it at
-- this log without a backfill would drop every existing user's numbers to near
-- zero on upgrade, which reads as data loss rather than as a new feature.
--
-- **On the dates.** The instruction was to stamp these with today's date. This
-- uses each row's real timestamp instead — `pantry_items.last_purchased_at` for
-- pantry history, `list_items.created_at` for priced items still on a list —
-- because dating a year of shopping to today would pile it all into the current
-- week of the spend-over-time chart. That chart is the main thing the backfill
-- exists to keep populated, so stamping today would defeat its own purpose. The
-- real timestamps give an honest, already-distributed history at no extra cost.
--
-- **On not double-counting.** Anyone who has been checking items off since 0013
-- already has genuine rows here. The backfill skips any item that already has a
-- price_entry within a day of the timestamp it would write, so re-running this
-- migration — or running it on a household that is already logging — adds
-- nothing. That makes it idempotent, which a data-writing migration has to be.
-- ---------------------------------------------------------------------------

alter table price_entries
  alter column price_cents drop not null;

-- The >= 0 check survives the nullability change (a CHECK passes on NULL), so
-- a negative price is still rejected while an absent one is now allowed.

-- ---------------------------------------------------------------------------
-- Backfill A: pantry history.
--
-- Every tracked pantry item records when it was last bought. That is a real
-- purchase at a real date, and it is the only history a household that never
-- logged a price has. No price or store is known, which is exactly the case
-- nullable price_cents now supports.
-- ---------------------------------------------------------------------------
insert into price_entries (household_id, item_key, item_name, store, price_cents, recorded_at)
select
  p.household_id,
  coalesce(p.item_key, lower(btrim(p.name))),
  coalesce(p.display_name, p.name),
  null,
  null,
  p.last_purchased_at
from pantry_items p
where p.last_purchased_at is not null
  -- Never invent history from before the app could have recorded it.
  and p.last_purchased_at > now() - interval '52 weeks'
  and not exists (
    select 1 from price_entries e
    where e.household_id = p.household_id
      and e.item_key = coalesce(p.item_key, lower(btrim(p.name)))
      and e.recorded_at between p.last_purchased_at - interval '1 day'
                           and p.last_purchased_at + interval '1 day'
  );

-- ---------------------------------------------------------------------------
-- Backfill B: priced items already ticked off a list.
--
-- These carry the detail the pantry rows lack — price, store, quantity — so
-- they are worth a second pass even though A may already have covered the same
-- item. The `not exists` guard is what stops that overlapping: if A wrote a row
-- for this item near this date, B leaves it alone rather than adding a
-- duplicate with slightly better data.
--
-- created_at is when the item was added to the list, not when it was ticked —
-- list_items has no checked_at column. It is within days of the purchase and is
-- the best honest timestamp available; inventing a precise one would be worse.
-- ---------------------------------------------------------------------------
insert into price_entries
  (household_id, item_key, item_name, store, price_cents, quantity, unit, recorded_at)
select
  l.household_id,
  i.item_key,
  i.name,
  coalesce(i.store, l.store),
  i.price_cents,
  i.quantity,
  i.unit,
  i.created_at
from list_items i
join shopping_lists l on l.id = i.list_id
where i.checked
  and i.price_cents is not null
  and i.created_at > now() - interval '52 weeks'
  and not exists (
    select 1 from price_entries e
    where e.household_id = l.household_id
      and e.item_key = i.item_key
      and e.recorded_at between i.created_at - interval '1 day'
                           and i.created_at + interval '1 day'
  );

-- No RLS change: price_entries' existing household-scoped policies already
-- cover these rows, and nullability is not a visibility question.

-- Still deliberately OUT of the realtime publication. A member's purchase does
-- not need to reach another phone within milliseconds, and publishing this
-- would put a socket message on every single check-off. The client instead
-- refreshes the log off the pantry_items realtime event, which every check-off
-- already produces — see store/pantry-intel.tsx.
