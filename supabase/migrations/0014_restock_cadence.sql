-- ---------------------------------------------------------------------------
-- Recurring staples: "always keep this in stock", on a cadence you choose.
--
-- The burn-rate engine learns intervals by watching check-offs, which is right
-- most of the time and wrong in two specific cases:
--
--   * it has no history yet, so it falls back to a category default that may be
--     nowhere near your household's actual rhythm;
--   * it learned from irregular shopping and settled on an interval you disagree
--     with.
--
-- Both are the same fix: let the user state the interval, and treat that as
-- authoritative. `cadence_days` slots in *above* the learned rate in the
-- client's precedence chain (cadence → learned → category default), so
-- everything already reading the interval — the due date, the Vibe Check deck,
-- the weekly list builder — picks it up with no further change.
--
-- `keep_stocked` is the separate, weaker claim: "this is a staple." It doesn't
-- change when the item comes due, only how prominently it's surfaced when it
-- does. Kept as its own column rather than inferred from cadence_days being set,
-- because the two are genuinely independent: you can want a fixed cadence on a
-- non-staple, and mark a staple while still letting Korb learn its rhythm.
-- ---------------------------------------------------------------------------

alter table pantry_items
  add column if not exists keep_stocked boolean not null default false,
  -- Null means "keep learning it" — the absence of an override, not zero days.
  add column if not exists cadence_days integer
    check (cadence_days is null or (cadence_days >= 1 and cadence_days <= 365));

-- Staples are the rows the client asks for by flag when building a list, and
-- they're a small minority of the table, so a partial index keeps it cheap.
create index if not exists idx_pantry_staples
  on pantry_items (household_id)
  where keep_stocked;

-- No RLS change: the existing "members manage pantry" policy is table-wide, and
-- these are columns on rows it already covers.

-- Already published to supabase_realtime (0006), so marking a staple syncs to
-- other members live with nothing further to do here.
