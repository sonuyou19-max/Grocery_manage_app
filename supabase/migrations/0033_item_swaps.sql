-- ---------------------------------------------------------------------------
-- Lighter alternatives for the heavy things people buy — the cache behind the
-- Climate Mix page's "stepping stones".
--
-- The page asks, for one high-impact item the shopper actually buys, for three
-- alternatives arranged as a ladder: an easy like-for-like swap, a modern
-- plant-based stand-in, and a whole-food change. Only when the shopper TAPS the
-- item — advice nobody asked for is the thing lib/eco.ts already recorded
-- deleting once ("the lecture is the part people uninstall over"), so this is
-- pull, never push.
--
-- ---------------------------------------------------------------------------
-- Why a server-side cache and not a client one
-- ---------------------------------------------------------------------------
--
-- item_lexicon is synced to every device because the client needs it during
-- render, for every row, offline. This is the opposite shape: it is read only
-- when a finger lands on one row, and there are far more possible terms than
-- any device would ever expand. So the cache lives here and the client never
-- reads this table at all — it calls the function, which answers from this
-- table when it can and from the model when it cannot.
--
-- That is why there is no SELECT policy below. RLS is on and there are NO
-- policies, which under Postgres means no client of any role reaches these
-- rows; only the service-role key inside the function does, and it bypasses
-- RLS. The absence is the access control, exactly as it is for item_lexicon's
-- writes.
--
-- ---------------------------------------------------------------------------
-- Why locale is in the key
-- ---------------------------------------------------------------------------
--
-- These rows are food NAMES shown to the user, not codes. "Brown lentils" is
-- useless on a Polish phone, and this app ships seven languages. The model is
-- asked in the caller's language and the answer is cached per language, so a
-- Polish household warms the Polish row and pays nothing for the English one.
--
-- The term half of the key is the folded item name (see _shared/fold.ts), the
-- same normalisation item_lexicon uses, so "Beef", "beef " and "BEEF" are one
-- row rather than three.
-- ---------------------------------------------------------------------------

create table if not exists item_swaps (
  -- Folded term. Gated by isShareableTerm in the function before it ever gets
  -- here, which is what keeps somebody's shopping note out of a shared table.
  term text not null check (char_length(term) between 2 and 24),
  -- One of the app's seven. Constrained rather than free text so a typo cannot
  -- quietly create a parallel cache nobody ever reads from again.
  locale text not null check (locale in ('en', 'de', 'fr', 'it', 'es', 'nl', 'pl')),
  -- The three rungs, in order. Separate columns rather than jsonb: the shape is
  -- fixed at three and always will be — it is a designed ladder, not a list —
  -- and columns are what let the CHECKs below apply per rung.
  tier1 text not null check (char_length(tier1) between 2 and 40),
  tier2 text not null check (char_length(tier2) between 2 and 40),
  tier3 text not null check (char_length(tier3) between 2 and 40),
  created_at timestamptz not null default now(),
  primary key (term, locale)
);

alter table item_swaps enable row level security;

-- Deliberately no policies. See the header: the client never reads this table,
-- and RLS with no policies denies every non-service role.

-- No index beyond the primary key: every read is an exact (term, locale)
-- lookup, which the PK already serves.
