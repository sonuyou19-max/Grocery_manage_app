# Design — Per-list access + event-sourced pantry

> **Status: REJECTED.** Superseded by `MULTI_HOUSEHOLD_DESIGN.md`, which lets a
> user belong to several households and scopes everything to the active one.
> Kept for the reasoning, not as a plan.
>
> **Why it was rejected.** It solved sharing at per-list granularity, but to keep
> one pantry coherent across differently-permissioned lists it needed
> viewer-scoped folding and a snapshotted viewers table — machinery that exists
> only because the permission boundary and the kitchen boundary had been forced
> apart. Multiple households collapse them back together: a household *is* a
> kitchen, so the pantry is simply scoped to it, and lists stay free to be
> errands within it. That needs no new tables, no event log, and no migration.
>
> **What is still worth keeping from this document:**
> - The additivity argument (money sums, burn-rate does not) — it is why a
>   *per-list* pantry is wrong, and it is what ruled that option out.
> - The `SECURITY DEFINER` recursion note, if per-row ACLs are ever revisited.
> - The observation that `0001` shipped `consumption_events` and `price_entries`
>   which the client has never referenced. Wave 3's `#4b` should either use them
>   or drop them.
> - Invite codes over email lookup, to avoid account enumeration.

Original document follows.

---

Status: proposed. Supersedes the household-scoped sharing model. Read alongside
`FEATURE_ROADMAP.md`, whose Wave 3 migration numbers this document shifts.

## Why

Two problems with the model we have today.

**1. Sharing is all-or-nothing.** One household invite code grants access to
every list in the household. There is no way to share the flat's grocery list
without also exposing a private one. Our own Terms paper over it: *"Only invite
people you trust, and share invite codes carefully."*

**2. Joining a household silently hides your own lists.** `GroceriesProvider` is
a hard switch — `if (user && household)` renders the cloud provider, otherwise
the local one, with no migration between them. The moment a user joins a
household, every list they had built locally vanishes from the UI. The data is
still in AsyncStorage; it is simply never rendered again.

## The model

Three ideas, borrowed from Splitwise's expense model (their unit of record is an
expense carrying explicit per-user shares; balances are *derived* by folding the
expense log; groups are a lens over the result, and expenses need not belong to
one at all).

1. **A list is owned by a user and shared via an ACL.** Private on create.
2. **The pantry is not stored. It is derived** by folding an append-only event
   log — exactly the way Splitwise derives balances rather than storing them.
3. **Channels are a lens, never a partition.** A viewer's pantry is folded from
   *all* events they can see. Which events they can see is a permission
   question; how the numbers are computed is not.

### Why the fold must not be partitioned

This is the one place Splitwise's tolerances do **not** transfer, and it is the
constraint the whole design exists to protect.

A balance is `Σ (paid − owed)`. Split those expenses across groups and every
partial sum is still exactly right, because money is additive — which is why
Splitwise can be relaxed about grouping.

Burn-rate is not additive. `recordPurchase` learns from the gap between
*consecutive* purchases of an item:

```ts
gapDays = now - prev.lastPurchasedAt
intervalDays = sampleCount === 0 ? gapDays : intervalDays * 0.6 + gapDays * 0.4
```

It is a function of adjacent differences in an ordered sequence. Drop half the
events and the surviving gaps roughly double: milk truly bought every 4 days,
alternating between two lists, learns `intervalDays ≈ 8` in each. `dueAt` fires
at 90% of that — 7.2 days — so the nudge lands days *after* you ran out. A
per-list pantry does not give two correct partial answers; it gives two biased
wrong ones. Hence: one fold per viewer, over everything they can see.

## Schema

### `0012_per_list_access.sql`

```sql
create type list_role as enum ('owner', 'member');

-- Lists become user-owned. household_id is kept (nullable) for the migration
-- window and dropped in a later migration once no rows rely on it.
alter table shopping_lists
  add column owner_id uuid references auth.users(id) on delete cascade,
  alter column household_id drop not null;

create table list_members (
  list_id      uuid not null references shopping_lists(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         list_role not null default 'member',
  display_name text not null,
  added_at     timestamptz not null default now(),
  primary key (list_id, user_id)
);

-- The hot path: "which lists can I see?"
create index idx_list_members_user on list_members (user_id);
```

### `0013_pantry_events.sql`

One table for every kind of pantry signal, not just purchases — because
`markStillGood` and `markAlmostOut` are user decisions that also move the
numbers, and they must replay in order alongside purchases. (Migration `0001`
already anticipated this with `consumption_events (kind consumption_kind)`; that
table has **zero client references** and is superseded here.)

```sql
create type pantry_event_kind as enum ('purchased', 'still_good', 'almost_out');

create table pantry_events (
  id           uuid primary key default gen_random_uuid(),
  kind         pantry_event_kind not null,
  item_key     text not null,            -- normalizeKey(name)
  display_name text not null,
  category     item_category not null default 'other',
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references auth.users(id) on delete set null,

  -- Provenance. ON DELETE SET NULL is deliberate: deleting a list must not
  -- destroy the learning its purchases produced.
  list_id      uuid references shopping_lists(id) on delete set null,

  -- Optional price signal, replacing price_entries (also unused today).
  price_cents  integer check (price_cents >= 0),
  currency     char(3) not null default 'EUR',
  store        text
);

-- Replay is ordered per item; this index serves the incremental fetch below.
create index idx_pantry_events_key_time on pantry_events (item_key, occurred_at);

-- Visibility snapshotted at write time (Splitwise's per-expense shares). Keeps
-- history immutable: changing a list's membership never retroactively rewrites
-- who could see last month's purchases.
create table pantry_event_viewers (
  event_id uuid not null references pantry_events(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);

create index idx_pev_user_event on pantry_event_viewers (user_id, event_id);
```

Write path: insert the event, then one viewer row per current member of
`list_id` (or just the actor when `list_id is null` — the pantry's own "track
item" action). Do it in one `SECURITY DEFINER` RPC so it is atomic.

## RLS

```sql
-- SECURITY DEFINER is not optional here: a policy on list_members that calls a
-- helper which itself selects list_members recurses infinitely. Running the
-- helper as definer bypasses RLS inside the function and breaks the cycle.
-- The pinned search_path prevents a shadowed-table attack.
create or replace function can_access_list(lid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from list_members
    where list_id = lid and user_id = auth.uid()
  );
$$;

create policy "members access lists"
  on shopping_lists for all
  using (can_access_list(id))
  with check (can_access_list(id) or owner_id = auth.uid());

create policy "members access list items"
  on list_items for all
  using (can_access_list(list_id))
  with check (can_access_list(list_id));

-- Read your own memberships plus those of lists you're in (so the UI can show
-- who else is on a list). Written against the definer helper, not a subquery on
-- this same table.
create policy "read memberships of my lists"
  on list_members for select
  using (user_id = auth.uid() or can_access_list(list_id));

-- Only a list's owner changes its membership.
create policy "owner manages membership"
  on list_members for all
  using (exists (
    select 1 from list_members m
    where m.list_id = list_members.list_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  ));

-- Events are readable exactly to their snapshotted viewers.
create policy "viewers read events"
  on pantry_events for select
  using (exists (
    select 1 from pantry_event_viewers v
    where v.event_id = pantry_events.id and v.user_id = auth.uid()
  ));
```

Events are insert-only through the RPC; no direct client insert policy.

## Invites

Per-list invite codes, **not** email lookup. Resolving a user by email is
account enumeration — an unauthenticated caller could probe which addresses have
accounts. Splitwise does offer email invites, but they have the abuse tooling to
back it; we don't.

```sql
create table list_invites (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references shopping_lists(id) on delete cascade,
  code       text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses   integer not null default 1,
  uses       integer not null default 0,
  created_at timestamptz not null default now()
);
```

`join_list(p_code, p_display_name)` as `SECURITY DEFINER`: validate code,
expiry and `uses < max_uses`, insert the membership, increment `uses`. No select
policy on the table at all — a code is only ever redeemed through the RPC, so it
cannot be enumerated. Reuse the existing `ai_usage` rate-limit pattern to cap
redemption attempts per user.

Codes are scoped to one list, expire, and are single-use by default — three
things the current household code is not.

## Derived stats: incremental replay

**The learning math needs no changes.** `recordPurchase`, `applyStillGood` and
`applyAlmostOut` all already take `now` as an injectable parameter defaulting to
`Date.now()`. Pass each event's `occurred_at` instead and they are deterministic
reducers — the existing pure library *is* the fold:

```ts
const stats = events.reduce((acc, e) => {
  switch (e.kind) {
    case 'purchased':  return recordPurchase(acc, e.display_name, e.category, e.occurredAt);
    case 'still_good': return applyStillGood(acc, e.itemKey, e.occurredAt);
    case 'almost_out': return applyAlmostOut(acc, e.itemKey, e.occurredAt);
  }
}, seed);
```

Do **not** compute this in SQL. The EMA is order-dependent and awkward to
express as an aggregate, and duplicating it server-side would mean two
implementations of the one piece of math the product depends on.

**Snapshot + watermark.** Persist the folded `StatMap` plus the `occurred_at` of
the newest event folded into it. On load, read the snapshot, fetch only
`occurred_at > watermark`, fold those in, persist. Full replay only on first run
or cache loss.

Volume is not a concern: a heavy user ticking 30 items a week generates ~1,500
events a year, so even a full replay is trivial. That is why there is no
server-side aggregation here at all.

**This collapses the local/cloud pantry split.** Today `store/pantry-intel.tsx`
has two backends that must be kept in behavioural sync. With an event log both
become the same fold over a different event source — AsyncStorage when logged
out, `pantry_events` when signed in. One code path, one set of semantics.

`pantry_items` leaves the read path entirely. Keep it briefly as a server-side
convenience for the recap edge function if useful, or drop it in a follow-up.

## What this fixes beyond the two stated problems

- **Deleting a list no longer destroys learning.** `list_id ON DELETE SET NULL`
  keeps the events; only their provenance goes.
- **Local lists stop disappearing on sign-in.** There is no provider switch any
  more: a signed-in user always has cloud lists. First sign-in uploads local
  lists (as owned lists) and local events, so nothing is orphaned.
- **The pantry stops being lossy about who bought what.** `actor_id` on every
  event makes "Sara bought the milk" available for free — the groundwork for
  Wave 3's `#5` live household shopping.
- **Price history arrives for free.** `price_cents`/`store` on the event log is
  exactly what Wave 3's `#4b` needed a separate purchase log for.

## Open decisions

**1. Divergent views between people who share a kitchen.** If U1 buys milk on
both a shared list and a private one, U1 folds both and sees "fine, bought 2 days
ago"; U2 folds only the shared events and may see "running low". Both are correct
given what each can see, and hiding purchases from someone who cannot see them is
the privacy-preserving answer — but it is also precisely the class of confusion
that made Splitwise publish *"My dashboard balances are different than my group
balances!"*

Recommended default: accept it, and add a quiet affordance on any item whose
history spans lists the viewer cannot fully see ("based on the lists you can
see"). The alternative — an explicit shared-kitchen entity — reintroduces the
second concept this pivot is trying to remove.

**2. No explicit "kitchen" for now.** Deliberate. Because truth is an event log
with provenance, *any* grouping is a lens that can be added later without a
schema change — including an opt-in shared kitchen if family testing shows the
divergence above actually bites. Do not build it pre-emptively.

**3. Roles stay `owner` / `member`.** No viewer/editor split: for a grocery list,
anyone who can see it should be able to tick things off. A permission matrix is
cost with no current use.

**4. Does leaving a list revoke past visibility?** Under the snapshot model, no —
old events keep the viewers they were written with. That is Splitwise's behaviour
and it keeps history stable. Flag it in the Privacy Policy.

## Migration path

1. Ship `0012`/`0013` with `household_id` still nullable and populated.
2. Backfill: for every existing `shopping_lists` row, set `owner_id` to the
   household's owner and insert a `list_members` row per household member —
   preserving today's effective access exactly, so nothing breaks on upgrade.
3. Backfill `pantry_events` from `pantry_items`: one synthetic `purchased` event
   per row at `last_purchased_at`, with viewers = household members. Learned
   intervals do not survive (a single event yields no gap), so users re-learn.
   Acceptable pre-launch; **not** acceptable post-launch, which is the main
   argument for doing this now.
4. Client refactor (below), released together.
5. A later migration drops `household_id`, `consumption_events`, `price_entries`
   and the household tables once nothing references them.

## Client refactor scope

- `store/groceries.tsx` — remove the local/cloud provider switch; cloud whenever
  signed in. `addOrReviveItem` and the home-list logic just added are unaffected.
- `store/pantry-intel.tsx` — replace both backends with one event-fold plus
  snapshot cache.
- `store/household.tsx` — becomes `store/list-sharing.tsx`: per-list members,
  invite creation, join by code.
- `app/(tabs)/settings.tsx` — the Household section becomes per-list sharing,
  reachable from a list rather than from Settings.
- `app/auth/household.tsx` — replaced by a per-list share/join sheet.
- Realtime — channels move from `lists-${householdId}` to a per-user
  subscription filtered by accessible lists.
- `delete_account` RPC — today it transfers household ownership. It must instead
  transfer or delete per-list ownership: for each list the user owns, promote
  another member, or delete the list if they were the only one.
- i18n — one new namespace for sharing; retire the `householdError` keys. All
  six locales must stay at parity (`pnpm --filter mobile check:locales`).

## Sequencing and risk

Do this **before launch** and **before Wave 3**. Before launch because step 3
resets learned intervals, which is fine with one test user and unacceptable with
real ones. Before Wave 3 because `#4b` (price history) and `#5` (live shopping,
`claimed_by` + presence) both need to know their scope, and building them on
households means redoing them.

Wave 3's migrations renumber to `0014_restock_cadence` and `0015_item_claim`;
`#4b`'s purchase log is absorbed into `0013`.

Biggest risks, in order:

1. **RLS recursion on `list_members`.** The single most common way per-row ACLs
   break on Supabase. The `SECURITY DEFINER` helper above is the fix; verify with
   a policy test before building UI on top.
2. **Per-row ACL performance.** Every list and item read now joins membership.
   `idx_list_members_user` is essential; check the query plan on a seeded
   dataset rather than assuming.
3. **Scope.** This is larger than all of Wave 3 combined. It touches auth,
   sharing, the pantry engine, realtime, account deletion and i18n. It should be
   its own wave with its own verified build, not folded into other work.
