-- ---------------------------------------------------------------------------
-- The shared lexicon learns the food group too — an answer we were already
-- paying for and throwing away.
--
-- The categorize function has returned `group` in its JSON since it was
-- written; its own comment says the group rides along "in the same call, so
-- each is ~free". The client received that field, discarded it, and then
-- re-derived the group locally from the item's CATEGORY via a hand-written
-- English keyword table. So the model's answer was bought and binned, and the
-- guess that replaced it was worse in exactly the ways a keyword table is
-- worse.
--
-- How much worse was visible on the basket breakdown page: "Olio extravergine
-- d'oliva" and "green olives" were both filed under Carbs. The first because
-- the table is English-only, the second because it matched `olive` but not
-- `olives`. Neither is fixable by adding words — the app ships in seven
-- languages and users type their own — but both are already answered correctly
-- by the model on the call that classified the item in the first place.
--
-- ---------------------------------------------------------------------------
-- Why `food_group` and not `group`
-- ---------------------------------------------------------------------------
--
-- `group` is a reserved word in SQL. It can be quoted, but then it must be
-- quoted in every statement forever, and the first place someone forgets is a
-- migration that fails in production rather than in review. The column is
-- named for what it holds.
--
-- ---------------------------------------------------------------------------
-- Why nullable, and what null means
-- ---------------------------------------------------------------------------
--
-- Same as unit (0021) and carbon (0027): NULL is "not established", covering
-- both "asked before this column existed" and "asked, and the model gave a
-- value we do not recognise". The client treats an absent group as it always
-- has — falls through to its own curated keywords and then the category — so
-- a null costs nothing and a wrong value would cost a mislabelled chart.
--
-- 'nonfood' is in the allowed set on purpose. It is a real answer, and the one
-- the client needs to EXCLUDE an item from the mix entirely; collapsing it to
-- null would turn "washing-up liquid is not food" into "we don't know", and
-- the client would then count it as `other`.
--
-- ---------------------------------------------------------------------------
-- Gates
-- ---------------------------------------------------------------------------
--
-- Unchanged, and again they did not need changing. The group is written by the
-- same service-role path, on the same row, published under the same four gates
-- as the emoji, category, unit and carbon. There are still no client write
-- policies on this table; that absence is the control. The CHECK is the
-- backstop for a generation that slips past the function's own validation.
-- ---------------------------------------------------------------------------

alter table item_lexicon
  add column if not exists food_group text
  check (
    food_group is null
    or food_group in ('produce', 'protein', 'carbs', 'fats', 'other', 'nonfood')
  );

-- No index: read as a column of a row already being fetched by term or by the
-- published/updated_at delta, never filtered on. Same as unit and carbon.

-- No backfill. Existing rows keep food_group NULL, which reads as "not
-- established" rather than as a wrong answer, and the client falls through to
-- the behaviour it has today for those terms. Rows fill in as the model is
-- asked about each term again.
