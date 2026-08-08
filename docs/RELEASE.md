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

> **Check the DNS Type before anything else — it is what the table above
> assumes.** Namecheap's Advanced DNS page only has a host record editor when
> the domain is on **Namecheap BasicDNS**. On **Namecheap Web Hosting DNS**,
> HOST RECORDS and MAIL SETTINGS are both replaced by "You can manage these in
> your cPanel account, or transfer DNS back to Namecheap BasicDNS" — there is
> nowhere on that screen to add a TXT or MX row at all.
>
> Namecheap keeps the BasicDNS zone whether or not BasicDNS is the active type,
> so records added there survive a switch and start resolving the moment you
> switch back. Switching is therefore usually the whole fix; you may not need to
> re-enter anything. Before switching, load `https://korb.app` — if something is
> being served from that cPanel, changing nameservers takes it down until an A
> record is re-added. Hosting the legal docs is not a reason to stay on Web
> Hosting DNS: GitHub Pages or Cloudflare Pages serves those fine.

**Known-good values**, resolved 8 Aug 2026 against `8.8.8.8` on BasicDNS. Diff
against these if delivery ever breaks — drift shows up immediately, and none of
it is secret (DKIM publishes a *public* key):

```
korb.app                    NS   dns1.registrar-servers.com, dns2.registrar-servers.com
resend._domainkey.korb.app  TXT  p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCB… ends IDAQAB, 218 chars
send.korb.app               TXT  v=spf1 include:amazonses.com ~all
send.korb.app               MX   10 feedback-smtp.eu-west-1.amazonses.com
_dmarc.korb.app             TXT  v=DMARC1; p=none;
```

Two things to check in those, because both are silent failures:

- **DKIM must end in `IDAQAB`.** That sequence terminates a well-formed RSA
  public key, so anything else means the paste was truncated — which Namecheap
  accepts without complaint. Base64-decode it and you should get 162 bytes.
- **The MX region must match the Resend region** (`eu-west-1` ↔ Ireland, shown
  on the Resend domain page). A mismatch delivers, but routes bounce handling
  through the wrong continent.

Confirm records resolve BEFORE restarting verification in Resend — restarting
against DNS that isn't there just fails again, instantly:

```
nslookup -type=TXT resend._domainkey.korb.app 8.8.8.8
nslookup -type=TXT send.korb.app 8.8.8.8
nslookup -type=MX  send.korb.app 8.8.8.8
```

Email steps:
- ✅ Resend → `korb.app` verified (proven: a send from `no-reply@korb.app` returns a message id)
- ✅ Resend → SMTP API key with **Full access**, not scoped to a domain
- ☐ Supabase → Auth → SMTP Settings (host `smtp.resend.com`, port 465, user `resend`, pass = API key, sender `no-reply@korb.app`)
- ☐ Supabase → Auth → Email Templates → Magic Link → include `{{ .Token }}` (the 6-digit code)
- ☐ Supabase → Auth → Rate Limits → raise "Emails per hour"
- ☐ Test sign-in from the app (code lands in inbox → enter → signed in)

The end-to-end check, independent of Supabase — a message id back means Resend
and DNS are both good and anything still broken is in Supabase's config:

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"no-reply@korb.app","to":"YOU@example.com","subject":"Korb","text":"works"}'
```

> **Never paste the key into a screenshot, a chat, or this file.** Put it in a
> shell variable as above. A leaked Resend key lets anyone send as `korb.app`,
> and the cost is the domain's sending reputation, which is far more expensive to
> recover than the key is to rotate. If one is ever exposed: Resend → API Keys →
> delete it, create a replacement, update Supabase's SMTP password.

> **Postmortem — why this took nineteen days.** The table above used to carry a
> ✅ on every row plus the line "Resend shows Domain verified — ready to send ✅".
> None of it was true. The domain was on Web Hosting DNS, so the records had
> never been served; Resend polled for 72 hours, gave up, and left it Failed.
>
> Sign-in kept working the whole time, because it was going out over a sender
> that does not depend on the domain (`onboarding@resend.dev`, or Supabase's
> built-in mailer). That is why a three-week outage of a domain nobody was
> sending from went unnoticed until the config moved toward production.
>
> Two lessons, both cheap:
>
> 1. **Do not tick a box here until the thing is observably true.** Those ✅
>    marks were written as intent and read back later as fact — by a human and
>    by Claude, each of whom then told the other the domain was fine. A
>    checklist that lies is worse than no checklist.
> 2. **Read the error's exact wording.** Resend said "**All** required records
>    are missing" — *all*, not one. No amount of mis-pasting or a forgotten MX
>    row produces that; it means the zone itself is not being served. Three
>    rounds went into API keys and key scopes before anyone took the word "all"
>    literally.

> **MX gotcha (BasicDNS only):** Namecheap does NOT list MX in the Host Records dropdown. Scroll
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
