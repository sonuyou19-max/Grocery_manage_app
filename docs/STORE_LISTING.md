# Korb — Store Listing Copy

Draft copy for the App Store and Google Play. Character limits noted; trim to
your final wording. Replace **[SUPPORT EMAIL]** / **[WEBSITE]** / URLs.

## Names & identity

- **Home-screen name** (`app.json`): `Korb` (keep short under the icon)
- **Store title** (Apple name / Play title, ≤30): `Korb: Shared Grocery Lists` (26)
- **Apple subtitle** (≤30): `Family shopping & pantry` (24)
  - Alternatives: `Shopping & pantry, in sync` · `Plan the shop, never run out` · `Household lists & smart pantry`
- **Google short description** (≤80): `Shared grocery lists that sort themselves — and learn when you run low.`
- **Primary category:** Food & Drink
- **Secondary category:** Productivity
- **Age rating:** 4+ / Everyone (no objectionable content)

## Promotional text (Apple, ≤170, updatable without review)

`Plan the shop in seconds. Jot items in plain language, share one list with your household, and let Korb flag what you’re about to run out of.`

## Description (both stores)

```
Korb turns the paper grocery list into something that actually helps.

Type the way you talk — “we’re out of milk, 2 avocados, pasta” — and Korb
sorts every item by aisle and store for you. Share one list with your
household and it stays in sync on everyone’s phone, live: whoever grabs the
milk, everyone sees it.

The more you shop, the smarter it gets. Korb quietly learns how fast you get
through things and gives you a quick swipe to restock before you run out — no
more “I thought we had eggs.”

WHY YOU’LL LIKE IT
• Quick add in plain language — Korb categorises everything automatically
• Shared households — one list, everyone in sync, in real time
• Running low, handled — a 10-second swipe to top up your staples
• Insights — your basket balance, your staples, and a friendly weekly recap
• Beautiful, fast, and calm — built to get you in and out

PRIVATE BY DESIGN
Use it solo with no account, or sign in to sync and share. Your data lives in
the EU, we don’t sell it, and you can delete your account and everything in it
any time from Settings.

Free to use. Happy shopping.
```

## Keywords (Apple, ≤100 chars, comma-separated, no spaces)

`grocery,shopping list,groceries,pantry,household,shared list,meal,food,family,fridge,inventory,supermarket`

## What’s New (first release)

`First release of Korb — shared grocery lists that sort themselves, restock
reminders that learn your pace, and a weekly recap of how you shop.`

## Privacy / Data-safety answers

Use these to fill Apple’s privacy nutrition labels and Google’s Data safety form.
(Keep consistent with `/legal/privacy-policy.md`.)

**Data collected & linked to the user**
- Contact info: email address — App functionality (account/sign-in).
- User content: grocery lists, items, notes, pantry history — App functionality.
- Identifiers: user/account ID — App functionality.
- Diagnostics: crash logs & performance (only if Sentry is enabled) — App
  functionality / diagnostics.

**Not collected:** precise location, contacts, health, financial/payment info,
photos, advertising identifiers.

**Tracking:** No. Data is **not** used to track users across apps/sites and
**not** shared for advertising.

**Data sharing (processors, not sale):**
- Supabase — hosting/database/auth (EU region).
- Anthropic — AI features (item text / small aggregates sent to generate a
  response; not used to train their models).

**Encryption in transit:** Yes.
**Account deletion:** Yes — in-app (Settings → Delete account) and on request
at **[SUPPORT EMAIL]**.

## Support & marketing URLs

- Support URL: **[WEBSITE or support page]**
- Marketing URL (optional): **[WEBSITE]**
- Privacy Policy URL (required): host `/legal/privacy-policy.md` and paste here.

## Screenshots (capture from a real build)

Required sizes — iPhone 6.7" and 6.5" (and 5.5" if supported); Android phone.
Suggested shots:
1. Home — greeting + lists
2. A list with items sorted, store badges, one checked
3. AI quick-add in action
4. Pantry — Running low / In stock
5. Pantry Vibe Check card
6. Insights — weekly recap + basket balance

## After launch

Set `APP_DOWNLOAD_URL` in `apps/mobile/src/app/list/[id].tsx` to your store
link so the “add family member” WhatsApp invite includes a download link
alongside the join code.
```
