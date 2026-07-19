-- ---------------------------------------------------------------------------
-- Pantry Vibe Check: shared-household stats.
--
-- The learning engine moves off-device onto the existing pantry_items table so
-- every member's check-offs feed one shared burn-rate. We add the few columns
-- the engine tracks beyond the original scaffold, key rows by a normalized name
-- for clean upserts, and turn on realtime so the deck stays in sync live.
-- ---------------------------------------------------------------------------

alter table pantry_items
  add column if not exists item_key text,
  add column if not exists display_name text,
  add column if not exists sample_count integer not null default 0,
  add column if not exists snooze_until timestamptz;

-- Backfill the normalized key + display name for any pre-existing rows.
update pantry_items
  set item_key = lower(btrim(name)),
      display_name = coalesce(display_name, name)
  where item_key is null;

-- One row per normalized item per household — the conflict target for upserts.
create unique index if not exists idx_pantry_household_key
  on pantry_items (household_id, item_key);

-- Live sync of the shared deck between members.
alter publication supabase_realtime add table pantry_items;
