-- ---------------------------------------------------------------------------
-- APPLY the renames you approved. Irreversible once committed.
--
-- This is deliberately NOT a migration. It is a one-off correction to one
-- household's data, driven by a mapping a person has read — running it
-- automatically anywhere would be wrong, and a migration is a thing that runs
-- automatically everywhere.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT
-- ---------------------------------------------------------------------------
--
--   1. Run receipt-names-inspect.sql and read the output.
--   2. Paste the pairs you approve into `approved` below — the CURRENT key on
--      the left, the name you want on the right. Delete the rest. Nothing not
--      listed there is touched.
--   3. Run this file. It ends in ROLLBACK, so the first run changes NOTHING and
--      prints exactly what it would have done.
--   4. Read that. If it is right, change the last line to COMMIT and run again.
--
--     psql "$DATABASE_URL" -f supabase/cleanup/receipt-names-apply.sql
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES, AND WHAT IT COSTS
-- ---------------------------------------------------------------------------
--
-- The purchases move first and move exactly. Every price_entries row for the
-- old key is renamed, so the price history follows the item rather than being
-- orphaned under a name nothing points at any more. That half is lossless.
--
-- The pantry then collapses. Several old rows can land on one name — and here
-- they will, because a pantry already holding "Onion" and "Red onion 750
-- grams" is exactly the mess this exists to clean up. For each target name one
-- row SURVIVES and the rest are folded into it and deleted.
--
-- The survivor is chosen, in order:
--   1. a row that already holds the target name and was NOT listed for
--      renaming — it is the one the household has been using, and its settings
--      are the ones somebody chose on purpose;
--   2. otherwise the listed row with the most purchases behind it.
--
-- What the fold costs, precisely:
--   * the survivor's decisions win — keep_stocked, cadence_days, snooze_until,
--     archived_at, home_list_id, category. Nothing here can reconstruct a
--     choice, so it keeps the one that is already there and discards the other.
--   * `last_purchased_at` becomes the latest across everything merged, which is
--     simply true.
--   * the RHYTHM is left exactly as it is, and that is a deliberate reversal.
--
--     This first recomputed it as the mean gap across the merged log, which
--     looked more thorough and was worse. A test pantry buying milk weekly —
--     nine samples, every 6.2 days — merged one four-month-old receipt import
--     and came out predicting every 57.5 days. The mean is a bad estimator over
--     a history with one ancient outlier in it, and the survivor's own number
--     was learned from far more evidence than the row being folded in.
--
--     So: nothing is recomputed. The merged rows contribute their purchases to
--     the log, where they belong, and the app blends the next real purchase in
--     the way it always does. A rhythm that is slightly stale re-converges; a
--     rhythm replaced by a wrong one just predicts wrongly.
--
-- Nothing else in the database refers to these names, so nothing else moves.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

create temporary table approved (old_key text primary key, new_name text not null) on commit drop;

-- ===========================================================================
-- PASTE YOUR APPROVED MAPPING HERE. The examples are shaped like the inspect
-- output and are commented out; nothing runs until you put real rows in.
--
-- Several old keys MAY point at the same new name. That is the normal case and
-- is handled — they are merged into one item.
-- ===========================================================================
insert into approved (old_key, new_name) values
  -- ('provital toast 50 pieces',       'toast'),
  -- ('1 litre delhaize full fat milk', 'milk'),
  -- ('pink lady apple 6 pieces',       'apples'),
  -- ('red onion 750 grams',            'onions'),
  -- ('onion',                          'onions'),   -- two rows, one item
  ('__none__', '__none__');
delete from approved where old_key = '__none__';

/*
 * The normalised target, computed exactly as the app's normalizeKey does —
 * migration 0018's generated column, the same three steps in the same order.
 * If these ever disagree the rename lands on a key nothing reads.
 */
create temporary table plan on commit drop as
select
  p.id           as pantry_id,
  p.household_id,
  p.created_at,
  a.old_key,
  a.new_name,
  lower(btrim(regexp_replace(a.new_name, '[[:space:]]+', ' ', 'g'))) as new_key,
  (select count(*) from price_entries e
    where e.household_id = p.household_id and e.item_key = a.old_key) as purchases
from approved a
join pantry_items p on p.item_key = a.old_key;

-- A listed key that matches no pantry row is almost always a typo in the paste,
-- and silently doing nothing about it is how half a cleanup gets missed.
select 'listed but not found — check the spelling' as warning, a.old_key
  from approved a
 where not exists (select 1 from plan pl where pl.old_key = a.old_key);

/*
 * One survivor per target name.
 *
 * `unique (household_id, item_key)` means the collapse has to be decided before
 * anything is written, not discovered by a constraint violation halfway
 * through. `keeper` is the row that ends up holding the name; `merges` is
 * everything else pointing at it.
 */
create temporary table keeper on commit drop as
select distinct on (pl.household_id, pl.new_key)
  pl.household_id,
  pl.new_key,
  pl.new_name,
  -- An existing row that was not itself listed outranks every listed row, and
  -- is kept as-is rather than renamed: it already holds the name.
  coalesce(q.id, pl.pantry_id) as keeper_id,
  (q.id is not null)           as keeper_already_named
from plan pl
left join pantry_items q
       on q.household_id = pl.household_id
      and q.item_key     = pl.new_key
      and not exists (select 1 from plan p2 where p2.pantry_id = q.id)
order by pl.household_id, pl.new_key,
         -- Existing row first; then the listed row with the most history.
         (q.id is not null) desc, pl.purchases desc, pl.created_at asc, pl.pantry_id asc;

create temporary table merges on commit drop as
select pl.*, k.keeper_id
  from plan pl
  join keeper k on k.household_id = pl.household_id and k.new_key = pl.new_key
 where pl.pantry_id <> k.keeper_id;

select 'pantry rows listed'        as step, count(*) from plan
union all select 'items they collapse into', count(*) from keeper
union all select 'rows folded away and deleted', count(*) from merges;

-- ---------------------------------------------------------------------------
-- 1. The purchases. Lossless, and first, so the history is never orphaned even
--    if something below fails and takes the whole transaction with it.
-- ---------------------------------------------------------------------------
update price_entries e
   set item_name = pl.new_name,
       item_key  = pl.new_key
  from plan pl
 where e.household_id = pl.household_id
   and e.item_key     = pl.old_key;

-- ---------------------------------------------------------------------------
-- 2. Give the keeper its name — unless it already had it.
-- ---------------------------------------------------------------------------
update pantry_items p
   set item_key     = k.new_key,
       name         = k.new_name,
       display_name = k.new_name
  from keeper k
 where p.id = k.keeper_id
   and not k.keeper_already_named;

-- ---------------------------------------------------------------------------
-- 3. Move the date, and NOTHING else.
--
--    See the note at the top on why the rhythm is not recomputed. The merged
--    purchases are already in the log under the new key — that is step 1 — and
--    the app blends the next one in the way it always does.
-- ---------------------------------------------------------------------------
update pantry_items p
   set last_purchased_at = (
         select max(e.recorded_at) from price_entries e
          where e.household_id = k.household_id and e.item_key = k.new_key
       )
  from keeper k
 where p.id = k.keeper_id
   and exists (select 1 from merges m where m.keeper_id = k.keeper_id);

delete from pantry_items p using merges m where p.id = m.pantry_id;

-- ---------------------------------------------------------------------------
-- What actually happened. Read this before you change ROLLBACK to COMMIT.
-- ---------------------------------------------------------------------------
select
  k.new_name                                    as item,
  case when k.keeper_already_named then 'kept your existing row' else 'renamed' end as survivor,
  string_agg(pl.old_key, ' + ' order by pl.old_key) as absorbed,
  count(*) filter (where pl.pantry_id <> k.keeper_id) as rows_deleted,
  (select count(*) from price_entries e
    where e.household_id = k.household_id and e.item_key = k.new_key) as purchases_now,
  (select round(p.avg_purchase_interval_days::numeric, 1) from pantry_items p
    where p.id = k.keeper_id)                   as every_n_days,
  (select p.last_purchased_at::date from pantry_items p
    where p.id = k.keeper_id)                   as last_bought
from keeper k
join plan pl on pl.household_id = k.household_id and pl.new_key = k.new_key
group by k.household_id, k.new_key, k.new_name, k.keeper_id, k.keeper_already_named
order by rows_deleted desc, item;

-- ===========================================================================
-- ROLLBACK by default. Change to COMMIT only after reading the table above.
-- ===========================================================================
rollback;
