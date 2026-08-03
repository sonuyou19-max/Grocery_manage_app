/**
 * Legal copy shown in-app (Settings → Legal) so the Privacy Policy and Terms
 * are always reachable — a requirement for App Store / Play review.
 *
 * The canonical, hostable versions live in `/legal/*.md` at the repo root; these
 * strings are the user-facing mirror (without the operator notes). Keep them in
 * sync. Operator: Sonu Kumar Suman (individual, Belgium); contact
 * support@korb.app. Still needs a professional review before publishing.
 *
 * Once the documents are hosted on a website, set PRIVACY_URL / TERMS_URL and
 * the Settings rows will open those instead of the bundled screen. The store
 * listing's "Privacy Policy URL" field needs a hosted URL regardless.
 */

export const LEGAL_LAST_UPDATED = '3 August 2026';

/** Hosted URLs — leave empty to use the bundled in-app screens. */
export const PRIVACY_URL = '';
export const TERMS_URL = '';

export type LegalDoc = 'privacy' | 'terms';

export const PRIVACY_MD = `# Privacy Policy

Last updated: ${LEGAL_LAST_UPDATED}

This Privacy Policy explains how **Sonu Kumar Suman** ("we", "us") handles your personal data when you use the Korb app. We are the data controller. For any privacy question, contact us at **support@korb.app**.

## Who this applies to

Korb is intended for users aged 16 and over. It is not directed at children, and we do not knowingly collect data from anyone under 16.

## The data we process

You can use Korb without an account. In that mode your lists are stored only on your device and we do not receive them.

When you sign in to sync and share, we process:

- **Account data** — your email address (for sign-in via a one-time code) and a display name you choose.
- **Household data** — the household name and invite code, and which accounts are members.
- **Grocery & pantry data** — the lists and items you create, which items you check off, and the pantry statistics used to predict restocks.
- **Technical data** — a session token and basic device information, and, if enabled, anonymised crash diagnostics.

- **Subscription status** — if you subscribe to Korb Plus, we store the date your access runs until, which store sold it, and that purchase's identifier, so the app knows what to unlock.

We do not collect your contacts, precise location, advertising identifiers, or payment card details, and we do not sell your data or use it for advertising.

We never see your payment details. Korb Plus is bought and billed entirely through Google Play; we receive only a confirmation that a subscription is active and until when.

## Store cards stay on your device

If you add supermarket loyalty cards, the card number and the shop it belongs to are stored **only on your phone**. They are never sent to us or to any other service, and they are not shared with other members of your household — even members who share the device, because cards are kept separately for each signed-in account. Adding a card therefore requires you to be signed in: a card is held under your account so that nobody else using the same phone can see it. Deleting a card, or deleting your account, removes them from the phone.

The camera is used only to read the barcode at the moment you add a card. No photo is stored or uploaded; only the decoded number is kept. Granting access to your photo library, if you choose to add a card from a screenshot, likewise only reads the image to decode it.

## How we use your data

- To provide the service — store and sync your lists and manage households.
- To provide AI features — categorising items, understanding quick-add text, and writing your weekly recap.
- To keep the service secure and working — abuse prevention and crash diagnostics.

## Who we share it with

- **Supabase** — hosting, database, and authentication, stored in the EU (Frankfurt).
- **Anthropic** — powers the AI features. When you use AI quick-add, automatic categorisation, or the weekly recap, the relevant text is sent to Anthropic to generate a response. It is not used to train their models, and may be processed outside the EU under appropriate safeguards.
- **Sentry** — receives anonymised crash reports to help us fix bugs. Reports identify the screen you were on, never the contents of your lists, your household, or which items they refer to.
- **Google Play and RevenueCat** — handle payment and tell us whether a subscription is active, if you buy Korb Plus. They receive no grocery, pantry, or household data.

We may also disclose data if required by law.

## How long we keep it

We keep your data for as long as your account exists. When you delete your account in Settings, we remove your account and the data tied to it; if you are the last member of a household, that household and its lists and pantry history are deleted too.

Purchase history older than a year is removed automatically. Ending a Korb Plus subscription does **not** delete anything: your older history stops being displayed beyond the free window and is shown again in full if you subscribe again.

## Your rights

If you are in the EU/EEA or UK, you have the right to access, correct, delete, export, restrict, or object to the processing of your data, and to withdraw consent. You can delete everything yourself in Settings → Delete account, or email **support@korb.app** to exercise any other right. You may also complain to your local data protection authority.

## Security

Data is encrypted in transit, and access to household data is enforced at the database level so only members can read or change it.

## Changes

We may update this policy; material changes will be reflected by the "Last updated" date above.

## Language

This policy is written in English, and the English version is the binding one. Where we offer a translation, it is provided for convenience; if it differs from the English text, the English text applies — except where the law of your country of residence requires otherwise.

## Contact

**Sonu Kumar Suman** — **support@korb.app**`;

export const TERMS_MD = `# Terms of Service

Last updated: ${LEGAL_LAST_UPDATED}

These Terms govern your use of the Korb app provided by **Sonu Kumar Suman** ("we", "us"). By using Korb you agree to these Terms.

## Eligibility

You must be at least 16 years old to use Korb.

## Your account

You can use Korb without an account. If you create one, you're responsible for keeping access to your email secure, since sign-in uses a one-time code sent to it.

## Households and shared content

Anything you add to a shared household can be seen and changed by other members. Only invite people you trust, and share invite codes carefully.

## Acceptable use

Please don't use Korb for anything unlawful, attempt to break or gain unauthorised access to the app or its backend, or abuse the AI or other features with automated or excessive requests. We may suspend access that violates these Terms.

## Korb Plus (subscription)

Korb is free to use. Everything you need to run a household costs nothing: your lists, cloud backup and live sync, sharing a household with other people, your loyalty cards, the pantry's restock predictions, and your recent spending.

**Korb Plus** is an optional paid subscription. It adds:

- a full year of spending history, instead of only the most recent weeks;
- price-change tracking, and cheaper-elsewhere comparisons between shops;
- your written weekly recap;
- the pantry-mix and staples breakdowns, the vibe check, and your itemised purchase history;
- your climate score week by week, which shops your lighter baskets happen at, and suggested swaps;
- no limit on the number of households you create.

Which features sit on which side may change as the app develops; if we move something you already rely on out of the free tier, we will tell you before it takes effect.

**Free month.** Every new account gets Korb Plus free for 30 days from the day it is created. You do not need to enter payment details to get it, and it does not turn into a paid subscription on its own — nothing is charged unless you choose to subscribe.

**Prices and billing.** Plus is offered monthly or annually. The exact price for your country, including VAT, is shown in the app before you confirm, and again by Google Play at the moment of purchase. Payment is taken by Google Play, not by us.

**Renewal.** Subscriptions renew automatically at the end of each period until cancelled. Google Play charges the renewal within 24 hours before the current period ends.

**Cancelling.** Cancel any time in the Google Play Store, under Payments & subscriptions. Cancelling stops the next renewal; you keep Plus until the end of the period you have already paid for. We cannot cancel a Google Play subscription on your behalf.

**Refunds.** Refunds are handled by Google Play under their policy. If you believe something has gone wrong, contact us and we will help where we can.

**Right of withdrawal (EU/EEA).** As a consumer you normally have 14 days to withdraw from a distance contract. Because Plus gives you immediate access to digital content, you are asked to agree at purchase that the service starts straight away, and you acknowledge that you lose the right of withdrawal once it has been fully performed. This does not affect your other statutory rights.

**If your subscription ends.** Nothing is deleted. Your older shopping history stays exactly where it is — it simply stops being shown beyond the free window, and the Plus features above stop being shown. Everything reappears in full if you subscribe again. You keep full use of every free feature, including sharing your household and your loyalty cards, and any household you already created stays yours.

**Price changes.** If we change the price of an existing subscription, you will be told in advance and asked to accept before it applies to you, as required by Google Play.

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

These Terms are governed by the laws of **Belgium**, subject to any mandatory consumer protections of your country of residence.

## Language

These Terms are written in English, and the English version is the binding one. Where we offer a translation, it is provided for convenience; if it differs from the English text, the English text applies — except where the law of your country of residence requires otherwise.

## Contact

**Sonu Kumar Suman** — **support@korb.app**`;

/**
 * Translated versions of the documents above, keyed by language code.
 *
 * Deliberately empty: these are binding legal texts, and the English source is
 * itself still awaiting a professional review. Translating first would mean
 * redoing every language once counsel edits the English. So the app serves the
 * English text in every language for now — which the "Language" clause in both
 * documents accounts for — and translations can be added here as they are
 * professionally prepared, one language at a time.
 *
 * To add one: `nl: { privacy: '# Privacybeleid …', terms: '# …' }`.
 */
const LEGAL_TRANSLATIONS: Partial<Record<string, Partial<Record<LegalDoc, string>>>> = {};

/**
 * The legal document to display, in the reader's language where a reviewed
 * translation exists and in English otherwise.
 */
export function legalDoc(doc: LegalDoc, language: string): string {
  const english = doc === 'terms' ? TERMS_MD : PRIVACY_MD;
  return LEGAL_TRANSLATIONS[language]?.[doc] ?? english;
}

/** Whether the reader is being shown English because their language has no translation. */
export const isLegalFallback = (doc: LegalDoc, language: string): boolean =>
  language !== 'en' && LEGAL_TRANSLATIONS[language]?.[doc] === undefined;
