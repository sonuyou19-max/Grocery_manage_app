import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  asFoodGroup,
  type CarbonTier,
  type FoodGroup,
  type ItemCategory,
} from '@korb/shared';

import { carbonOf } from '@/lib/eco';
import { canonicalize, fold } from '@/lib/item-emoji';
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
 * v3 was the format-aware prompt; v4 the dairy ladder; v5 stops rung 1 offering
 * a CONCENTRATED version of the same thing (ghee for butter) and gives drinks a
 * ladder of their own, since coffee was refusing outright; v6 widens that same
 * rule past animal products, which is where cocoa powder for chocolate slipped
 * through. v7 is a KEY change, not a content one: entries are now filed under
 * the canonicalised term (see below), so "sharp cheddar" and "cheddar" share a
 * slot — old entries filed under the un-canonicalised term would never be hit.
 */
const CACHE_KEY = 'korb.swaps.v7';

/**
 * Ceiling on the device copy. Each entry is three short strings; a few hundred
 * is a handful of kilobytes and far more heavy items than anyone opens. Past
 * it, new answers simply are not persisted rather than growing without bound.
 */
const MAX_ENTRIES = 300;

/**
 * Dev-only: shout when a rung is not actually lighter than the thing it
 * replaces.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Three bad suggestions shipped in a row and every one was found by a person
 * looking at a screenshot: ghee for butter, dark chocolate for chocolate, cocoa
 * powder for chocolate. They share a shape. Each is the right KIND of answer —
 * same aisle, same use, plausible to read — and each is heavier than what was
 * asked about, which makes it the one thing a lighter-alternatives feature must
 * never say.
 *
 * The app already knows. `carbonOf` scored dark chocolate `high` at the very
 * moment the row was drawing it as a "Good impact drop". Nothing was consulting
 * it, so the contradiction sat on screen unremarked. That is the whole bug: two
 * opinions about the same food in one process, never compared.
 *
 * So compare them. Every fetched ladder is now checked against the same table
 * that scores the shopper's basket, and a rung that fails prints the reason.
 *
 * ---------------------------------------------------------------------------
 * Why dev-only, and why a warning rather than a filter
 * ---------------------------------------------------------------------------
 *
 * Dropping a bad rung in production sounds better and is worse. The response
 * shape is all-three-or-nothing on purpose — a two-rung ladder reads as a bug
 * and a one-rung ladder as an opinion — so a filter would have to fall back to
 * 'none', turning "the prompt needs a fix" into "there is nothing lighter than
 * chocolate". Silently repairing the output would also hide the very signal
 * that gets the prompt fixed: the fix belongs in PROMPT_VERSION, not in a
 * client-side patch that quietly compensates forever.
 *
 * The keyword table is not the last word either. It is coarse by design (three
 * bands, movers only), so it will occasionally flag a rung a nutritionist would
 * defend. A warning invites that judgement. A filter would silently impose it.
 */
const BAND_RANK: Record<CarbonTier, number> = { low: 0, medium: 1, high: 2 };

/**
 * The band this app's own table gives a suggestion, or null if it reads as
 * non-food.
 *
 * The rung's OWN category, never 'other' — that constant is what drew a
 * shopping-cart glyph for every unrecognised suggestion, and it would mislead
 * here in the same way.
 */
export function rungBand(rung: SwapRung): CarbonTier | null {
  return carbonOf(rung.name, rung.category ?? 'other');
}

/**
 * Whether the score the reader is looking at would actually improve if they took
 * this suggestion.
 *
 * This is the question the badge under each rung was answering by ASSUMPTION —
 * rung 1 always said "Good impact drop" because it was first, not because
 * anything had checked. For ghee, dark chocolate and cocoa powder that claim was
 * false, and the app's own table said so at the same moment the row was drawing
 * it. Now the row asks.
 *
 * An unknown band is not a drop. Better to say less than to claim a fall the
 * score will not show.
 */
export function scoresLighter(item: string, rung: SwapRung): boolean {
  const asked = carbonOf(item, 'other');
  const band = rungBand(rung);
  if (!asked || !band) return false;
  return BAND_RANK[band] < BAND_RANK[asked];
}

function auditRungs(item: string, tiers: Swaps['tiers']): void {
  if (!__DEV__) return;

  /*
   * 'other' as the asked item's category, which needs justifying rather than
   * hand-waving: GROUP_CARBON contains no `high` at all, so every `high` band
   * in this app comes from the keyword table, which does not look at the
   * category. Heavy Hitters shows `high` items only. So for the one screen that
   * calls this, the substituted category provably cannot change the answer.
   *
   * Where it can differ is `foodGroupOf` deciding this name is not food, giving
   * null and skipping the audit. A missed warning in dev, which is the right
   * way for a diagnostic to fail.
   */
  const asked = carbonOf(item, 'other');
  if (!asked) return;

  const bands = tiers.map(rungBand);
  const faults: string[] = [];
  /*
   * Two different things can make a rung score no lighter, and conflating them
   * would have made this warning useless within a day of writing it.
   *
   * A FAULT is a genuinely wrong answer: ghee for butter, cocoa powder for
   * chocolate. Different word, same or worse band, no defence.
   *
   * A VARIANT is a rung that names the item back — "instant coffee" for coffee,
   * "chocolate with raisins" for chocolate. Those can be perfectly good advice
   * and are still unscoreable here, because the keyword table matches on words
   * and cannot tell a variant from its parent. Every keyword-scored food has
   * this hole at rung 1, so a check that shouted about it would shout on nearly
   * every ladder and get muted.
   *
   * Worth keeping visible rather than dropping, though: a variant rung means the
   * row's "Good impact drop" badge is a claim the app cannot back.
   */
  const variants: string[] = [];
  const askedWords = new Set(fold(item).split(/[\s,./-]+/).filter(Boolean));

  bands.forEach((band, i) => {
    const rung = `rung ${i + 1} "${tiers[i].name}"`;
    if (!band) {
      faults.push(`${rung} does not score as food`);
      return;
    }
    if (BAND_RANK[band] < BAND_RANK[asked]) return;
    const shared = fold(tiers[i].name)
      .split(/[\s,./-]+/)
      .find((w) => askedWords.has(w));
    if (shared) {
      variants.push(`${rung} shares "${shared}" with the item, so both score ${band}`);
    } else {
      faults.push(`${rung} is ${band}, and "${item}" is ${asked} — not a drop`);
    }
  });

  // The ladder's own promise, separately: rung 3 is sold as the "Best impact
  // drop", so it must not score above rung 1's "Good".
  const [first, , third] = bands;
  if (first && third && BAND_RANK[third] > BAND_RANK[first]) {
    faults.push(`rung 3 (${third}) scores above rung 1 (${first}) — ladder inverted`);
  }

  if (faults.length > 0) {
    console.warn(
      `[swaps] suggestions for "${item}" are not all lighter than it:\n  ` +
        `${faults.join('\n  ')}\n` +
        '  Fix the prompt and bump PROMPT_VERSION in suggest-swaps, or add the ' +
        'missing term to CARBON_KEYWORDS in lib/eco.ts.',
    );
  }
  if (variants.length > 0) {
    console.info(
      `[swaps] "${item}" has rungs the impact table cannot separate from it:\n  ` +
        `${variants.join('\n  ')}\n` +
        '  Not necessarily wrong advice — but the badge promises a drop the ' +
        'score will not show.',
    );
  }
}

const memory = new Map<string, Swaps>();
/**
 * Terms already in flight, so a double tap does not become two calls. Holds the
 * promise rather than a boolean, so the second caller gets the same answer
 * instead of nothing.
 */
const inFlight = new Map<string, Promise<SwapResult>>();
let hydrated = false;

/**
 * The device cache key for a name, matching the server's storage key exactly:
 * fold then canonicalize, so "Sharp Cheddar" and "Cheddar" resolve to the same
 * slot on the phone just as they do on the server. Both call sites go through
 * here so the two can never drift.
 */
const cacheKey = (name: string, locale: string) => `${locale}|${canonicalize(fold(name))}`;

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
  return memory.get(cacheKey(name, locale));
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
  const key = cacheKey(name, locale);

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

      /*
       * Reads BOTH shapes, and that is not politeness — it is the only way this
       * survives its own deploys.
       *
       * A rung used to be a bare string; it is now an object with the emoji,
       * category and group alongside. The client ships over the air and the
       * function ships through the Supabase CLI, so the two cannot land in the
       * same instant, and for a while one of them is older than the other.
       * Strict parsing turned that window into "Couldn't reach the suggestions"
       * on a function that was answering perfectly well — the app calling its
       * own backend a liar because it had not been redeployed yet.
       *
       * An old string still yields a usable rung: the name is the whole content,
       * and a missing emoji already falls back to the category glyph by design.
       */
      const tiers = data.tiers.map((raw) => {
        if (typeof raw === 'string') {
          return { name: raw.trim(), emoji: null, category: null, group: null };
        }
        const r = (raw ?? {}) as Record<string, unknown>;
        return {
          name: typeof r.name === 'string' ? r.name.trim() : '',
          emoji: typeof r.emoji === 'string' && r.emoji ? r.emoji : null,
          category: (typeof r.category === 'string' ? r.category : null) as ItemCategory | null,
          group: asFoodGroup(r.group),
        };
      }) as Swaps['tiers'];
      // A rung with no name is genuinely unusable, whichever shape it arrived in.
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

      /*
       * Audited here, on the fetch, rather than on every read: a memory hit
       * re-renders as the accordion opens and closes, and a warning that
       * reprints on each tap trains you to ignore it. Server-cache hits still
       * come through this path, so a bad answer warmed by somebody else is
       * caught too — which matters, because those are the ones this device
       * never asked for and would otherwise never inspect.
       */
      auditRungs(name, tiers);

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
