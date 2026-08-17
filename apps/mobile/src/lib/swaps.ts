import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  asFoodGroup,
  type FoodGroup,
  type ItemCategory,
} from '@korb/shared';

import { fold } from '@/lib/item-emoji';
import { learnLexiconEntry } from '@/lib/item-lexicon';
import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

/**
 * Lighter alternatives for one heavy item, fetched on tap.
 *
 * ---------------------------------------------------------------------------
 * Why this is fetched and not computed
 * ---------------------------------------------------------------------------
 *
 * The three rungs are food NAMES in the reader's own language, and this app
 * ships seven. A table on the device would have to carry every name in every
 * language, and would still answer "no idea" for the long tail of real
 * products people actually buy. The model already knows all of it, and the
 * answer is cached server-side by (term, locale) — see migration 0033 — so the
 * second household to open beef pays nothing at all.
 *
 * ---------------------------------------------------------------------------
 * Why the local cache exists as well
 * ---------------------------------------------------------------------------
 *
 * The server cache saves the MODEL call. This one saves the round trip, and
 * they are different costs to the person holding the phone. Opening an item,
 * closing it, and opening it again is an ordinary thing to do while reading a
 * list, and it should not spin for 300ms each time.
 *
 * Keyed by term AND locale for the same reason the table is: switching the
 * app's language must not serve the old language's answers.
 */

/**
 * One rung of the ladder.
 *
 * The metadata rides along with the name because the alternative is asking
 * twice. Without it the row drew the `other` category's shopping-cart glyph for
 * everything the client's own keyword table did not recognise — "plant-based
 * mince" and "lentils" both came back as 🛒 — and adding one to a list then
 * fired a SECOND AI call to categorize the very item we had just invented.
 * These fields cost a handful of output tokens on a call already being made.
 *
 * emoji and category are nullable: a model answer outside the allowlist is
 * dropped rather than shown, and the client falls back to its own category
 * glyph. A worse row, not a broken one.
 */
export interface SwapRung {
  name: string;
  emoji: string | null;
  category: ItemCategory | null;
  group: FoodGroup | null;
}

export interface Swaps {
  /** Three rungs, easiest swap first. Always three, or the answer is dropped. */
  tiers: [SwapRung, SwapRung, SwapRung];
}

/**
 * What a lookup can come back as, and why three cases rather than two.
 *
 * The first version returned `Swaps | null` and the screen printed one sentence
 * for the null — "no lighter alternative to suggest for this one". That sentence
 * is a claim about the FOOD, and it was being shown for things that were really
 * claims about the app: the function not deployed yet, a missing API key, a
 * tripped spend cap, a plane. Telling someone there is no lighter option than
 * beef is worse than telling them nothing, because it is confidently wrong and
 * they have no way to know.
 *
 *   Swaps    three rungs
 *   'none'   the engine answered and genuinely has nothing for this item
 *   'error'  the engine could not be reached or refused — say so, and retry
 */
export type SwapResult = Swaps | 'none' | 'error';

/*
 * v3, and this key has to move for TWO different reasons, which is worth
 * knowing before the next change.
 *
 * A SHAPE change: v2 made a rung an object rather than a bare string, and an old
 * payload would deserialise into three strings where the screen expects three
 * objects.
 *
 * A CONTENT change: the device copy has no idea which prompt produced it. The
 * server's cache handles this properly — prompt_version is part of its key
 * (migration 0034) — but this one would happily serve last month's answers
 * forever. So when suggest-swaps' PROMPT_VERSION goes up, this goes up with it.
 * v3 was the format-aware prompt; v4 extends it past meat — solid before liquid,
 * and a named dairy ladder, because cheese was answering rung 2 with a seasoning
 * and rung 3 with a sauce.
 */
const CACHE_KEY = 'korb.swaps.v4';

/**
 * Ceiling on the device copy. Each entry is three short strings; a few hundred
 * is a handful of kilobytes and far more heavy items than anyone opens. Past
 * it, new answers simply are not persisted rather than growing without bound.
 */
const MAX_ENTRIES = 300;

const memory = new Map<string, Swaps>();
/**
 * Terms already in flight, so a double tap does not become two calls. Holds the
 * promise rather than a boolean, so the second caller gets the same answer
 * instead of nothing.
 */
const inFlight = new Map<string, Promise<SwapResult>>();
let hydrated = false;

const cacheKey = (term: string, locale: string) => `${locale}|${term}`;

/** Read the device copy. Cheap, and safe to call more than once. */
export async function hydrateSwaps(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const flat = JSON.parse(raw) as Record<string, Swaps['tiers']>;
    for (const [key, tiers] of Object.entries(flat)) {
      if (Array.isArray(tiers) && tiers.length === 3) memory.set(key, { tiers });
    }
  } catch {
    // A corrupt cache costs a round trip, not a feature.
  }
}

function persist(): void {
  const flat: Record<string, Swaps['tiers']> = {};
  let n = 0;
  for (const [key, value] of memory) {
    if (n++ >= MAX_ENTRIES) break;
    flat[key] = value.tiers;
  }
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flat)).catch(() => {});
}

/** What the device already knows, or undefined. Synchronous, for render. */
export function cachedSwaps(name: string, locale: string): Swaps | undefined {
  return memory.get(cacheKey(fold(name), locale));
}

/**
 * Fetch the three rungs for an item.
 *
 * 'none' is a real result and the caller must render it as one — plenty of
 * foods have no lighter stand-in, and a spinner that never ends is the worst way
 * to say so. 'error' is NOT that, and must not be shown as if it were; see
 * SwapResult.
 */
export async function fetchSwaps(name: string, locale: string): Promise<SwapResult> {
  const term = fold(name);
  const key = cacheKey(term, locale);

  const hit = memory.get(key);
  if (hit) return hit;

  const running = inFlight.get(key);
  if (running) return running;

  const call = (async (): Promise<SwapResult> => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/suggest-swaps`, {
        method: 'POST',
        headers: await aiFunctionHeaders(),
        body: JSON.stringify({ name, locale }),
      });
      // Anything other than 200 is about the app, not the food: 404 when the
      // function is not deployed, 500 for a missing key, 503 when the spend cap
      // has tripped. None of those are "there is nothing lighter than beef".
      if (!res.ok) return 'error';
      const data = (await res.json()) as { ok?: boolean; tiers?: unknown };
      // ok:false IS about the food — the function looked and declined.
      if (data.ok === false) return 'none';
      if (!Array.isArray(data.tiers) || data.tiers.length !== 3) return 'error';

      const tiers = data.tiers.map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        return {
          name: String(r.name ?? ''),
          emoji: typeof r.emoji === 'string' && r.emoji ? r.emoji : null,
          category: (typeof r.category === 'string' ? r.category : null) as ItemCategory | null,
          group: asFoodGroup(r.group),
        };
      }) as Swaps['tiers'];
      if (tiers.some((r) => !r.name)) return 'error';

      /*
       * Seed the shared lexicon locally, right now.
       *
       * Publication needs three distinct askers (migration 0019), so without
       * this the person who asked FIRST would see their own suggestions drawn
       * with the fallback cart glyph until two strangers happened to open the
       * same item. Writing it here also means adding the suggestion to a list
       * costs no categorize call: the term is already classified.
       */
      for (const r of tiers) {
        if (r.emoji) learnLexiconEntry(fold(r.name), r.emoji, r.category, null, null, r.group);
      }

      const value: Swaps = { tiers };
      memory.set(key, value);
      persist();
      return value;
    } catch {
      // Offline, or DNS, or the request was cut off mid-flight. Not the food's
      // fault either.
      return 'error';
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, call);
  return call;
}
