# Korb — Release Runbook

Everything needed to take Korb from this repo to the App Store and Google Play.
Work top to bottom; the backend section must be done before the first build.

## 1. Backend cutover (Supabase)

Apply these migrations to the **production** project (`vtgmvamwspqnrmdliqhh`), in
order, if not already applied:

- `0006_pantry_intel.sql` ✅ (applied)
- `0007_household_recaps.sql` ✅ (applied)
- `0008_tighten_membership_insert.sql` — RLS hardening (self-join fix)
- `0009_delete_account.sql` — account-deletion RPC
- `0010_ai_rate_limit.sql` — AI usage counter + `bump_ai_usage`

Deploy / redeploy the edge functions (they now import `_shared/rate-limit.ts`):

```
supabase functions deploy categorize      --project-ref vtgmvamwspqnrmdliqhh
supabase functions deploy quick-add-parse  --project-ref vtgmvamwspqnrmdliqhh
supabase functions deploy weekly-recap     --project-ref vtgmvamwspqnrmdliqhh
```

Confirm secrets/config:
- `ANTHROPIC_API_KEY` set ✅
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` are auto-injected into functions.
- **Auth → SMTP**: configure a real sending domain so email sign-in codes
  deliver (the app is now passwordless email-code).
- **Plan**: move the project to **Pro** and set a billing **spend cap**.

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
