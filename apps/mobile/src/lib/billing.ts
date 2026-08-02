import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

import { captureException } from '@/lib/monitoring';

/**
 * Korb Plus, bought through Google Play and brokered by RevenueCat.
 *
 * ---------------------------------------------------------------------------
 * RevenueCat is not the source of truth. Postgres is.
 * ---------------------------------------------------------------------------
 *
 * The SDK below can tell this device that a purchase went through, and that is
 * ALL it is used for here. Whether an account actually has Plus is decided by
 * `is_entitled()` in migration 0024, reading the `subscriptions` table, which
 * only the billing webhook may write.
 *
 * That split matters because the two answers disagree constantly and for
 * boring reasons: the device is offline, the app was reinstalled, the same
 * person is signed in on a second phone, a card failed and Play is retrying.
 * If the client decided, every one of those would be either a lockout or a
 * free subscription. So the purchase flow's real job is not to grant anything
 * — it is to finish, and then ask the server to look again.
 *
 * ---------------------------------------------------------------------------
 * Dormant until configured
 * ---------------------------------------------------------------------------
 *
 * Same shape as lib/monitoring.ts: with no API key this module does nothing,
 * `available()` is false, and every screen that would sell something hides
 * itself. That keeps the app runnable in Expo Go, in builds without the key,
 * and — importantly — through the whole period where the paywall exists in the
 * codebase but the Play Console products do not.
 *
 * The key is public by design (RevenueCat calls it the "public SDK key"); it
 * identifies the app, it does not authorise anything. The secret that matters
 * is the webhook signature, and that lives on the server.
 */

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

/**
 * The entitlement identifier configured in the RevenueCat dashboard.
 *
 * One entitlement, two products (monthly and annual) attached to it. Anything
 * that reads this is asking "does this person have Plus", never "which product
 * did they buy" — the answer to the second question is Google's business and
 * changes if the products are ever renamed or repackaged.
 */
export const PLUS_ENTITLEMENT = 'plus';

let configured = false;

/** Is billing wired up in this build? False in Expo Go and unconfigured builds. */
export function billingAvailable(): boolean {
  // iOS is deferred, and configuring with an Android key on iOS would fail
  // loudly at launch rather than degrade. See docs/RELEASE.md.
  return API_KEY.length > 0 && Platform.OS === 'android';
}

/**
 * Start the SDK and bind it to a Korb account.
 *
 * The RevenueCat app user id IS the Supabase user id. That is the whole
 * mechanism by which a webhook arriving at the server knows whose row to
 * update — there is no mapping table, because a mapping table is a thing that
 * can be missing a row exactly when someone has just paid you.
 *
 * Safe to call repeatedly: `configure` happens once, and later calls only
 * re-identify. Never throws; a failure here must not stop the app opening.
 */
export async function initBilling(userId: string | null): Promise<void> {
  if (!billingAvailable()) return;
  try {
    if (!configured) {
      Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
      // appUserID null lets RevenueCat mint an anonymous id, which is then
      // aliased to the real one by logIn below. Passing the id straight in
      // when we have it saves that round trip on the common path.
      Purchases.configure({ apiKey: API_KEY, appUserID: userId ?? null });
      configured = true;
      return;
    }
    if (userId) await Purchases.logIn(userId);
    else await Purchases.logOut();
  } catch (e) {
    captureException(e, { at: 'billing.init' });
  }
}

export interface PlusOffer {
  /** The RevenueCat package, handed straight back to `purchase`. */
  pkg: PurchasesPackage;
  /**
   * The price as the STORE formats it for this user — "€2,99", "2,99 €",
   * "9,99 zł". Never assembled here from a number and a currency code: the
   * separator, the symbol's side and the spacing all vary by locale, and
   * getting it wrong on a paywall is the one place a formatting slip reads as
   * dishonesty.
   */
  priceString: string;
  /** For the annual plan, the same figure expressed per month. */
  pricePerMonthString: string | null;
  /** Raw minor-unit price, used only to compute the annual saving. */
  price: number;
}

export interface PlusOffers {
  monthly: PlusOffer | null;
  annual: PlusOffer | null;
  /**
   * How much cheaper a year is than twelve months, as a percentage.
   *
   * Computed from the store's own numbers rather than written into a
   * translation, so it cannot drift when a price changes and cannot be wrong
   * in one country because it was right in another.
   */
  annualSavingPercent: number | null;
}

const toOffer = (pkg: PurchasesPackage | null | undefined): PlusOffer | null =>
  pkg
    ? {
        pkg,
        priceString: pkg.product.priceString,
        pricePerMonthString: pkg.product.pricePerMonthString ?? null,
        price: pkg.product.price,
      }
    : null;

/**
 * What is on sale, or null if we could not find out.
 *
 * Null is deliberately not "show the prices we hope are right". A paywall that
 * invents a figure when the store is unreachable will eventually show somebody
 * a price we do not charge, in a country we did not think about. The screen
 * shows an error and a retry instead.
 */
export async function getPlusOffers(): Promise<PlusOffers | null> {
  if (!billingAvailable()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) return null;
    const monthly = toOffer(current.monthly);
    const annual = toOffer(current.annual);
    if (!monthly && !annual) return null;

    let annualSavingPercent: number | null = null;
    if (monthly && annual && monthly.price > 0) {
      const yearOfMonths = monthly.price * 12;
      const saving = Math.round(((yearOfMonths - annual.price) / yearOfMonths) * 100);
      // Only shown when it is genuinely a saving worth naming. A "0% off"
      // badge, or a negative one, is worse than no badge.
      if (saving >= 5) annualSavingPercent = saving;
    }
    return { monthly, annual, annualSavingPercent };
  } catch (e) {
    captureException(e, { at: 'billing.getOffers' });
    return null;
  }
}

export type PurchaseOutcome =
  /** Play took the money. The server has NOT necessarily heard yet. */
  | { status: 'purchased' }
  /** They backed out. Not an error, and must not be reported as one. */
  | { status: 'cancelled' }
  | { status: 'failed' };

/**
 * Buy a package.
 *
 * Returning 'purchased' means Play completed the transaction, not that Korb has
 * unlocked anything. The caller's next move is to poll the server — see
 * `waitForEntitlement` in the paywall — because the webhook and the user are
 * racing, and the user usually wins.
 */
export async function purchasePlus(offer: PlusOffer): Promise<PurchaseOutcome> {
  if (!billingAvailable()) return { status: 'failed' };
  try {
    await Purchases.purchasePackage(offer.pkg);
    return { status: 'purchased' };
  } catch (e) {
    // RevenueCat reports a cancel as a thrown error with this flag. Treating it
    // as a failure would show an apology to somebody who simply changed their
    // mind, and would fill Sentry with non-events.
    if ((e as { userCancelled?: boolean })?.userCancelled) return { status: 'cancelled' };
    captureException(e, { at: 'billing.purchase' });
    return { status: 'failed' };
  }
}

/**
 * Re-apply a purchase made on another device, or before a reinstall.
 *
 * Google Play requires a restore path to exist, and it is also the honest
 * answer to "I already paid for this". Like a purchase, a successful restore
 * only tells the server to look again.
 */
export async function restorePlus(): Promise<boolean> {
  if (!billingAvailable()) return false;
  try {
    const info = await Purchases.restorePurchases();
    return info.entitlements.active[PLUS_ENTITLEMENT] != null;
  } catch (e) {
    captureException(e, { at: 'billing.restore' });
    return false;
  }
}
