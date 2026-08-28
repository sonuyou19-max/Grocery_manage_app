-- A short storage tip per shared term. "Keep spinach unwashed in the fridge."
--
-- ---------------------------------------------------------------------------
-- Free text is a different risk class from an emoji
-- ---------------------------------------------------------------------------
--
-- Every other column this table publishes comes from a CLOSED SET: the emoji is
-- copied from an allowlist, unit/carbon/food_group are enums with CHECKs. A bad
-- generation can only ever produce a wrong value from a known vocabulary, and
-- the worst outcome is a carrot wearing the wrong icon.
--
-- A sentence has no vocabulary to check against. One bad generation reaches
-- every customer, and unlike an emoji nobody can glance at it and see that it
-- is wrong. So this column carries its own gates on top of the four the table
-- already applies to every term (see 0019):
--
--   LENGTH. 140 characters. Long enough for "unwashed, in the fridge, with a
--   dry paper towel"; too short to be a paragraph, a recipe, or a story.
--
--   NO LINKS. A published sentence that can carry a URL is a published sentence
--   that can carry somebody else's URL. Enforced here rather than trusted to
--   the function, because the database is the last thing between a generation
--   and every reader.
--
--   NO MARKUP. Angle brackets, braces and backticks have no business in a
--   sentence about a fridge, and their presence means something has gone wrong
--   upstream rather than that the tip is unusual.
--
-- What it must NOT contain is enforced in the function, not here, because it is
-- a judgement about meaning rather than about shape: no nutrition or health
-- claims. "High in iron" is a regulated claim under EU 1924/2006 with a legal
-- threshold behind it, and this table is not the place to make one. See
-- _shared/lexicon.ts.
--
-- Storage advice is not a health claim and is not regulated: it is the same
-- category of statement as the printing on the bag.

alter table item_lexicon
  add column if not exists storage_tip text;

alter table item_lexicon
  drop constraint if exists item_lexicon_storage_tip_shape;

alter table item_lexicon
  add constraint item_lexicon_storage_tip_shape check (
    storage_tip is null
    or (
      length(storage_tip) between 12 and 140
      and storage_tip !~* '(https?://|www\.)'
      and storage_tip !~ '[<>{}`]'
    )
  );

comment on column item_lexicon.storage_tip is
  'One short sentence on keeping the item well. English only for now; the '
  'client shows it as advice, never as a fact about the user''s own item.';
