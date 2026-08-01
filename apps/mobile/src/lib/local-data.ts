import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetAllHomeLists } from '@/lib/item-home-list';

/**
 * Clearing the account's data off the device.
 *
 * Signing out means this phone no longer holds your account's shopping. That is
 * a stronger statement than it sounds, and it is a deliberate choice between
 * three options that were all on the table:
 *
 *  1. **Leave the pre-signup local copy.** What the app did before. Sign out and
 *     you are looking at a snapshot from whenever you created your account —
 *     stale, silently wrong, and indistinguishable from live data.
 *
 *  2. **Copy the cloud down first, so nothing appears to vanish.** Tempting, and
 *     wrong twice. It puts other people's shopping on your phone — sign out of a
 *     shared household and their lists stay behind, which matters most in the
 *     case sign-out usually means, "someone else is about to use this device".
 *     And it creates a divergence nothing can resolve: edit locally while signed
 *     out, sign back in, and those edits are silently lost, because the
 *     migration has already run and will not run again. Making that safe needs
 *     real two-way sync with conflict resolution.
 *
 *  3. **Clear it.** Nothing stale, nothing leaked, nothing to diverge. The data
 *     is safe in the cloud and comes back on sign-in.
 *
 * ---------------------------------------------------------------------------
 * What is NOT cleared, and why
 * ---------------------------------------------------------------------------
 *
 * Only account data goes. What stays is the device's own quality-of-life:
 * remembered quantities and shops per item, the emoji/category caches, the
 * shared lexicon, locale, onboarding flags. None of that describes what you
 * bought — it describes how the app should behave — and wiping it would make
 * the free tier worse for no privacy gain, since the shared lexicon is public
 * by construction and the rest is a handful of preferences.
 *
 * Loyalty cards are handled separately, keyed per user (lib/loyalty-cards.ts).
 */

/**
 * Everything that describes what this account bought, or which household it was
 * looking at. The first two are the guest-mode copies; the rest are
 * household-scoped and become meaningless — or worse, misleading — the moment
 * the account they belong to is gone.
 */
const LOCAL_DATA_KEYS = [
  'korb.lists.v2',
  'korb.purchaseLog.v1',
  // Which household was selected. Left behind, it points at a household the
  // next person to sign in on this device has no business being switched into.
  'korb.activeHousehold.v1',
  // A cached paragraph of prose ABOUT the household's shopping week.
  'korb.weeklyRecap.v1',
];

/**
 * The "already carried into the cloud" flags.
 *
 * These have to be reset, not just left. Someone who signs out and then uses
 * the app as a guest for a month builds a fresh local list and log; if the
 * flags still said "migrated", signing up again would strand that month
 * permanently — the migrations check the flag before they check anything else.
 */
const MIGRATION_FLAG_KEYS = ['korb.lists.migrated.v1', 'korb.purchaseLog.migrated.v1'];

/**
 * Cached copies of cloud data, keyed by household id.
 *
 * The ids are not knowable in advance, so these are matched by prefix. They are
 * the most important thing in this file: they hold the actual contents of every
 * household the account belonged to, including ones shared with other people.
 */
const CLOUD_CACHE_PREFIXES = [
  'korb.lists.cloud.',
  'korb.pantryIntel.cloud.',
  'korb.purchaseLog.cloud.',
];

/**
 * Remove every trace of the signed-out account's shopping from this device.
 *
 * Best-effort and never throws: sign-out must complete even if storage is
 * misbehaving, because a user who cannot sign out is worse off than one whose
 * cache lingered. The session is dropped either way, so nothing is reachable
 * through the app in the meantime.
 */
export async function clearAccountDataFromDevice(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const cloudCaches = all.filter((k) => CLOUD_CACHE_PREFIXES.some((p) => k.startsWith(p)));
    await AsyncStorage.multiRemove([
      ...LOCAL_DATA_KEYS,
      ...MIGRATION_FLAG_KEYS,
      ...cloudCaches,
    ]);
    // Not a plain key removal: this module holds the whole map in memory, so
    // deleting the file alone would let the next write put it back. It owns
    // both halves of its own reset.
    forgetAllHomeLists();
  } catch {
    // See above.
  }
}
