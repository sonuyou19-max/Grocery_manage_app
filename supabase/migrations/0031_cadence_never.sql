-- ---------------------------------------------------------------------------
-- "Don't predict": a third answer to "how often you restock".
--
-- 0014 gave the user two answers: let Korb learn the interval, or pin one.
-- Some items have no honest third option — party candles, sun cream, the flour
-- you buy when you decide to bake — and for those, every prediction Korb makes
-- is noise. The item still belongs in the pantry (its purchase history and its
-- prices are worth keeping), it just should never come due.
--
-- Resting is NOT that setting, and the difference is why this exists. Resting
-- archives the row: it leaves the Pantry's active list entirely, which is the
-- right move for something you have stopped buying. This is for something you
-- do still buy, on no schedule at all.
--
-- Stored as cadence_days = -1 rather than a new boolean column, because the
-- client's precedence chain (cadence → learned → category default) already
-- guards on `cadence_days > 0`. A negative value falls through those guards
-- untouched, so nothing downstream had to learn a new shape; the client
-- short-circuits due-ness in one place instead. A boolean would have meant a
-- second nullable column that only ever makes sense in combination with this
-- one, and two columns that must agree is a state machine waiting to break.
--
-- The check constraint is what this migration is for: 0014 wrote it inline, so
-- -1 is rejected today and a member setting "don't predict" would see the write
-- fail. Widening it is the whole change.
-- ---------------------------------------------------------------------------

-- 0014 created the constraint inline, so its name is whatever Postgres
-- generated. Look it up by its definition rather than trusting that name: a
-- database restored through a tool that renames constraints would otherwise
-- silently keep the old rule, and the failure would only show up as a rejected
-- write on a user's phone.
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'pantry_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cadence_days%'
  loop
    execute format('alter table pantry_items drop constraint %I', c);
  end loop;
end $$;

-- Null still means "keep learning it". -1 is the only negative value with a
-- meaning; anything else negative is a bug, and the constraint says so.
alter table pantry_items
  add constraint pantry_items_cadence_days_check
  check (
    cadence_days is null
    or cadence_days = -1
    or (cadence_days >= 1 and cadence_days <= 365)
  );

-- No RLS change and no index change: this is one column's domain widening on
-- rows the existing "members manage pantry" policy already covers, and
-- cadence_days is not indexed.
