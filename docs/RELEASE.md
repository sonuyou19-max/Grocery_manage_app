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

| Record | Where in Namecheap | Type | Host | Value | Priority |
|---|---|---|---|---|---|
| DKIM | Host Records | TXT | `resend._domainkey` | `p=MIGfMA0…` (from Resend) | — |
| SPF (sending) | Host Records | TXT | `send` | `v=spf1 …amazonses.com ~all` | — |
| SPF (MX) | **Mail Settings → Custom MX** | MX | `send` | `feedback-smtp.…amazonses.com` | `10` |
| DMARC (recommended) | Host Records | TXT | `_dmarc` | `v=DMARC1; p=none;` | — |

> **This table used to carry a ✅ on every row and the line "Resend shows Domain
> verified — ready to send ✅". None of that was true.** `korb.app` was added to
> Resend on 20 Jul and has never verified: Resend polls for these records for 72
> hours, gave up, and left the domain Failed. Sign-in kept working anyway,
> because it was going out over a sender that does not depend on the domain —
> which is exactly why nobody noticed for two and a half weeks.
>
> The ✅ marks were written as intent and read later as fact, by a human and by
> Claude, both of whom then told the other the domain was fine. **Do not tick a
> box in this file until the thing is observably true** — Resend's Domains page
> green, or a 200 from the curl below. A checklist that lies is worse than no
> checklist.

Remaining email steps:
- ☐ Resend → verify `korb.app` (Domains page must show Verified, not Pending/Failed)
- ☐ Resend → create SMTP API key (`re_…`) with **Full access**, not scoped to a domain
- ☐ Supabase → Auth → SMTP Settings (host `smtp.resend.com`, port 465, user `resend`, pass = API key, sender `no-reply@korb.app`)
- ☐ Supabase → Auth → Email Templates → Magic Link → include `{{ .Token }}` (the 6-digit code)
- ☐ Supabase → Auth → Rate Limits → raise "Emails per hour"
- ☐ Test sign-in from the app (code lands in inbox → enter → signed in)

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

### Troubleshooting: sign-in says the code couldn't be sent

Read the server's own error first — the app only ever sees "sending failed":

```
Supabase Dashboard → Logs → Auth   (or: MCP get_logs, service "auth")
```

Errors seen so far, and what they actually mean:

**`550 "The associated domain with your API key is not verified. Please, create
a new API key with full access or with a verified domain."`**

That is Resend's wording, and it is about the **API key**, not the domain and
not the sender address. Resend keys can be scoped — *Full access*, *Sending
access → all domains*, or *Sending access → one specific domain* — and a key
scoped to a domain that is not verified 550s on every send no matter what
`korb.app`'s own status says. The usual cause is creating the key while the
DNS records were still propagating.

Fix: Resend → **API Keys** → create a new one with **Full access** → paste it
into Supabase → Auth → SMTP → Password. Confirm the sender in Supabase is on
the verified domain (`no-reply@korb.app`).

Isolate Resend from Supabase before touching Supabase at all — this answers
"is it the key or the SMTP config?" in one call:

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer re_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"no-reply@korb.app","to":"YOU@example.com","subject":"Korb SMTP test","text":"works"}'
```

A 200 with an id means the key is good and the problem is in Supabase's SMTP
settings. A 403/422 repeating the 550 text means the key is the problem.

**`403 "The korb.app domain is not verified"` from the curl.** Different failure
from the 550 above, and the difference is the whole diagnosis: the 550 is about
the API key's *scope*, this is about the *sender's* domain. Getting this one
means the key is fine and the domain is not.

**"It worked for days, then stopped."** Then it was never sending from
`@korb.app` — that domain has never verified. It was going out over one of the
two senders that need no domain:

- `onboarding@resend.dev`, Resend's shared sender, which only delivers to the
  email address that owns the Resend account
- Supabase's built-in mailer, with custom SMTP switched off, which only
  delivers to Supabase org members and allows a handful per hour

Both are fine for testing and neither can ship. So a sudden failure after a
working stretch is almost always the moment someone moved the config toward
production — pasting a domain-scoped key or changing the sender to
`no-reply@korb.app` — before the domain was actually verified.

**Resend → Emails** settles it in seconds: it logs every message actually sent,
with its `from`. If the working ones say `onboarding@resend.dev`, nothing
regressed and the config was changed. If they say `no-reply@korb.app`, the
domain really did verify once and later broke — check Namecheap's Mail Settings
is still on **Custom MX**, since switching off it silently drops the `send` MX
row. An empty log means you were on Supabase's built-in mailer all along.

**The email arrives but contains a link, not a 6-digit code.** The app's
sign-in screen asks for a code, so a link is unusable. Supabase's stock Magic
Link template ships `{{ .ConfirmationURL }}`; it needs `{{ .Token }}` — this
is the Step-4 checklist item above, and it is easy to miss because SMTP
working feels like being done.

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

## 3a. Korb Plus — billing (RevenueCat + Google Play)

The code is complete and inert. Nothing sells, and nothing is withheld, until
both halves below are done. Either half alone is safe: keys without the switch
means a paywall nobody is sent to; the switch without keys means a Plus card
with no button.

**Prices:** €2.99/month, €19.99/year (annual ≈ 44% off). Set the Polish price by
hand — Google's auto-conversion of €19.99 lands near 89 PLN, which is steep for
that market; 69.99 PLN reads better.

### a. Google Play Console

Create ONE subscription with two base plans:

| | Product / base plan | Price |
|---|---|---|
| Monthly | `korb_plus_monthly` | €2.99 |
| Annual | `korb_plus_annual` | €19.99 |

**Do NOT attach a free trial offer to either plan.** Korb already grants 30 days
server-side from `auth.users.created_at` (migration 0024). Configure both and
every new account gets sixty days. The server's version is the one to keep: it
works before any purchase exists, and it cannot be re-claimed by cancelling and
subscribing again.

### b. RevenueCat

1. Add the Android app, upload the Play service-account credentials.
2. Create entitlement **`plus`** and attach both products to it. The identifier
   must be exactly `plus` — `PLUS_ENTITLEMENT` in `src/lib/billing.ts`.
3. Create an offering with packages `$rc_monthly` and `$rc_annual` so
   `getOfferings().current.monthly / .annual` resolve.
4. Add the webhook:
   - URL: `https://<project>.supabase.co/functions/v1/billing-webhook`
   - Authorization header: the same value as `REVENUECAT_WEBHOOK_SECRET` below.

```
# the webhook — note --no-verify-jwt, see the file's header comment
supabase secrets set REVENUECAT_WEBHOOK_SECRET=$(openssl rand -hex 32)
supabase functions deploy billing-webhook --no-verify-jwt

# the app — public SDK key, safe in the bundle; it identifies, it does not authorise
eas secret:create --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_xxx
```

A new native build is required: `react-native-purchases` is a native module, so
OTA will not carry it.

### c. Turning the tier on

Everything above can ship while Plus is still invisible. One statement switches
it on for everyone:

```sql
create or replace function free_history_weeks() returns interval
  language sql immutable as $$ select interval '4 weeks' $$;
```

Revert with `interval '520 weeks'`. No app release either way — the gate, the
locked cards and the paywall entry points all follow `plus_gate_active`, which
is derived from this function (migration 0025).

**Before flipping it:** any tester whose account is older than 30 days drops to
the free tier the moment you do. Grant them access instead of surprising them:

```sql
insert into subscriptions (user_id, current_period_end)
values ('<their-uuid>', now() + interval '10 years')
on conflict (user_id) do update set current_period_end = excluded.current_period_end;
```

### d. Smoke test

- Play Console → licence testers, so purchases are free and renew fast.
- Buy annual → paywall closes, toast, Insights regains its cards.
- Check `subscriptions` has a row with a sane `current_period_end`.
- Cancel in Play → access continues to the period end (this is correct; see the
  `CANCELLATION` note in the webhook).
- Reinstall → **Restore a previous purchase** brings it back.

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
