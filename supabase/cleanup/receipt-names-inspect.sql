-- ---------------------------------------------------------------------------
-- WHAT WOULD BE RENAMED. Reads nothing but reads; changes nothing at all.
--
-- Receipt imports before the product/description split filed unmatched lines
-- under their full description, so pantries filled with rows like
--
--     Provital toast 50 pieces
--     1 litre Delhaize full fat milk
--     Pink Lady apple 6 pieces
--
-- A pantry entry carrying a brand and a pack size matches nothing next month,
-- when the same shopping arrives in a different size from a different shop.
--
-- Run this, read the output, EDIT the proposal, and paste what you approve into
-- receipt-names-apply.sql. The proposal below is a starting point produced by
-- stripping known brands and size phrases — it is not clever and it will get
-- some wrong. That is exactly why it is a separate, read-only step.
--
-- One thing the `effect` column below cannot tell you: it judges the proposal
-- as written HERE, and the whole point is that you will change it. Propose
-- "full fat milk", edit it to "milk", and this will still say "renamed in
-- place" while the edit actually merges into your existing milk. The apply
-- script's dry run is the authoritative answer — it reports the collapse for
-- the mapping you actually pasted, and it rolls back so you can read it first.
--
--     psql "$DATABASE_URL" -f supabase/cleanup/receipt-names-inspect.sql
--
-- or paste it into the Supabase dashboard's SQL editor.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

with

/*
 * The pantry rows that came from a receipt.
 *
 * Identified by having at least one purchase carrying a brand or a description
 * — both are written only by the importer. A hand-typed item has neither, and
 * must not be touched by any of this.
 */
imported as (
  select
    p.household_id,
    p.item_key,
    coalesce(p.display_name, p.name)              as current_name,
    max(e.brand)                                  as brand,
    max(e.description)                            as description,
    count(e.id)                                   as purchases,
    max(e.recorded_at)                            as last_bought
  from pantry_items p
  join price_entries e
    on e.household_id = p.household_id
   and e.item_key     = p.item_key
  where e.receipt_id is not null
     or e.brand       is not null
  group by p.household_id, p.item_key, coalesce(p.display_name, p.name)
),

/*
 * The proposal.
 *
 * Two passes, both deliberately conservative:
 *
 *   1. remove the brand, wherever in the name it appears. The brand is known
 *      from the purchase, so this one is reliable.
 *   2. remove a size phrase — "500 grams", "1 litre", "6 pieces". These names
 *      were generated in the reader's language, which is why the unit words are
 *      English; a name in another locale will simply not match and will come
 *      through unchanged, which is the safe direction.
 *
 * Whatever survives is squeezed of double spaces and trimmed. If that leaves
 * nothing, the proposal is null and the row is reported as needing a name by
 * hand rather than being quietly skipped.
 */
proposed as (
  select
    i.*,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            -- 1. the brand
            case
              when i.brand is null then i.current_name
              else regexp_replace(i.current_name, '(?i)\m' || regexp_replace(i.brand, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M', ' ', 'g')
            end,
            -- 2. a leading or trailing size phrase
            '(?i)\m\d+([.,]\d+)?\s*(g|gram|grams|kg|kilogram|kilograms|ml|millilitre|millilitres|cl|centilitre|centilitres|l|litre|litres|pc|pcs|piece|pieces|st|stuks)\M',
            ' ',
            'g'
          ),
          '\s+', ' ', 'g'
        )
      ),
      ''
    ) as proposal
  from imported i
)

select
  household_id,
  item_key                                          as current_key,
  current_name,
  brand,
  proposal                                          as proposed_name,
  -- The normalised key the proposal would land on, computed exactly as the
  -- app's normalizeKey does (migration 0018's generated column, same three
  -- steps in the same order).
  lower(btrim(regexp_replace(proposal, '[[:space:]]+', ' ', 'g'))) as proposed_key,
  /*
   * THE DESTRUCTIVE PART, named before it happens.
   *
   * When the proposed key already belongs to another pantry row, applying this
   * MERGES them. Two histories become one, and that cannot be undone. Every row
   * marked `merges into an existing item` is one to look at twice.
   */
  case
    when exists (
      select 1 from pantry_items q
      where q.household_id = proposed.household_id
        and q.item_key = lower(btrim(regexp_replace(proposal, '[[:space:]]+', ' ', 'g')))
        and q.item_key <> proposed.item_key
    ) then 'MERGES into an existing item'
    when proposal is null then 'NEEDS A NAME — nothing left after stripping'
    when lower(btrim(regexp_replace(proposal, '[[:space:]]+', ' ', 'g'))) = proposed.item_key
      then 'unchanged — nothing to do'
    else 'renamed in place'
  end                                               as effect,
  purchases,
  last_bought::date                                 as last_bought,
  description                                       as receipt_called_it
from proposed
order by effect, current_name;
