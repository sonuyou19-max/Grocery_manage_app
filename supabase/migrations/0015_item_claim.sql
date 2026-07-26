-- ---------------------------------------------------------------------------
-- Live household shopping: item claiming.
--
-- Two people shopping the same list at once buy the same thing. Check-offs are
-- already live, but "checked" means *bought* — there is no way to say "I'm
-- getting this, leave it" while you're still walking to the aisle. That gap is
-- the whole feature.
--
-- The claim lives on the shared item, not in a side channel. Presence and
-- ephemeral broadcast were both considered and rejected for this: a claim has to
-- survive the claimer backgrounding the app or losing signal in a shop, and
-- anything held only in a socket's memory evaporates exactly when a supermarket
-- basement kills the connection. ("Who's shopping right now" *is* ephemeral, and
-- that part does use Presence — no schema needed.)
--
-- Deliberately no unique constraint or "claims" table. A claim is a hint between
-- people who trust each other, not a lock: the failure it prevents is buying two
-- of something, and the cost of getting it wrong is a spare bottle of milk. A
-- lock would need conflict resolution, an unlock path for a stale claim, and a
-- decision about what happens when the claimer's phone dies mid-shop — all of it
-- machinery for a problem that a name on a row already solves.
-- ---------------------------------------------------------------------------

alter table list_items
  add column if not exists claimed_by uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;

-- "Which items on this list are claimed" is the only query, and it's answered
-- while rendering the list, so it rides along with the existing list_items
-- fetch. Partial index because claims are a small minority of rows.
create index if not exists idx_items_claimed
  on list_items (list_id)
  where claimed_by is not null;

-- No new RLS policy: "members manage list items" from 0001 already gates every
-- column of list_items behind is_household_member() on the parent list, so a
-- non-member can neither read nor set a claim. Note this deliberately lets ANY
-- member clear another member's claim — if someone's phone died holding a claim,
-- the rest of the household must be able to release it, and among people who
-- share a grocery list that is the right default over a policy that strands the
-- item until the original claimer returns.

-- list_items is already in supabase_realtime (0001), so claims propagate live
-- with nothing further to configure. That is the entire point: the claim has to
-- appear on the other person's phone within a second or two, or they've already
-- picked the item up.
