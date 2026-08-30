import type { Purchase } from '@/lib/purchase-log';
import type { StorePrefs } from '@/lib/store-prefs';
import { SUPERMARKETS, supermarketLabel } from '@/lib/supermarkets';

/**
 * The shops this household actually uses, most recent first.
 *
 * ---------------------------------------------------------------------------
 * Why the purchase log and not a remembered list
 * ---------------------------------------------------------------------------
 *
 * lib/store-prefs already remembers the shops somebody has picked, and it is
 * kept in AsyncStorage — which makes it a fact about a PHONE. Two people in one
 * household have two of them, so the corner shop one of them typed in is
 * invisible to the other, and the shared thing they are both describing is
 * remembered twice and differently.
 *
 * The household's real answer is already in the purchase log: every purchase
 * carries the store it was bought at, the log is shared, and it needs no
 * migration, no new table and nothing to keep in step. It is also better data
 * than a picker list — a shop that appears there is one somebody actually
 * bought something at, rather than one they once tapped.
 *
 * The device's own list is folded in behind it rather than dropped. A custom
 * store typed a minute ago has not reached the log yet — there is no purchase
 * against it until something is imported — and losing it between the typing and
 * the saving is exactly the moment it is needed.
 *
 * ---------------------------------------------------------------------------
 * Ordering
 * ---------------------------------------------------------------------------
 *
 * Most recently bought at, then most recently picked, then the catalogue in its
 * own order. Recency rather than frequency because a receipt is being reviewed
 * within minutes of a shop, and the shop you were just in is overwhelmingly the
 * answer — the picker's job is to put it first, not to be a fair ranking of a
 * year's habits.
 */
export interface StoreChoice {
  /** The value written to `store` — a catalogue id, or a name somebody typed. */
  id: string;
  /** What to show. The chain's proper name, or the typed name unchanged. */
  label: string;
  /** Epoch ms of the most recent evidence, or 0 for a chain never used here. */
  lastUsed: number;
  /** Whether this household has actually bought something here. */
  used: boolean;
}

export function storeChoices(
  purchases: readonly Purchase[],
  prefs: StorePrefs,
  catalogue: readonly { id: string }[] = SUPERMARKETS,
): StoreChoice[] {
  const seen = new Map<string, { lastUsed: number; used: boolean }>();

  const note = (id: string | null | undefined, at: number, used: boolean) => {
    const clean = id?.trim();
    if (!clean) return;
    const prev = seen.get(clean);
    if (!prev) {
      seen.set(clean, { lastUsed: at, used });
      return;
    }
    seen.set(clean, {
      lastUsed: Math.max(prev.lastUsed, at),
      // Once true, always true: a chain in the catalogue that this household has
      // also shopped at is a used store, whichever order the two are seen in.
      used: prev.used || used,
    });
  };

  // The household's own history first, so its timestamps win the max.
  for (const p of purchases) note(p.store, p.at, true);
  // Then this device's picks, which include customs not yet bought at.
  for (const [id, at] of Object.entries(prefs.lastUsed)) note(id, at, false);
  for (const id of prefs.custom) note(id, 0, false);
  // Then every chain, so a shop nobody has used yet is still offerable.
  for (const s of catalogue) note(s.id, 0, false);

  const rank = new Map(catalogue.map((s, i) => [s.id, i]));

  return [...seen.entries()]
    .map(([id, v]) => ({
      id,
      label: supermarketLabel(id) ?? id,
      lastUsed: v.lastUsed,
      used: v.used,
    }))
    .sort((a, b) => {
      if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
      // Never used, either of them: catalogue order, and anything not in the
      // catalogue after it. A typed store with no timestamp is a name somebody
      // wrote once and never used, which is exactly where it belongs.
      return (rank.get(a.id) ?? catalogue.length) - (rank.get(b.id) ?? catalogue.length);
    });
}
