# Korb backend (Supabase)

Create the project in an **EU region (e.g. Frankfurt, `eu-central-1`)** for GDPR
data residency.

## Layout

- `migrations/` — SQL schema, applied in filename order. Source of truth for the
  data model; `packages/shared` mirrors it in TypeScript.
- `functions/quick-add-parse/` — edge function that turns free text/voice
  transcripts into structured list items via Claude.

## Setup

```sh
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                       # applies migrations/
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy quick-add-parse
```

Then copy the project URL + anon key into `apps/mobile/.env` (see `.env.example`).

## Design rules encoded in the schema

- **Household scoping**: every row belongs to a household; RLS policies allow
  access only to that household's members (`is_household_member`).
- **Optional pricing**: `list_items.price_cents` is nullable and
  `price_entries` rows exist only when a user chooses to log a price. Spend
  aggregations must always report coverage ("from the 82% of items you priced").
- **Predictions are derived data**: `pantry_items.avg_purchase_interval_days`
  and `predicted_out_at` are recomputed from `consumption_events` by a
  scheduled job — never written by the client.
