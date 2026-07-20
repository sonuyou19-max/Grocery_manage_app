# Korb — Release Runbook

Everything needed to take Korb from this repo to the App Store and Google Play.
Work top to bottom; the backend section must be done before the first build.

## 1. Backend cutover (Supabase)

Apply these migrations to the **production** project (`vtgmvamwspqnrmdliqhh`), in
order, if not already applied:

- `0006_pantry_intel.sql` ✅ (applied)
- `0007_household_recaps.sql` ✅ (applied)
- `0008_tighten_membership_insert.sql` ✅ (applied) — RLS hardening (self-join fix)
- `0009_delete_account.sql` ✅ (applied) — account-deletion RPC
- `0010_ai_rate_limit.sql` ✅ (applied) — AI usage counter + `bump_ai_usage`

Deploy / redeploy the edge functions (they import `_shared/rate-limit.ts`).
If the `supabase` command isn't found, prefix with `npx`:

```
npx supabase functions deploy categorize      --project-ref vtgmvamwspqnrmdliqhh
npx supabase functions deploy quick-add-parse  --project-ref vtgmvamwspqnrmdliqhh
npx supabase functions deploy weekly-recap     --project-ref vtgmvamwspqnrmdliqhh
```

✅ Deployed and verified via curl (all three return JSON; `ai_usage` rows confirm
the rate limiter records calls).

Confirm secrets/config:
- `ANTHROPIC_API_KEY` set ✅
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` are auto-injected into functions.
- **Auth → SMTP**: see section 1a — required so passwordless sign-in codes deliver.
- **Plan**: move the project to **Pro** and set a billing **spend cap**.

## 1a. Email sending — Resend + Namecheap DNS + Supabase SMTP

Sign-in is passwordless email codes, so a real sender is mandatory. Domain:
**korb.app** (registered at Namecheap ✅). Sender: **no-reply@korb.app**.

**Step 1 — Resend:** create account → **Domains → Add Domain** → `korb.app`.
Resend shows the DNS records below.

**Step 2 — add the records in Namecheap** (Domain List → Manage `korb.app` →
**Advanced DNS**). Copy each **full** value from Resend (use its copy button —
never the truncated display). Host = prefix only (e.g. `send`, not `send.korb.app`):

| Record | Where in Namecheap | Type | Host | Value | Priority | Status |
|---|---|---|---|---|---|---|
| DKIM | Host Records | TXT | `resend._domainkey` | `p=MIGfMA0…` (from Resend) | — | ✅ green |
| SPF (sending) | Host Records | TXT | `send` | `v=spf1 …amazonses.com ~all` | — | ☐ |
| SPF (MX) | **Mail Settings → Custom MX** | MX | `send` | `feedback-smtp.…amazonses.com` | `10` | ☐ |
| DMARC (recommended) | Host Records | TXT | `_dmarc` | `v=DMARC1; p=none;` | — | ☐ |

> **MX gotcha:** Namecheap does NOT list MX in the Host Records dropdown. Scroll
> to the separate **MAIL SETTINGS** section, switch it to **Custom MX**, then add
> the MX row there. Switching to Custom MX disables Namecheap's built-in email
> forwarding — fine; use Cloudflare Email Routing for `support@` later.
>
> Skip Resend's **"Enable Receiving"** toggle — not needed (outbound only).

**Step 3 — verify:** wait ~15–30 min, then hit **Verify** in Resend until DKIM,
SPF, and DMARC all show green ✓.

**Step 4 — Supabase SMTP:** Dashboard → **Authentication → Emails → SMTP Settings**
→ enable custom SMTP:
- Host `smtp.resend.com`, Port `465`, Username `resend`, Password = Resend API key
- Sender email `no-reply@korb.app`, Sender name `Korb`

**Step 5 — test:** open the app's sign-in, enter your email, confirm the 6-digit
code lands in your inbox (not spam). ☐ done

## 2. Legal

- Fill every `[PLACEHOLDER]` in `/legal/privacy-policy.md`, `/legal/terms-of-service.md`,
  and the mirrored copy in `apps/mobile/src/lib/legal.ts`.
- Have them reviewed by a professional.
- Host both (any static URL) and set `PRIVACY_URL` / `TERMS_URL` in
  `apps/mobile/src/lib/legal.ts`. The App Store / Play listings require a
  hosted Privacy Policy URL.

## 3. Monitoring (optional but recommended)

Enable Sentry during this phase (steps in `apps/mobile/src/lib/monitoring.ts`):

```
npx expo install @sentry/react-native
# app.json → plugins: add "@sentry/react-native/expo"
# set EXPO_PUBLIC_SENTRY_DSN (eas secret or eas.json env)
# uncomment the init block in monitoring.ts
```

## 4. Accounts & tooling

- Apple Developer Program ($99/yr) and Google Play Console ($25 one-time).
- `npm i -g eas-cli && eas login`
- From `apps/mobile/`: `eas init` (writes `extra.eas.projectId` into app.json).
- Confirm the bundle id / package `app.korb.mobile` is the identity you want —
  **it can't be changed after first submission.** Change it in `app.json`
  (both `ios.bundleIdentifier` and `android.package`) before building if not.

## 5. Builds (profiles are in `eas.json`)

Internal test build (share via link / TestFlight internal / APK):

```
eas build --profile preview --platform all
```

Production build for the stores:

```
eas build --profile production --platform all
```

`production` uses `autoIncrement` with remote versioning, so build numbers are
managed for you. `app.json` is at marketing version **1.0.0**.

## 6. Submit

```
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

## 7. Store listings

- See `docs/STORE_LISTING.md` for name, subtitle, description, keywords, and
  the data-safety / privacy questionnaire answers.
- Screenshots must be captured from the running app per device size.
- After you have the public store URLs, set `APP_DOWNLOAD_URL` in
  `apps/mobile/src/app/list/[id].tsx` so the WhatsApp invite shares a download
  link alongside the join code.

## Pre-submit smoke test (on a real build, not Expo Go)

- Sign in with an email code; create a household; invite via WhatsApp.
- Add items (manual + AI quick-add), check items off, swipe-delete.
- Pantry search + Running low / In stock sections; Vibe Check.
- Insights: basket balance, weekly recap.
- Settings → Legal opens both docs; **Delete account** removes the account and
  returns you to logged-out.
