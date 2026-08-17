-- ---------------------------------------------------------------------------
-- Record what each swap row's item CANONICALLY is — and, for now, only record.
--
-- 0033 keyed item_swaps on the folded term, so "Beef" and "beef " are one row.
-- The function now also strips store-tier, provenance, salt and maturity words
-- (see _shared/canonical.ts), so "Sharp Cheddar", "Mature Cheddar" and "Organic
-- Cheddar" collapse onto "cheddar" too. That is the cheap, deterministic half of
-- the caching win and it needs no schema at all — a smaller term is still a term.
--
-- This column is the second, model-taught half: alongside its three rungs the
-- model returns ONE form-encoded key for the item asked about — beef_mince,
-- cheese_hard, butter, coffee — from a fixed vocabulary in the function. It
-- costs a handful of output tokens on a call already being made, so it adds no
-- new AI spend, and it lets genuinely different spellings of one product
-- ("cheddar", "gouda", "gruyere") be seen as the same thing.
--
-- ---------------------------------------------------------------------------
-- Why a column now, and NOT a read path
-- ---------------------------------------------------------------------------
--
-- The obvious next step — serve gouda's tap from cheddar's cached row because
-- both are cheese_hard — is deliberately NOT taken here. Collapsing distinct
-- foods onto one answer is exactly where this app's worst suggestions came from
-- (a steak got mince; a solid cheese got a sauce), and choosing which keys are
-- safe to merge without data is a guess. So the key is stored and nothing reads
-- it to redirect a lookup yet.
--
-- What it buys immediately is the evidence to make that call:
--
--   select canonical_key, count(*) as spellings, array_agg(term order by term)
--   from item_swaps
--   where canonical_key is not null
--   group by canonical_key
--   having count(*) > 1
--   order by spellings desc;
--
-- Every row there is a set of surface terms that ALREADY resolved to one key —
-- i.e. a collapse we could turn on, with the actual spellings in hand to judge
-- whether merging them would have served a worse answer. When that read looks
-- safe, a later migration adds the term -> key map and the function's miss path
-- consults it. Until then this is measurement, not behaviour.
-- ---------------------------------------------------------------------------

alter table item_swaps
  add column if not exists canonical_key text
    check (
      canonical_key is null
      -- A slug: lowercase words joined by single underscores, 2-30 chars. The
      -- shape is checked so a hallucinated key ("Beef Mince!!") cannot land and
      -- fragment the very grouping this column exists to enable.
      or (char_length(canonical_key) between 2 and 30
          and canonical_key ~ '^[a-z]+(_[a-z]+)*$')
    );

-- No index. The grouping query above is an occasional analyst read over a small
-- table, not a hot path; every serving read is still the exact primary-key
-- lookup 0034 defined. An index here would cost every write to speed up a query
-- nobody runs at request time.
