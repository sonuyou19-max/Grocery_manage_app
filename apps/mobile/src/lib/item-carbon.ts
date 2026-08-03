import type { ItemCategory } from '@korb/shared';

import { carbonOf, ecoScore, ecoSwaps, type CarbonTier, type EcoScore } from '@/lib/eco';
import { fold } from '@/lib/item-emoji';
import { lexiconLookup } from '@/lib/item-lexicon';

/**
 * eco.ts, with the shared dictionary plugged in.
 *
 * The split is the same one item-emoji.ts makes and for the same reason:
 * `lib/eco.ts` is pure — no storage, no network, no React — so the guard script
 * can run its rules on real Node and prove them. Reaching into the lexicon
 * cache from there would make it unloadable outside the app.
 *
 * So this is the two-line seam. Everything that renders calls these; nothing
 * calls `carbonOf` with a hand-supplied third argument except the tests.
 */

/** An item's impact band, consulting the shared lexicon for unknown terms. */
export function carbonFor(name: string, category: ItemCategory): CarbonTier | null {
  return carbonOf(name, category, lexiconLookup(fold(name))?.carbon ?? null);
}

interface ScorableItem {
  name: string;
  category: ItemCategory;
  bio?: boolean | null;
}

/** Score a basket, resolving each item's band the way the rows display it. */
export function ecoScoreFor(items: ScorableItem[]): EcoScore {
  return ecoScore(
    items.map((it) => ({
      name: it.name,
      category: it.category,
      bio: it.bio,
      carbon: lexiconLookup(fold(it.name))?.carbon ?? null,
    })),
  );
}

/** Re-exported so screens have one import for the whole feature. */
export { ecoSwaps };
