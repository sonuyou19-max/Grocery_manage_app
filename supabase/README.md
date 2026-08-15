# Korb backend (Supabase)

Create the project in an **EU region (e.g. Frankfurt, `eu-central-1`)** for GDPR
data residency.

## Layout

- `migrations/` — SQL schema, applied in filename order. Source of truth for the
  data model; `packages/shared` mirrors it in TypeScript.
- `functions/quick-add-parse/` — edge function that turns free text/voice
  transcripts into structured list items via Claude.

## Setup

Run the CLI through `npx` rather than installing it globally. A global install
is the one step here that fails differently on every machine — it is a Go
binary behind an npm shim, so `npm i -g supabase` is unsupported on some
platforms and simply absent from PATH on others (Git Bash on Windows in
particular, where it fails as `bash: supabase: command not found`). `npx` needs
nothing installed and pins the version in the command itself.

```sh
npx supabase@latest login
# Only if supabase/config.toml is missing — it is not committed. This writes
# the config and leaves migrations/ and functions/ untouched.
npx supabase@latest init
npx supabase@latest link --project-ref <your-project-ref>
npx supabase@latest db push                    # applies migrations/
npx supabase@latest secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase@latest functions deploy quick-add-parse
```

Then copy the project URL + anon key into `apps/mobile/.env` (see `.env.example`).

## Applying migrations to an existing project

Always look before pushing:

```sh
npx supabase@latest migration list   # Local vs Remote per version
```

`db push` runs only what the remote ledger is missing. Two states break a plain
push, and both are bookkeeping rather than schema problems:

**1. Schema is present but the Remote column is empty.** The tables exist (the
app works) yet nothing records how they got there — dashboard SQL editor runs and
`db reset` against a different history both do this. A push would try to
`create table households` on a database that already has it and fail. Tell the
ledger the truth first; this executes no SQL:

```sh
npx supabase@latest migration repair --status applied 0001 0002 0003   # …through the last one present
```

To find "the last one present", run `verify_schema.sql` (or
`diagnose_state.sql`, which reports how far up the series the remote reaches).

**2. Remote has versions with no local file.** `db push` hard-refuses with
*"Remote migration versions not found in local migrations directory"* and does
nothing at all. Drop those ledger rows — again no schema change, `reverted` only
deletes the row and never runs a down-migration:

```sh
npx supabase@latest migration repair --status reverted <version> <version>
```

Do **not** take the CLI's other suggestion of `db pull` here: it
generates a fresh local migration mirroring the remote schema, which collides
with the existing numbered history and leaves two competing sources of truth.

Afterwards run `verify_schema.sql` in the SQL editor — every row must say PASS.
Two of its rows assert *absence*: `price_entries` must stay out of the realtime
publication (publishing it would push a socket message to every member on every
check-off), while `list_items` must be in it or item claims never arrive.

## Design rules encoded in the schema

- **Household scoping**: every row belongs to a household; RLS policies allow
  access only to that household's members (`is_household_member`).
- **Optional pricing**: `list_items.price_cents` is nullable and
  `price_entries` rows exist only when a user chooses to log a price. Spend
  aggregations must always report coverage ("from the 82% of items you priced").
- **Predictions are derived data**: `pantry_items.avg_purchase_interval_days`
  and `predicted_out_at` are recomputed from `consumption_events` by a
  scheduled job — never written by the client.
