import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * What Korb Plus is, in one place.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module and not two arrays
 * ---------------------------------------------------------------------------
 *
 * The Plus card and the paywall each held their own list of capabilities,
 * hand-kept in the same order. They drifted exactly once before anyone noticed:
 * the recipe importer was named in the Terms of Service as a paid feature while
 * appearing in neither list, so the app was contractually selling something it
 * never mentioned. A guard now asserts the two agree — but the honest fix is for
 * there to be only one list, and this is it.
 *
 * ---------------------------------------------------------------------------
 * Three pillars, not ten bullets
 * ---------------------------------------------------------------------------
 *
 * Ten capabilities presented flat is a specification, and a specification is
 * what somebody reads when they have already decided to buy. Somebody deciding
 * reads two or three things and forms an impression. So the same ten are grouped
 * under the three reasons a person would actually pay — spend less, spend less
 * time, eat better — and shown one group at a time.
 *
 * Grouping is a claim, not just a layout: it says "here is what this does for
 * you", which is checkable, where a flat list says only "here is what it has".
 *
 * ---------------------------------------------------------------------------
 * Nine here and two in the footer, not a strict six
 * ---------------------------------------------------------------------------
 *
 * Two per slide would be the tidier rule and it puts TWELVE MONTHS OF HISTORY in
 * the small print — the one capability the subscription's own tagline is built
 * around, and the reason the free tier has a five-week window at all. Three,
 * three, two keeps every load-bearing claim in the headline and leaves the two
 * genuinely secondary ones (the weekly recap, unlimited households) to a single
 * line underneath, where they are still stated and still true.
 *
 * ---------------------------------------------------------------------------
 * The names describe what Korb does, deliberately
 * ---------------------------------------------------------------------------
 *
 * "Price Match Alerts" and "Cheapest Shop Finder" were the obvious marketing
 * names and both are lies of exactly the kind this app cannot afford: they
 * promise that Korb watches prices and finds shops on its own. It does neither.
 * It compares prices the user typed. Every string these ids resolve to says so,
 * because the first support email otherwise is "why didn't it alert me?" — and
 * that person is right to ask.
 */

export interface PlusFeature {
  icon: IconName;
  /** i18n key suffix under `plus.detail.` — `<id>Title` and `<id>Body`. */
  id: string;
}

export interface PlusPillar {
  /** i18n key suffix under `plus.pillar.` — `<id>Title` and `<id>Kicker`. */
  id: string;
  icon: IconName;
  features: PlusFeature[];
}

export const PLUS_PILLARS: readonly PlusPillar[] = [
  {
    id: 'money',
    icon: 'wallet-outline',
    features: [
      { icon: 'swap-vertical-outline', id: 'moves' },
      { icon: 'trending-down-outline', id: 'cheaper' },
      { icon: 'time-outline', id: 'history' },
    ],
  },
  {
    id: 'time',
    icon: 'flash-outline',
    features: [
      { icon: 'pulse-outline', id: 'vibe' },
      { icon: 'restaurant-outline', id: 'recipe' },
      { icon: 'repeat-outline', id: 'staples' },
    ],
  },
  {
    id: 'better',
    icon: 'leaf-outline',
    features: [
      { icon: 'file-tray-full-outline', id: 'pantryMix' },
      { icon: 'leaf-outline', id: 'eco' },
    ],
  },
];

/**
 * Stated, but not as a headline.
 *
 * Present so that "Plus has ten things" stays literally true wherever this is
 * rendered. A capability that exists and is never mentioned is the failure this
 * module was built to prevent, so the footer is not optional decoration — the
 * guard script counts these plus the pillar features and requires the total to
 * match the plus.detail.* copy.
 */
export const PLUS_ALSO: readonly PlusFeature[] = [
  { icon: 'sparkles-outline', id: 'recap' },
  { icon: 'home-outline', id: 'households' },
];

/** Every capability Plus sells, headline or not. */
export const ALL_PLUS_FEATURES: readonly PlusFeature[] = [
  ...PLUS_PILLARS.flatMap((p) => p.features),
  ...PLUS_ALSO,
];
