-- ---------------------------------------------------------------------------
-- The shared item lexicon: one term, one emoji, one category — learned once by
-- the AI and reused by everybody.
--
-- Today every unknown item costs one Haiku call per *device*. Ten thousand
-- people typing "sriracha" is ten thousand identical calls arriving at the same
-- answer, and each of them waits for it. A term is a fact about groceries, not
-- about a household, so the answer belongs in one place that everyone reads.
--
-- ---------------------------------------------------------------------------
-- The thing this table has to get right
-- ---------------------------------------------------------------------------
--
-- It is READ BY EVERY CUSTOMER. That makes it the one table in this schema
-- where a careless write is a privacy incident: shopping lists carry medication
-- brands, gift notes, and the occasional "call dr rutten". Publishing those into
-- a dictionary every other customer can read would be indefensible, and no
-- amount of "we only meant to store food" in the client fixes it.
--
-- So publication is gated four ways, and a term must clear ALL of them:
--
--   1. NOTHING CLIENT-WRITABLE. There are no INSERT/UPDATE/DELETE policies on
--      this table. Not restrictive ones — none at all, which under RLS means
--      every write from anon and authenticated is refused. The only writer is
--      the categorize edge function via the service role, after it has checked
--      the other three gates. A user cannot poison the shared dictionary even
--      by crafting requests directly against PostgREST.
--
--   2. A CLOSED EMOJI SET. The model picks from a fixed allowlist
--      (functions/_shared/emoji-allowlist.ts) and anything outside it is
--      dropped. A shared table amplifies one bad generation to every customer,
--      so the model is never trusted to invent the value.
--
--   3. THE MODEL CERTIFIES THE TERM IS GENERIC. It answers, separately, whether
--      this is a common grocery product any shopper might write — as opposed to
--      a brand-specific, personal, or one-off string. Only generic terms are
--      eligible, and a shape filter in the function rejects anything with
--      digits, punctuation or more than three words before the model is even
--      asked to judge it.
--
--   4. K-ANONYMITY. A term is published only once `publish_threshold` DISTINCT
--      callers have independently asked about it. One person's private string
--      is not a grocery term; a word three unrelated households all typed is.
--      Sightings are counted in a child table keyed by a SALTED HASH of the
--      caller, so the count is real without storing anything identifying.
--
-- Below the threshold a row still exists (it has to, to be counted) but
-- `published` is false and the SELECT policy hides it. Nobody is worse off in
-- the meantime: the AI answer is returned directly to the caller who triggered
-- it. The shared table is purely an optimisation for whoever comes next.
--
-- ---------------------------------------------------------------------------
-- Why the term column is a folded key
-- ---------------------------------------------------------------------------
--
-- `term` is the client's fold(): lowercase, ligatures mapped, accents stripped,
-- whitespace collapsed. "Käse", "KÄSE" and " kase " are one row. The client
-- computes the same key locally before looking a term up, so the two sides
-- agree without the client sending anything but the already-folded string.
-- ---------------------------------------------------------------------------

create table if not exists item_lexicon (
  -- Folded term. See lib/item-emoji.ts fold() — the client and this table must
  -- agree on normalization or every lookup misses.
  term text primary key check (char_length(term) between 2 and 24),
  emoji text not null,
  -- Shared for free: the same call already resolves it, and a correct category
  -- is worth more than the emoji (it drives the pantry, insights and the
  -- weekly builder). Nullable because a term can be emoji-only if the model
  -- returns a category we don't recognise.
  category item_category,
  -- How many distinct callers have asked. Denormalized from the child table so
  -- the common read never needs a join.
  sightings integer not null default 0,
  -- False until every gate is cleared. The SELECT policy keys off this.
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Distinct-caller ledger for gate 4.
--
-- `caller_hash` is HMAC(salt, caller) computed in the edge function and never
-- reversible to an IP or a user id — the salt lives only in the function's
-- environment. The composite primary key is what makes the count DISTINCT:
-- the same caller asking a hundred times inserts one row and advances the
-- term no further towards publication.
create table if not exists item_lexicon_sightings (
  term text not null references item_lexicon(term) on delete cascade,
  caller_hash text not null,
  first_seen timestamptz not null default now(),
  primary key (term, caller_hash)
);

alter table item_lexicon enable row level security;
alter table item_lexicon_sightings enable row level security;

-- Read: published rows only, and to everyone — the app works logged out, so the
-- lexicon has to reach anon too. A published row is by construction a generic
-- grocery word that three unrelated people typed, which is a dictionary entry,
-- not anyone's data.
create policy "anyone reads published lexicon terms"
  on item_lexicon for select
  to anon, authenticated
  using (published);

-- Write: deliberately no policy. With RLS enabled and no permissive policy for
-- a command, that command is denied for every role except those that bypass RLS
-- (service_role, and the table owner). This absence IS the security control —
-- do not "fix" it by adding an INSERT policy for authenticated.

-- The sightings ledger has no policy for ANY command, so it is entirely
-- invisible outside the service role. It holds the pre-publication terms, which
-- are exactly the ones that have not yet earned the right to be seen.

-- Terms are pulled by the client as a delta ("everything published since I last
-- synced"), so this is the index that read runs on.
create index if not exists idx_lexicon_published_updated
  on item_lexicon (updated_at)
  where published;

-- Keep updated_at honest: the delta sync is only correct if every change moves
-- it forward, and relying on the writer to remember is how a sync quietly stops
-- delivering new rows.
create or replace function touch_item_lexicon()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_item_lexicon_touch on item_lexicon;
create trigger trg_item_lexicon_touch
  before update on item_lexicon
  for each row execute function touch_item_lexicon();

-- Deliberately NOT published to supabase_realtime. A new dictionary word does
-- not need to reach a phone within seconds, and putting a table every customer
-- reads on the realtime firehose would be a lot of sockets for no benefit. The
-- client pulls a delta when it opens.
