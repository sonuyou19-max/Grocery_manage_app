-- ---------------------------------------------------------------------------
-- Pre-push diagnosis: what does the remote database ACTUALLY have?
--
-- `supabase migration list` showed an empty Remote column for 0001–0016 plus
-- two unknown timestamped migrations. That is a statement about the migration
-- *ledger*, not about the schema — the tables can be fully present while the
-- ledger has no record of how they got there (dashboard SQL editor runs, a
-- `db reset` against a different local history, or an early push under different
-- filenames all produce exactly this).
--
-- Which of those two worlds we're in decides everything:
--
--   * schema present, ledger empty  → `migration repair` to mark the already-
--     applied ones, then push only what's genuinely new. NEVER a plain push,
--     which would try to re-create existing tables.
--   * schema genuinely missing      → a plain push is correct.
--
-- Run all three sections in the Supabase SQL editor and send back the output.
-- Read-only: touches nothing but catalog tables.
-- ---------------------------------------------------------------------------


-- SECTION 1 ─ What the ledger thinks. Identifies those two mystery migrations.
select version,
       name,
       -- Just the shape, not the whole body — enough to recognise what it was.
       coalesce(array_length(statements, 1), 0) as statement_count,
       left(coalesce(statements[1], ''), 120) as first_statement
from supabase_migrations.schema_migrations
order by version;


-- SECTION 2 ─ Which core tables exist. This is the decisive question:
-- all present → the schema is there and the ledger is just out of step.
select expected.table_name,
       case when t.table_name is null then '*** MISSING ***' else 'present' end as status
from (values
        ('households'),
        ('household_members'),
        ('shopping_lists'),
        ('list_items'),
        ('pantry_items'),
        ('consumption_events'),
        ('price_entries'),
        ('household_recaps'),
        ('ai_usage')
     ) as expected(table_name)
left join information_schema.tables t
       on t.table_name = expected.table_name
      and t.table_schema = 'public'
order by status, expected.table_name;


-- SECTION 3 ─ Which migration's worth of objects is present, newest first.
-- Tells us exactly where the remote schema stops, so we know what to repair as
-- applied and what still has to run.
with objects as (
  select '0016 set_display_name authenticated-only' as feature,
         (select not has_function_privilege('anon', 'set_display_name(text)', 'execute')
          where exists (select 1 from pg_proc where proname = 'set_display_name')) as present
  union all select '0015 list_items.claimed_by',
         exists (select 1 from information_schema.columns
                 where table_name = 'list_items' and column_name = 'claimed_by')
  union all select '0014 pantry_items.cadence_days',
         exists (select 1 from information_schema.columns
                 where table_name = 'pantry_items' and column_name = 'cadence_days')
  union all select '0013 price_entries.item_key',
         exists (select 1 from information_schema.columns
                 where table_name = 'price_entries' and column_name = 'item_key')
  union all select '0012 set_display_name() exists',
         exists (select 1 from pg_proc where proname = 'set_display_name')
  union all select '0011 household_recaps.language',
         exists (select 1 from information_schema.columns
                 where table_name = 'household_recaps' and column_name = 'language')
  union all select '0010 ai_usage table',
         exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'ai_usage')
  union all select '0009 delete_account()',
         exists (select 1 from pg_proc where proname = 'delete_account')
  union all select '0008/0004 leave_household()',
         exists (select 1 from pg_proc where proname = 'leave_household')
  union all select '0007 household_recaps table',
         exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'household_recaps')
  union all select '0006 pantry_items.item_key',
         exists (select 1 from information_schema.columns
                 where table_name = 'pantry_items' and column_name = 'item_key')
  union all select '0005 households in realtime',
         exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'households')
  union all select '0003 list_items.store',
         exists (select 1 from information_schema.columns
                 where table_name = 'list_items' and column_name = 'store')
  union all select '0002 create_household()',
         exists (select 1 from pg_proc where proname = 'create_household')
  union all select '0001 households table',
         exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'households')
)
select feature,
       case when coalesce(present, false) then 'present' else '*** MISSING ***' end as status
from objects
order by feature desc;
