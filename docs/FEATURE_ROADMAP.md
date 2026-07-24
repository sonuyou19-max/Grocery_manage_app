# Korb — Feature Roadmap (post-v1.0)

Phased plan for the seven features agreed after the first store-ready build.
This is the living tracker: check items off as they ship, and don't start a
wave until the previous one is verified on a real build.

## Guiding principles (the "everything stays connected" rule)

Korb's value is one connected loop, not a bag of features:

```
lists → check-offs teach the pantry → pantry predicts low items
      → predictions flow back into lists → prices/stores enrich items
      → household shares all of it → insights read the whole spine
```

Every feature below **reads from or writes to the existing stores** — it never
introduces a parallel, independently-tracked data store. Concretely:

- **Single source of truth per concept:** grocery data lives in `store/groceries`,
  learning in `store/pantry-intel`, sharing in `store/household`, store
  preferences in `lib/store-prefs`, category learning in `lib/categorize`.
  New behaviour extends these; it does not shadow them.
- **Local + cloud parity:** lists exist in two modes — on-device and cloud
  (household). Any new item field must be handled in **both** the local store
  *and* the Supabase schema, or the feature silently breaks for one kind of user.
- **Every schema change is a new migration** (next is `0011_`), never an edit to
  an existing one. Add RLS for anything household-shared.
- **The dead-end rule** (learned from the edit-mode bug): any UI mode that hides
  the primary action must keep an always-visible exit.
- **Definition of done per feature:** typecheck clean → Android bundle exports →
  verified on a real build (Appetize/emulator) → local *and* cloud paths both
  work → committed and pushed.

## Baseline

- **v1.0 candidate:** commit on `claude/grocery-tracker-mvp-d2a6ch` at the time
  the current APK is verified working. Once confirmed, tag it `v1.0-rc1` as the
  always-shippable fallback while these features are in flight.
- Features layer on top in waves; the branch should return to a
  typecheck-clean, bundle-clean state after **every** commit so a release is
  always possible.

## What already exists (so we extend, not rebuild)

| Area | Already in place | The actual gap |
|---|---|---|
| Pantry snooze/learning | `pantry-intel`: `markAlmostOut`, `markStillGood`, `snoozeUntil`, `useVibeDeck` (home-screen vibe card) | Those actions aren't surfaced on the **Pantry tab** rows |
| Insights | `insights.tsx`: basket balance, staples, spend total, spend-by-category, weekly recap | No **per-store** price intelligence; no **price history over time** (spend is computed from current lists only) |
| Categorisation memory | `lib/categorize`: on-device keyword + learned name→category cache | No learned **usual quantity / unit / store** per item |
| Store prefs | `lib/store-prefs`: ordered store options, `recordStoreUse` | — |
| Item schema | `Item`: name, category, quantity, unit, priceCents, store, checked | No `claimed_by`, no restock cadence, no purchase-price log |

---

## Status

- **Baseline:** `v1.0-rc1` = commit `5b01346` (verified on device; tag push is
  blocked by the sandbox proxy, so this hash is the fallback reference).
- **Wave 1 — ✅ complete** (test all three in one build): #3 per-item memory,
  #1 pantry swipe rows, #4a store price intelligence.
- **Wave 2 — ✅ complete:** #2 weekly-list builder, #6 shopping mode.
- **Wave 3 — next (backend):** #4b price history (purchase-log migration),
  #7a recurring-staple cadence, #5 live household shopping. Needs migrations
  `0011+` and RLS.

## TOP PRIORITY — Internationalization (i18n) for all of Europe

Goal: available in every European language, starting with the EU's 5 largest by
native speakers (**de, fr, it, es, pl**) + **nl** (home market); English is the
source/fallback. First launch asks **region → language**; both changeable later
in Settings.

- **Phase 1 — foundation ✅ (in progress → done this commit).** `i18n-js` engine
  (`src/i18n/`: `languages.ts`, `regions.ts` with locale-aware `formatMoney`,
  per-language locale files, `index.ts`). `LocaleProvider` (`store/locale.tsx`)
  persists `{region, language}`, gates first launch on a two-step region→language
  chooser (`components/locale-setup.tsx`, previews the picked language), exposes
  `useT()` / `money()`. Wired at root. First strings extracted as proof: tab bar
  + home greeting/subtitle.
- **Phase 2 — Settings + string extraction (next).** Add Region/Language rows to
  Settings (reuse LocaleSetup). Then extract remaining UI strings screen by
  screen into locale keys: lists, list detail, pantry, insights, vibe-check,
  settings, sign-in/household, item sheet, quick-add, weekly builder, shopping
  mode, empty states, alerts, category labels, relative-time phrases. Swap
  `euros()` for `money()`.
- **Phase 3 — translations + polish ✅ (except where noted).** All six locales
  are complete (275 keys + 8 plural groups each); no language relies on the
  English fallback. Polish gets a registered CLDR plural rule (one/few/many).
  `pnpm --filter mobile check:locales` guards key parity, per-language plural
  categories, and `%{placeholder}` integrity. The AI weekly recap is generated
  in the reader's language (migration 0011 adds `household_recaps.language`).
  Text-expansion pass done: sign-in actions wrap, the lists header hint
  shrinks, tab labels scale down. Store listings translated in
  `docs/STORE_LISTING_LOCALIZED.md`.
  - **Still open — native review.** Every locale is an AI draft. Worth a
    native read-through before launch, especially store titles/subtitles,
    which are hard to change later.
  - **Still open — legal translations.** Deliberately not machine-translated:
    they are binding texts and the English source itself still awaits
    professional review, so translating now means redoing all six once
    counsel edits the English. Both documents carry a "Language" clause
    making English authoritative, and `legalDoc()` in `lib/legal.ts` serves a
    per-language translation as soon as one is dropped into
    `LEGAL_TRANSLATIONS`, falling back to English until then.
- Notes: pure-JS so far (no rebuild); `expo-localization` optional later to
  pre-select the device language. Category *keywords* stay English but the AI
  categorizer already handles other languages, so items still classify.

## Deferred fixes (awaiting user go-ahead — do NOT start until asked)

- **Pantry "add to list" leaves a checked item / weekly builder under-suggests.**
  Root cause: checking an item off a list marks it `checked` but never removes
  it, and that's also how it enters the pantry — so a bought item lingers on
  the list as a checked row. The pantry swipe-add's duplicate guard
  (`already = target.items.some(name matches)`) then matches that stale checked
  row and skips adding, so the user sees the previously-bought (ticked) item
  instead of a fresh "to buy" one. The weekly builder's `excludeKeys` has the
  same blind spot (excludes names on a list even when checked).
  **Fix (approved, not yet implemented):** when the item already exists on the
  target list, branch on its state — unchecked → leave it; **checked → un-check
  it** (revive to "to buy"); absent → add fresh. Apply the same revive logic to
  the vibe-check deck's add-to-list, and make the weekly builder ignore checked
  items. User will give the heads-up to implement.
- **Align pantry/vibe-check left-swipe label** — make both say **"Add to list"**
  (vibe-check currently says "Almost out"). Approved, not yet implemented.
- **Unify add-to-list destination (Option A, AMENDED — per-item home list).**
  Single-item swipe-adds from the Pantry tab and the Vibe Check deck route to
  the item's remembered **home list** (the list it was added to). No chip.
  - Persist a per-item `name → homeListId` map on-device: `lib/item-home-list.ts`
    mirroring the item-memory/store-prefs pattern (AsyncStorage + in-memory +
    hydrate at startup). `rememberItemList(name, listId)` is called whenever an
    item is added to a list (both providers, all add paths); last-add wins.
  - On swipe-add: `homeListId = recallItemList(name)`.
    - Home list still live → add there silently (revive if it's on that list
      checked; no-op if already there unchecked; else add fresh), then a **soft
      auto-dismissing toast**: "‹item› added to ‹list›".
    - Home list missing/deleted, or none recorded, or id-space mismatch
      (local↔household) → open the ListPickerSheet (already has "New list…").
      The chosen/created list becomes the item's new homeListId, then add + toast.
  - Needs a lightweight Toast component (new — fade in/out, ~2s, queue-safe).
  - Scope: SINGLE-item adds only. The #2 weekly builder keeps its one-destination
    picker (a generated weekly shop belongs on one list, not scattered per item).
  - Home = the list it was LAST added to (confirmed by user): `rememberItemList`
    overwrites on every add, so re-homing is automatic.
  Not yet implemented.

## Phase overview

| Wave | Features | Native dep? | Backend? | Risk |
|---|---|---|---|---|
| **1 — JS-only, high value ✅** | #3 Per-item memory · #1 Pantry swipe rows · #4a Store price intelligence | No | No | Low |
| **2 — orchestration ✅** | #2 Build my weekly list · #6 Shopping Mode | No | No | Low–Med |
| **3 — infra/backend** | #4b Price history · #7a Recurring staples (in-app) · #5 Live household shopping | No new native (Supabase realtime) | Migrations + RLS | Med–High |
| **4 — push** | #7b Auto-restock reminders | Yes (`expo-notifications`) | Scheduling | High (needs dev build + permissions) |

Dependency notes: **#2 depends on #3** (uses learned usuals for prefill). #4b's
purchase-price log is also what makes #7 accurate — build the log once, share it.
Wave 1 & 2 add **no native modules**, so they don't complicate the build and stay
easy to verify. Native/push is deliberately last.

---

## Wave 1 — JS-only, ship fast

### #3 · Per-item "usual" memory  *(do first — #2 depends on it)*
- **Goal:** when you re-add an item, prefill its usual quantity, unit, and store.
- **Extends:** the exact on-device cache pattern in `lib/categorize` — add a
  parallel `lib/item-memory` (normalized name → {quantity, unit, store}),
  hydrated at startup like the category cache.
- **Writes:** update the memory whenever an item is saved with those fields
  (in the item sheet / `updateItem` path).
- **Reads:** `addItem` / the "Added to…" sheet seeds fields from memory.
- **Connection:** reinforces the same learning spine as categorisation; no new
  server data (stays a local learning cache, matching the categoriser precedent).
- **Files:** `lib/item-memory.ts` (new), `app/_layout.tsx` (hydrate),
  `components/item-sheet.tsx`, `app/list/[id].tsx` (`doAdd`).
- **Native/backend:** none. **Risk:** low.

### #1 · Pantry tab swipe rows (snooze / still-good)
- **Goal:** on the Pantry tab, swipe a row to **"Still good"** (snooze the
  prediction — the model learns to wait longer) and to **"Running low"** (adds it
  to a list). No hard delete.
- **Extends:** reuse `SwipeableItemRow` (from `app/list/[id].tsx`) and the
  **already-existing** `markStillGood` / `markAlmostOut` from `pantry-intel`.
- **Connection:** the Pantry tab and the home vibe card now drive the same
  learning actions — one behaviour, two surfaces.
- **Files:** `app/(tabs)/pantry.tsx`, possibly extract `SwipeableItemRow` into a
  shared `components/`.
- **Note:** "Running low → add to list" needs a target list picker (shared with #2).
- **Native/backend:** none. **Risk:** low.

### #4a · Insights: per-store price intelligence
- **Goal:** "You usually pay less for milk at Aldi" — cheapest-store hints and
  spend-per-store, from data already on items (`priceCents` + `store`).
- **Extends:** `insights.tsx` — add store/price aggregations alongside the
  existing spend-by-category.
- **Connection:** pure payoff on the price + store fields already captured; no
  new data model.
- **Files:** `app/(tabs)/insights.tsx`, maybe `lib/price-intel.ts` (new, pure).
- **Native/backend:** none. **Risk:** low.
- **Limitation:** only reflects items currently on lists until #4b adds history.

---

## Wave 2 — orchestration (no new deps)

### #2 · "Build my weekly list" (flagship)
- **Goal:** one tap generates a ready-to-shop list from predicted-low pantry
  items + usual staples, each pre-categorised with its usual quantity and store.
- **Orchestrates existing pieces:** `pantry-intel` stats/predictions +
  `lib/categorize` + `lib/store-prefs` + **#3 item-memory** + `groceries.addList`
  / `addItem`.
- **Connection:** the clearest expression of the whole spine — the pantry's
  learning becomes a finished list. No new data, just composition.
- **UX:** a preview/confirm sheet (tick which suggestions to include) before the
  list is created — reuse the quick-add review pattern.
- **Files:** `lib/weekly-list.ts` (new, pure selection logic), a builder sheet
  component, entry point on the Lists screen.
- **Native/backend:** none. **Risk:** low–med (logic + a new screen).

### #6 · Shopping Mode
- **Goal:** a focused in-store view of a list — big tap targets, category/aisle
  grouping (reuse the categoriser order), progress, keep-awake.
- **Extends:** a new presentation of an existing list; no data change.
- **Files:** `app/list/[id]/shop.tsx` (or a mode toggle on the list screen),
  `expo-keep-awake` (already an Expo-managed module, no custom native).
- **Native/backend:** none. **Risk:** low–med.

---

## Wave 3 — backend / realtime

### #4b · Insights: price history over time
- **Goal:** spend trends across weeks, not just current lists.
- **Needs:** a **purchase-price log** — persist price/store/date when an item is
  checked off (ties into the existing `logPurchase` moment in `pantry-intel`).
- **Schema:** new migration `0011_purchase_log` (household-scoped table + RLS),
  plus a local mirror for on-device lists.
- **Connection:** the same log powers #7's accuracy — build once, use twice.
- **Native/backend:** migration + RLS. **Risk:** med.

### #7a · Recurring staples (in-app surfacing)
- **Goal:** mark a pantry item "always keep" with a cadence; surface it as **due**
  in-app (vibe deck / a "due soon" section) when the interval elapses.
- **Schema:** add cadence fields to pantry stats — migration `0012_restock_cadence`
  (+ local parity in `pantry-intel`).
- **Connection:** burn-rate + cadence → the same list-building path as #2.
- **Native/backend:** migration. **Risk:** med. (In-app only; the *reminder* is #7b.)

### #5 · Live household shopping
- **Goal:** presence ("Sara is shopping now"), live check-offs (already realtime),
  and **item claiming** so two people don't buy the same thing.
- **Extends:** the household realtime channel already in `store/household`.
- **Schema:** `claimed_by` (+ optional `claimed_at`) on `list_items` — migration
  `0013_item_claim` + RLS so only household members can claim/unclaim; Supabase
  **Presence** for "who's shopping now" (no new native dep).
- **Connection:** deepens the household spine; claims live on the shared item, not
  a side channel.
- **Native/backend:** migration + RLS + realtime presence. **Risk:** med–high.
- **Note:** cloud-only by nature; must degrade gracefully for solo/local users.

---

## Wave 4 — push (native)

### #7b · Auto-restock reminders (push)
- **Goal:** notify you (and optionally the household) when a recurring staple is
  due, without opening the app.
- **Needs:** `expo-notifications` (native module → a fresh dev build + config
  plugin), notification permissions UX, and scheduling (local scheduled
  notifications for solo; a server/edge trigger for household-wide).
- **Connection:** the nudge targets the #7a cadence data and drops into the #2
  list-builder — no independent tracking.
- **Native/backend:** native module + permissions + scheduling. **Risk:** high.
- **Sequenced last** because it forces a native rebuild and store-permission
  review; keep it out of the earlier waves so they stay pure-JS and fast.

---

## Cross-cutting checklist (apply to every feature)

- [ ] Works for **both** local-only and cloud (household) lists.
- [ ] Any new item/pantry field added to the local store **and** a Supabase
      migration (`0011+`), with RLS if household-shared.
- [ ] No parallel data store — extends `groceries` / `pantry-intel` /
      `household` / `store-prefs` / `categorize`.
- [ ] Reuses existing interaction patterns (`SwipeableItemRow`, quick-add review
      sheet, the item sheet) rather than inventing new ones.
- [ ] The dead-end rule: no mode hides its own exit.
- [ ] typecheck + Android bundle + real-build verification before "done".
- [ ] Branch returns to a shippable state after each commit.

## Open decisions for later

1. Should per-item memory (#3) stay on-device (like the categoriser) or sync per
   household? Recommendation: on-device for now; revisit if households want
   shared "usuals."
2. "Build my weekly list" (#2): into a brand-new list each time, or append to a
   chosen existing one? Recommendation: offer both in the confirm sheet.
3. Household push (#7b): per-user reminders vs one household-wide nudge —
   affects whether scheduling is local or server-side.
