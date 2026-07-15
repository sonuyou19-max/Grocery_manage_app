# Korb 🧺

A shared grocery list and pantry tracker for European households — metric
units, euros, multi-store price memory, and an AI layer that learns how fast
your household actually runs out of things.

> "Korb" (German: basket) is a working title.

## What's in the MVP

- **Shared shopping lists** — live sync between household members, items
  auto-sorted into store-aisle order.
- **Pantry tracking** — learned consumption rates per item; "runs out in
  ~2 days" predictions from purchase intervals, not manual counting.
- **AI quick-add** — speak or type in plain language, any European language;
  Claude parses it into structured items for confirmation.
- **Optional budget control** — logging prices is never required. If a
  household logs them, Insights shows spend, price history per store, and
  saving tips; if not, it shows shopping habits instead.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Mobile app | Expo / React Native (TypeScript), expo-router | One codebase for iOS + Android, EAS handles store builds |
| Backend | Supabase (EU region) | Postgres + Auth + Realtime + RLS + Edge Functions; GDPR-friendly residency |
| AI | Claude via Edge Functions | Keys stay server-side; output validated with Zod before any DB write |

```
apps/mobile        Expo app (src/app = routes, src/theme = design tokens)
packages/shared    Shared TypeScript types + Zod schemas (AI contracts)
supabase           SQL migrations, RLS policies, edge functions
```

## Getting started

```sh
corepack enable            # makes pnpm available
pnpm install

# mobile app
cd apps/mobile
cp .env.example .env       # fill in Supabase URL + anon key
pnpm start                 # Expo dev server — scan QR with Expo Go

# backend: see supabase/README.md
```

## Design system

The visual identity (palette, type scale, components, all six core screens)
lives in the approved design concept; `apps/mobile/src/theme/tokens.ts` is its
1:1 code counterpart. Dark mode is a deliberate re-pick of every color, not an
inversion.

## Roadmap

1. ✅ Scaffold: monorepo, themed tab app, schema + RLS, AI parse function
2. Auth + household create/invite flows
3. List CRUD with realtime sync
4. Pantry + consumption events + prediction job
5. AI quick-add wired into the list screen (text first, then voice)
6. Insights (habit view; budget view where prices are logged)
7. Receipt scanning, store submissions (EAS), subscription groundwork
