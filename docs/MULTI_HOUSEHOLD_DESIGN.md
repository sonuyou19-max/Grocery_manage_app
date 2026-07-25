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
- `display_name` lives on the *membership*, not the user, so you can appear
  under different names in different households. Already true today.
- `invite_code` is readable only by members; joining goes through a
  `SECURITY DEFINER` RPC, so codes cannot be enumerated by outsiders.
- The recap edge function is fed a client-built aggregate of the active
  household's lists and stats, so it follows the switch with no change.

**Rule to hold to:** no query may span households. Anything that aggregates
(Insights, recap, Vibe Check deck) reads only the active household's providers.

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
