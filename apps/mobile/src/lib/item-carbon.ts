import type { ItemCategory } from '@korb/shared';

import { ecoScore, type EcoScore } from '@/lib/eco';
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
 * So this is the seam: one function, called by the two places that show eco
 * figures. Nothing hands `carbonOf` a band by hand except the check script.
 */

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
