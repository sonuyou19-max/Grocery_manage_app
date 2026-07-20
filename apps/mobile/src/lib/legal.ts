/**
 * Legal copy shown in-app (Settings → Legal) so the Privacy Policy and Terms
 * are always reachable — a requirement for App Store / Play review.
 *
 * The canonical, hostable versions live in `/legal/*.md` at the repo root; these
 * strings are the user-facing mirror (without the operator notes). Keep them in
 * sync, and replace the [PLACEHOLDER] fields before launch.
 *
 * Once the documents are hosted on a website, set PRIVACY_URL / TERMS_URL and
 * the Settings rows will open those instead of the bundled screen. The store
 * listing's "Privacy Policy URL" field needs a hosted URL regardless.
 */

export const LEGAL_LAST_UPDATED = '20 July 2026';

/** Hosted URLs — leave empty to use the bundled in-app screens. */
export const PRIVACY_URL = '';
export const TERMS_URL = '';

export const PRIVACY_MD = `# Privacy Policy

Last updated: ${LEGAL_LAST_UPDATED}

This Privacy Policy explains how **[COMPANY / OPERATOR NAME]** ("we", "us") handles your personal data when you use the Korb app. We are the data controller. For any privacy question, contact us at **[CONTACT EMAIL]**.

## Who this applies to

Korb is intended for users aged 16 and over. It is not directed at children, and we do not knowingly collect data from anyone under 16.

## The data we process

You can use Korb without an account. In that mode your lists are stored only on your device and we do not receive them.

When you sign in to sync and share, we process:

- **Account data** — your email address (for sign-in via a one-time code) and a display name you choose.
- **Household data** — the household name and invite code, and which accounts are members.
- **Grocery & pantry data** — the lists and items you create, which items you check off, and the pantry statistics used to predict restocks.
- **Technical data** — a session token and basic device information, and, if enabled, anonymised crash diagnostics.

We do not collect your contacts, precise location, advertising identifiers, or payment card details, and we do not sell your data or use it for advertising.

## How we use your data

- To provide the service — store and sync your lists and manage households.
- To provide AI features — categorising items, understanding quick-add text, and writing your weekly recap.
- To keep the service secure and working — abuse prevention and crash diagnostics.

## Who we share it with

- **Supabase** — hosting, database, and authentication, stored in the EU (Frankfurt).
- **Anthropic** — powers the AI features. When you use AI quick-add, automatic categorisation, or the weekly recap, the relevant text is sent to Anthropic to generate a response. It is not used to train their models, and may be processed outside the EU under appropriate safeguards.
- **[CRASH REPORTING PROVIDER]** — if enabled, receives anonymised crash reports.

We may also disclose data if required by law.

## How long we keep it

We keep your data for as long as your account exists. When you delete your account in Settings, we remove your account and the data tied to it; if you are the last member of a household, that household and its lists and pantry history are deleted too.

## Your rights

If you are in the EU/EEA or UK, you have the right to access, correct, delete, export, restrict, or object to the processing of your data, and to withdraw consent. You can delete everything yourself in Settings → Delete account, or email **[CONTACT EMAIL]** to exercise any other right. You may also complain to your local data protection authority.

## Security

Data is encrypted in transit, and access to household data is enforced at the database level so only members can read or change it.

## Changes

We may update this policy; material changes will be reflected by the "Last updated" date above.

## Contact

**[COMPANY / OPERATOR NAME]** — **[CONTACT EMAIL]**`;

export const TERMS_MD = `# Terms of Service

Last updated: ${LEGAL_LAST_UPDATED}

These Terms govern your use of the Korb app provided by **[COMPANY / OPERATOR NAME]** ("we", "us"). By using Korb you agree to these Terms.

## Eligibility

You must be at least 16 years old to use Korb.

## Your account

You can use Korb without an account. If you create one, you're responsible for keeping access to your email secure, since sign-in uses a one-time code sent to it.

## Households and shared content

Anything you add to a shared household can be seen and changed by other members. Only invite people you trust, and share invite codes carefully.

## Acceptable use

Please don't use Korb for anything unlawful, attempt to break or gain unauthorised access to the app or its backend, or abuse the AI or other features with automated or excessive requests. We may suspend access that violates these Terms.

## AI features

Korb uses AI to categorise items, understand quick-add text, and write your weekly recap. These are helpful suggestions, not guarantees — they can be incomplete or wrong. Always use your own judgement.

## Your content

You keep ownership of the content you create. You grant us the limited permission needed to store, sync, and display it to you and your household, and to process it through our providers to deliver the features you use.

## Availability

We provide Korb "as is" and can't guarantee it will always be uninterrupted or error-free. We may change, suspend, or discontinue features.

## Limitation of liability

To the maximum extent permitted by law, we are not liable for indirect or consequential damages, or for lost data or missed purchases arising from your use of the app. Nothing here limits liability that cannot be limited under applicable law, including your statutory consumer rights.

## Termination

You can stop using Korb at any time and delete your account in Settings. We may end your access if you materially breach these Terms.

## Changes

We may update these Terms; continued use after changes means you accept them.

## Governing law

These Terms are governed by the laws of **[JURISDICTION / COUNTRY]**, subject to any mandatory consumer protections of your country of residence.

## Contact

**[COMPANY / OPERATOR NAME]** — **[CONTACT EMAIL]**`;
