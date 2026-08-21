import AsyncStorage from '@react-native-async-storage/async-storage';

import { aiFunctionHeaders, supabase, supabaseUrl } from '@/lib/supabase';

/**
 * The AI weekly recap: the client aggregates a snapshot (no raw history, just
 * counts + a few names), the edge function turns it into a friendly narrative,
 * and we cache it for the week so it only regenerates ~once every 7 days.
 */

/**
 * The snapshot the recap is written from.
 *
 * ---------------------------------------------------------------------------
 * Why the counts are split, and named the way they are
 * ---------------------------------------------------------------------------
 *
 * This used to carry one `itemCount`, built from every row on every list —
 * ticked and unticked together. That is a third quantity which no card in the
 * app uses, and the model, given a bare number called "itemCount" and no
 * definition, narrated it as "you grabbed 17 items this week". Seventeen was
 * neither the two things bought nor the fifteen still waiting; the two cards
 * directly beneath the recap said 2 and 15, correctly, while the prose above
 * them contradicted both.
 *
 * So each field now names exactly one thing and comes from exactly the source
 * the card that displays it uses. The prompt defines every one of them, because
 * the failure was not the model's arithmetic — it was being handed a number
 * with no meaning attached and having to guess a verb for it.
 */
export interface RecapPayload {
  /**
   * Purchases logged in the last 7 days — the same source and window the
   * Climate Mix card counts. This is the only field that may be described with
   * a word like "bought".
   */
  boughtCount: number;
  /**
   * Rows still on a list and not yet ticked — the same set the "In your basket"
   * card measures. Waiting to be bought, and never to be described as bought.
   */
  basketCount: number;
  listCount: number;
  /** Food-group split of the BASKET, matching the card of that name. */
  balance: Array<{ group: string; pct: number }>;
  /** Aisles of what is in the basket, most first. */
  topCategories: Array<{ label: string; count: number }>;
  staples: string[];
  lowItems: string[];
  /** Spent on the week's logged purchases, not on price tags typed onto a list. */
  spendEuros: number;
  pricedCount: number;
  members: number;
  /**
   * The climate side, so the recap can mention it without a second AI call.
   *
   * Scored over the week's purchases, which is what the Climate Mix card
   * scores. Null when there is not enough food logged to score, which the
   * prompt is told to treat as "say nothing about it" rather than as a zero. A
   * recap that opened with "your climate score is 0" for somebody who bought
   * four bottles of bleach would be both wrong and rude.
   */
  ecoScore: number | null;
  /** Share of food items in the light band, 0–100. */
  ecoLowPercent: number | null;
  /**
   * Produce in season this month where the reader lives, already in their
   * language.
   *
   * Renamed from `inSeason` because the old name read, to a model, like a
   * property of the shopping it was describing — and it duly wrote "with
   * tomatoes, peppers and courgettes looking fresh" about a basket containing
   * none of them. These are suggestions from a calendar; the prompt says so.
   */
  seasonalSuggestions: string[];
}

/** The recap is prose, so it is generated in the reader's language. */
export async function generateRecap(
  payload: RecapPayload,
  language: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/weekly-recap`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({ ...payload, language }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { recap?: string };
    return data.recap?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * What the recap was written FROM, so a cached one written from a different
 * payload is a miss rather than stale prose nobody can tell is wrong.
 *
 * The alternative was a new column on household_recaps, and this needs none:
 * `week` is plain text, so prefixing the version changes the value every stored
 * row is compared against. Old rows read "2905"; the check now asks for
 * "2:2905", misses, regenerates and overwrites in place.
 *
 * Bump this whenever the payload's MEANING changes — a renamed field, a
 * different source for an existing one — not when the prompt is merely reworded.
 * The cost is one AI call per household, once; the cost of not bumping it is a
 * week of prose that describes numbers the app no longer sends.
 *
 * v2: `itemCount` (every row on every list, ticked and unticked together) split
 * into boughtCount and basketCount, spend and climate moved onto the purchase
 * log, and `inSeason` renamed to seasonalSuggestions. Every recap written
 * before this describes a quantity no card in the app reports.
 */
const PAYLOAD_VERSION = '2';

/** Current 7-day window index — changes once a week. */
export const weekKey = (d = new Date()): string =>
  `${PAYLOAD_VERSION}:${Math.floor(d.getTime() / (7 * 86_400_000))}`;

// v2 for the same reason as PAYLOAD_VERSION: the recaps in here were written
// from a payload that no longer exists. The weekKey change alone would cover
// it, but the two caches are read by different code paths and a key that still
// says v1 invites the next reader to assume its contents are current.
const CACHE_KEY = 'korb.weeklyRecap.v2';

interface CachedRecap {
  scope: string;
  week: string;
  text: string;
  language: string;
}

/**
 * This week's cached recap for the account scope, or null. A cached recap in a
 * different language is treated as a miss, so switching language in Settings
 * rewrites it rather than leaving prose the reader can't read.
 */
export async function getCachedRecap(scope: string, language: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedRecap;
    return c.scope === scope && c.week === weekKey() && c.language === language ? c.text : null;
  } catch {
    return null;
  }
}

export async function setCachedRecap(
  scope: string,
  text: string,
  language: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ scope, week: weekKey(), text, language } satisfies CachedRecap),
    );
  } catch {
    // best-effort
  }
}

// --- Shared (household) recap: one row per household, seen by every member ---

/** This household's stored recap, or null (also null before the table exists). */
export async function getSharedRecap(
  householdId: string,
): Promise<{ week: string; text: string; language: string } | null> {
  const { data, error } = await supabase
    .from('household_recaps')
    .select('week, text, language')
    .eq('household_id', householdId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    week: data.week as string,
    text: data.text as string,
    // Rows written before the language column defaulted to English.
    language: (data.language as string | null) ?? 'en',
  };
}

export async function setSharedRecap(
  householdId: string,
  text: string,
  language: string,
): Promise<void> {
  await supabase
    .from('household_recaps')
    .upsert(
      {
        household_id: householdId,
        week: weekKey(),
        text,
        language,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id' },
    );
}
