-- ---------------------------------------------------------------------------
-- Post-migration verification.
--
-- Run this in the Supabase SQL editor AFTER `supabase db push`. Every row must
-- say PASS. It checks the things the app actually depends on at runtime, so a
-- partially-applied migration shows up here rather than as a confusing failure
-- on a phone.
--
-- Safe to run any number of times: it only reads catalog tables.
--
-- Three things this file is careful about, all learned the hard way:
--   * `check` is a reserved word — legal as an AS label but not as a bare
--     column reference, so the column is `check_name`.
--   * every catalog lookup is schema-qualified to `public`; an unqualified
--     information_schema match would pass on a same-named table in another
--     schema.
--   * has_function_privilege() *errors* on a missing function rather than
--     returning false, so the privilege checks are guarded by an existence
--     test — otherwise a database missing 0012 fails the whole query instead
--     of reporting one FAIL.
-- ---------------------------------------------------------------------------

with
-- Does a public.<table>.<column> exist?
col as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
),
-- Does the function 0012 adds exist? Gates the privilege checks below.
fn as (
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_display_name'
  ) as set_display_name_exists
),
checks as (
  -- 0011 · weekly recap language
  select '0011 household_recaps.language' as check_name,
         exists (select 1 from col where table_name = 'household_recaps' and column_name = 'language') as ok

  -- 0012 · one name across every household, and the household cap
  union all select '0012 set_display_name() exists',
         (select set_display_name_exists from fn)

  -- 0016 · that RPC is authenticated-only, like every other definer function.
  -- `and` short-circuits left to right here, so the privilege call is never
  -- reached when the function is absent.
  union all select '0016 set_display_name not executable by anon',
         (select set_display_name_exists from fn)
         and not has_function_privilege('anon', 'set_display_name(text)', 'execute')
  union all select '0016 set_display_name executable by authenticated',
         (select set_display_name_exists from fn)
         and has_function_privilege('authenticated', 'set_display_name(text)', 'execute')

  -- 0013 · purchase log (spend over time)
  union all select '0013 price_entries.item_key',
         exists (select 1 from col where table_name = 'price_entries' and column_name = 'item_key')
  union all select '0013 price_entries.quantity',
         exists (select 1 from col where table_name = 'price_entries' and column_name = 'quantity')
  union all select '0013 price_entries.unit',
         exists (select 1 from col where table_name = 'price_entries' and column_name = 'unit')
  union all select '0013 index idx_prices_household_time',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_prices_household_time')
  union all select '0013 index idx_prices_household_item_time',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_prices_household_item_time')
  -- price_entries must stay OUT of realtime: publishing it would push a socket
  -- message to every member on every single check-off.
  union all select '0013 price_entries NOT in realtime (intentional)',
         not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public'
                       and tablename = 'price_entries')

  -- 0014 · recurring staples
  union all select '0014 pantry_items.keep_stocked',
         exists (select 1 from col where table_name = 'pantry_items' and column_name = 'keep_stocked')
  union all select '0014 pantry_items.cadence_days',
         exists (select 1 from col where table_name = 'pantry_items' and column_name = 'cadence_days')
  union all select '0014 index idx_pantry_staples',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_pantry_staples')

  -- 0015 · item claiming
  union all select '0015 list_items.claimed_by',
         exists (select 1 from col where table_name = 'list_items' and column_name = 'claimed_by')
  union all select '0015 list_items.claimed_at',
         exists (select 1 from col where table_name = 'list_items' and column_name = 'claimed_at')
  union all select '0015 index idx_items_claimed',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_items_claimed')
  -- Claims are useless unless they reach the other phone within seconds.
  union all select '0015 list_items IS in realtime (required)',
         exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'list_items')

  -- 0017 · resting (pantry archive)
  union all select '0017 pantry_items.archived_at',
         exists (select 1 from col where table_name = 'pantry_items' and column_name = 'archived_at')
  union all select '0017 index idx_pantry_active',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_pantry_active')

  -- 0018 · no duplicate open items
  union all select '0018 list_items.item_key',
         exists (select 1 from col where table_name = 'list_items' and column_name = 'item_key')
  union all select '0018 index idx_items_unique_open',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_items_unique_open')
  -- The index is only a fix if it is actually UNIQUE and actually PARTIAL:
  -- non-unique lets the duplicate through, non-partial blocks re-buying an item
  -- ticked off last week. Both are silent failures, so both are checked.
  union all select '0018 idx_items_unique_open is unique + partial',
         coalesce((select i.indisunique and i.indpred is not null
                   from pg_index i
                   join pg_class c on c.oid = i.indexrelid
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'idx_items_unique_open'), false)

  -- Pre-existing invariants the new columns rely on. RLS off on any of these
  -- would expose one household's data to another.
  union all select 'RLS on list_items',
         coalesce((select c.relrowsecurity from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'list_items'), false)
  union all select 'RLS on pantry_items',
         coalesce((select c.relrowsecurity from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'pantry_items'), false)
  union all select 'RLS on price_entries',
         coalesce((select c.relrowsecurity from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'price_entries'), false)
  union all select 'pantry_items in realtime (shared deck)',
         exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'pantry_items')
)
select case when ok then 'PASS' else '*** FAIL ***' end as result, check_name
from checks
order by ok, check_name;
