-- ---------------------------------------------------------------------------
-- Realtime for households: renaming the household should show up live on every
-- member's device, not only after the next foreground/poll refresh.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table households;
