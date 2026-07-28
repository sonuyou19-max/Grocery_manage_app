import type { Purchase } from '@/lib/purchase-log';

/**
 * Re-homing a guest's purchase history when they sign in.
 *
 * Korb works fully signed out, and a guest's shopping is recorded in
 * AsyncStorage — potentially a year of it. The moment they sign in and join a
 * household, the app switches to the cloud backend and that local log is
 * orphaned: still on disk, no longer read by anything.
 *
 * That was survivable while Insights was ungated. It stops being survivable the
 * moment signing in is the thing we ask people to do IN ORDER to see their
 * insights — they would tap "sign in to keep your insights", and land on a tab
 * emptier than the one they left. The feature would be actively dishonest.
 *
 * ---------------------------------------------------------------------------
 * Why this is a merge and not a move
 * ---------------------------------------------------------------------------
 *
 * The household may already have history — from another member, or from this
 * user on another device. So local rows are ADDED to what is there, never
 * substituted for it, and anything that looks like it is already present is
 * skipped rather than duplicated.
 *
 * "Looks like it is already present" is the same rule migration 0020's backfill
 * uses: same item, same day. Not same millisecond — the cloud copy of a
 * purchase may have been written by a different device with a slightly
 * different clock, and matching on an exact timestamp would let every one of
 * those through as a duplicate.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same-item-same-day identity, the unit of "we already have this". */
const slotOf = (p: Purchase): string => `${p.key}|${Math.floor(p.at / DAY_MS)}`;

/**
 * Which of the device's purchases the household hasn't got.
 *
 * Pure so check-purchase-migration.mjs can exercise it: this decides whether a
 * user's history is preserved, silently duplicated, or silently dropped, and
 * all three outcomes look identical from the outside until someone opens
 * Insights and counts.
 *
 * @param local   everything in the device's log
 * @param cloud   what the household already has, as just fetched
 * @param now     for the retention window; older rows are not worth uploading
 *                since nothing reads past it anyway
 * @param windowMs retention window, matching PURCHASE_WINDOW_MS
 */
export function purchasesToMigrate(
  local: Purchase[],
  cloud: Purchase[],
  now: number,
  windowMs: number,
): Purchase[] {
  const cutoff = now - windowMs;
  const taken = new Set(cloud.map(slotOf));
  // Cloud ids too: a re-run after a partial upload must not re-send rows that
  // did land, and those carry the id this device generated.
  const ids = new Set(cloud.map((p) => p.id));

  const out: Purchase[] = [];
  for (const p of local) {
    if (!p.key) continue;
    if (p.at < cutoff) continue;
    // A future-stamped row is a clock jump, not a purchase. Uploading it would
    // put a permanent phantom at the right-hand edge of everyone's spend chart.
    if (p.at > now + DAY_MS) continue;
    if (ids.has(p.id)) continue;
    const slot = slotOf(p);
    if (taken.has(slot)) continue;
    // Claim the slot as we go, so two local rows for the same item on the same
    // day collapse to one — the local log can hold both if the session window
    // lapsed between them, and re-uploading both would double that day's spend.
    taken.add(slot);
    out.push(p);
  }
  return out;
}
