# Design — Multiple households per user

Status: **accepted**, not implemented. Supersedes `PER_LIST_ACCESS_DESIGN.md`,
which is retained as a rejected alternative.

## The change

A user can belong to several households — "Home" shared with a partner, "Office"
shared with a colleague. A switcher on the dashboard picks the active one, and
**everything** scopes to it: lists, pantry, Vibe Check, Insights, weekly recap.
Households are fully isolated from each other.

## Why this over the alternatives

It is the only option considered that gets the pantry right in both directions:

- **Different places stay separate.** Home milk every 4 days, office milk every
  10. A single unified pantry would average those into a meaningless ~7-day
  interval and be wrong for both.
- **Several lists in one place still aggregate.** "Aldi run" and "Costco run"
  both feed the Home pantry, so milk keeps one honest burn-rate. Making each
  *list* a pantry would split it — the errand-vs-place trap.

The reason is that a household is the granularity that matches a physical
kitchen, which leaves lists free to be errands. Neither alternative managed both
halves.

It is also by far the cheapest, because the database was already built this way.

## What already works

Nothing here needs a schema change.

- `household_members` has `primary key (household_id, user_id)` — many
  memberships per user are already legal. No unique constraint on `user_id`
  exists anywhere.
- Every data table already carries `household_id`; RLS is already
  `is_household_member(household_id)`.
- `idx_members_user on household_members (user_id)` already exists — the index
  for "my households".
- `create_household` and `join_household` guard only `not_authenticated` /
  `invalid_code`. Neither rejects a user who already has a household, and both
  already `returns households`, so the client can switch straight to the new one
  (today it discards the return value).
- `delete_account` already loops over every household the user belongs to.
- Cloud caches are already keyed per household:
  `korb.lists.cloud.${householdId}`, `korb.pantryIntel.cloud.${householdId}`.

**The single-household limit is one client line:** `.limit(1).maybeSingle()` in
`store/household.tsx`.

## Privacy

Isolation falls out of the existing RLS rather than needing new rules.

- `household_members` is readable only through `is_household_member(household_id)`,
  so a member of Office cannot see that you also belong to Home — not the
  household, its name, or its members.
- `display_name` is mirrored onto each membership and is the only thing other
  members can read about you. They see the one name you chose and nothing else —
  no email, no user id beyond what they already share a household with, and no
  indication that you belong to any other household.
- `invite_code` is readable only by members; joining goes through a
  `SECURITY DEFINER` RPC, so codes cannot be enumerated by outsiders.
- The recap edge function is fed a client-built aggregate of the active
  household's lists and stats, so it follows the switch with no change.

**Rule to hold to:** no query may span households. Anything that aggregates
(Insights, recap, Vibe Check deck) reads only the active household's providers.

## One name, and it must not change when you switch

Today the dashboard greeting reads the *membership* name:

```ts
// app/(tabs)/index.tsx
const myName = members.find((m) => m.user_id === user?.id)?.display_name?.trim();
```

`display_name` lives on `household_members`, not on the user, so with two
households the greeting would change purely because you switched context.

**Decision: you have exactly one name, shown everywhere.** There is no
per-household alias. The ability to appear under different names in different
households was a side effect of where the column happens to sit, not a feature
anyone asked for — and two editable name fields in Settings is a worse product
than one.

**Storage.** The name still has to be written onto every `household_members` row,
because that column is the only thing *other* members can read — they cannot see
your user record. So the data is mirrored, but the mirror is invisible: the user
edits one field, and every membership carries the same value.

Deliberately **no** user-level copy in user metadata or a `profiles` table. A
second store would only be justified if the values could differ; now that they
cannot, it is just something to keep in sync and drift out of.

**Renaming** goes through one RPC so it stays atomic across households:

```sql
create or replace function set_display_name(p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update household_members
    set display_name = coalesce(nullif(trim(p_name), ''), display_name)
    where user_id = auth.uid();
$$;
```

**Reading it** for the greeting: take the active membership's `display_name`.
Because every membership holds the same value, this is stable across switches by
construction — no special-casing needed.

**Joining a household** uses the name you already have rather than asking again;
the field only appears the first time, when there is nothing to reuse. Existing
users need no migration — today nobody has more than one membership, so there is
nothing that can already be inconsistent.

**Settings** gets a single "Your name" row. Zero-household and logged-out users
keep today's behaviour: a greeting with no name.

## Work

### Client

1. **`store/household.tsx`** — drop `.limit(1)`, load all memberships. Expose
   `households[]`, `activeHouseholdId`, `setActiveHousehold`. Persist the active
   id (`korb.activeHousehold.v1`) and fall back to the first membership when the
   stored id is gone (left or deleted).
2. **Providers** — `GroceriesProvider` and `PantryIntelProvider` key on the
   active id. Both already use `key={household.id}`, so a switch remounts them
   with the correct per-household cache; no flash of another household's data.
3. **Dashboard** — household switcher in the header. Hidden entirely when the
   user has fewer than two, so solo users see no change.
4. **Settings** — a list of households instead of one: create, join by code,
   rename, and leave each individually.
5. **`auth/household.tsx`** — becomes "add a household" rather than one-time
   setup; use the RPC's returned row to switch to it immediately.
6. **Zero households** — unchanged: fall back to local lists, exactly as today.
7. **Name** — add the `set_display_name` RPC so a rename applies to every
   membership at once, a single "Your name" row in Settings, and drop the name
   field from the join flow once the user already has one. The greeting keeps
   reading the active membership, which is stable because all memberships hold
   the same value.

### On-device caches to scope

These are keyed by item name only and would bleed across households:

- **`lib/item-home-list.ts` — must fix.** `name → listId` is global, so "milk"
  homed to a Home list resolves to nothing in Office (safe — falls back to the
  picker), but picking an Office list then *overwrites* the Home mapping. The
  feature would thrash on every switch. Key it per household.
- **`lib/store-prefs.ts` — should fix.** Home and the office likely shop at
  different places, so store ordering belongs per household.
- **`lib/categorize.ts`, `lib/item-memory.ts` — leave global.** Milk is dairy
  everywhere, and usual quantity/unit is a property of the person. Both are
  device-local and single-user, so there is no cross-user leak either way.

### Backend

Nothing required. One addition worth making: a **cap on households per user**
(say 10) inside `create_household`, since creating them becomes a routine action
and is currently unbounded.

### i18n

New strings for the switcher and the multi-household Settings section, plus a
plural for "%{count} households". All six locales must stay at parity
(`pnpm --filter mobile check:locales`).

## Tradeoff to accept

You cannot share a *single list* without sharing the household around it. A
"Party" list for four friends means a "Party" household. Fine for home/office;
heavier than Bring for one-off list sharing.

This stays forward-compatible: per-list ACLs could be added *inside* a household
later if that need materialises, without undoing any of this.

## Sequencing

No data migration, so unlike the rejected per-list pivot this does **not** have
to land before launch, and it can ship after the current build is device-tested.

It does not block Wave 3 either — `#4b` and `#5` are already household-scoped, so
they inherit the correct behaviour for free.
