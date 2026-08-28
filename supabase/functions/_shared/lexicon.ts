// Writes to the shared item lexicon (migration 0019).
//
// Everything about this module is about being careful with a table that every
// customer reads. The gates are documented in the migration; this is the code
// that enforces gates 2–4. Gate 1 (nothing client-writable) is enforced by the
// absence of RLS write policies, and holds whether or not this file is correct.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { isAllowedEmoji, isShareableTerm } from './emoji-allowlist.ts';
import { fold } from './fold.ts';

/**
 * How many DISTINCT callers must independently ask about a term before it is
 * published to everyone.
 *
 * Three is the smallest number that means anything. At one, the table is just
 * "every string anyone ever typed" and the privacy gate does nothing. Much
 * higher and the long tail of genuinely useful regional products ("speculoos",
 * "kefir", "harissa") never reaches the threshold in a small user base, which
 * is where the feature earns its keep.
 */
const PUBLISH_THRESHOLD = 3;

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}

/**
 * Salted, non-reversible caller identifier.
 *
 * The point of the sightings ledger is to count *distinct* askers, which needs
 * a stable per-caller value — and the obvious stable value is the IP, which we
 * are not willing to store. HMAC with a secret that lives only in the function
 * environment gives the distinctness without the identifier: the digest cannot
 * be walked back to an IP without the salt, and the salt is never in the
 * database, the client, or this repository.
 */
async function callerHash(caller: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(caller));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface LexiconCandidate {
  term: string;
  emoji: string;
  category: string | null;
  /** The model's own judgement: is this a common grocery product? */
  generic: boolean;
  /**
   * How this item is normally bought, or null when the model wasn't confident.
   * Null is stored as null — an absent answer, not a wrong one; see 0021.
   */
  unit?: string | null;
  /**
   * The item's climate band, or null when the model declined or the item is
   * not food. Null is stored as null for the same reason as unit; see 0027.
   */
  carbon?: string | null;
  /**
   * The coarse food group. Already computed by the same call — see 0032 for
   * how long it was being discarded. 'nonfood' is a real value here, not an
   * absence: it is what lets a client exclude an item from the mix rather than
   * counting it as "other".
   */
  group?: string | null;
  /**
   * One short sentence on keeping the item well, or null.
   *
   * The only FREE TEXT this table publishes, and the only field whose value
   * cannot be checked against a vocabulary — see isShareableTip for the gates
   * that replace one.
   */
  tip?: string | null;
}

/**
 * Words that turn a storage tip into a regulated claim.
 *
 * "High in iron" is a nutrition claim under EU Regulation 1924/2006: only
 * claims on the authorised list may be made at all, and each has a legal
 * threshold behind it. A shared table that publishes one to every customer is
 * making that claim on behalf of all of them, about an item somebody typed.
 *
 * Storage advice is not a health claim and is not regulated — it is the same
 * category of statement as the printing on the bag. So the rule is not "no
 * claims about food", it is: say how to keep it, and nothing about what it does
 * to you.
 *
 * Matched on word boundaries against the folded tip. Deliberately broad: a tip
 * refused for containing "healthy" costs a sentence, and one published for
 * lacking the exact phrase costs a compliance problem nobody will notice.
 */
const CLAIM_WORDS = [
  'vitamin', 'vitamins', 'mineral', 'minerals', 'protein', 'calcium', 'iron',
  'omega', 'antioxidant', 'antioxidants', 'fibre', 'fiber', 'calorie',
  'calories', 'nutrient', 'nutrients', 'nutritious', 'nutrition', 'healthy',
  'health', 'immune', 'immunity', 'digestion', 'digestive', 'cholesterol',
  'diabetes', 'cancer', 'heart', 'detox', 'superfood', 'metabolism',
  'weight', 'slimming', 'cure', 'cures', 'heals', 'remedy', 'medicinal',
];

/**
 * Is this sentence safe to publish to every customer?
 *
 * Shape first, then meaning. The shape rules are duplicated in the CHECK on the
 * column (0040) on purpose: this is the function refusing to send it, and that
 * is the database refusing to store it, and neither is the other's excuse.
 *
 * Exported so scripts/check-lexicon can exercise it directly. It is the only
 * gate on the only free-text column in a table every customer reads, and a gate
 * that is only tested through a network call is a gate nobody tests.
 */
export function isShareableTip(tip: string): boolean {
  const trimmed = tip.trim();
  // Long enough to say something, short enough not to be a paragraph.
  if (trimmed.length < 12 || trimmed.length > 140) return false;
  // A sentence, not a list or a document.
  if (/[\n\r\t]/.test(trimmed)) return false;
  // No links, ever. A published sentence that can carry a URL can carry
  // somebody else's URL.
  if (/(https?:\/\/|www\.)/i.test(trimmed)) return false;
  // No markup: angle brackets, braces and backticks have no business in a
  // sentence about a fridge, and their presence means something upstream went
  // wrong rather than that the tip is unusual.
  if (/[<>{}`\[\]|]/.test(trimmed)) return false;
  // One sentence. Two is a paragraph pretending to be a tip.
  if ((trimmed.match(/[.!?](\s|$)/g) ?? []).length > 1) return false;

  const folded = fold(trimmed);
  return !CLAIM_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(folded));
}

/**
 * Record a sighting and publish the term once it has enough distinct askers.
 *
 * Called fire-and-forget: the caller already has their answer, and a slow or
 * failing dictionary write must never delay or fail the response they are
 * waiting on. Every failure path here is a silent return.
 */
export async function offerToLexicon(
  candidate: LexiconCandidate,
  caller: string,
): Promise<void> {
  const salt = Deno.env.get('LEXICON_SALT');
  // No salt configured means no way to count distinct callers without storing
  // something identifying. Fail closed: skip sharing entirely rather than fall
  // back to a weaker identifier. The caller still got their emoji.
  if (!salt) return;

  const term = fold(candidate.term);
  // Gates 2 and 3, cheapest first.
  if (!isShareableTerm(term)) return;
  if (!candidate.generic) return;
  if (!isAllowedEmoji(candidate.emoji)) return;

  const db = adminClient();
  // Same closed set as UNITS in packages/shared and the CHECK in 0021. Callers
  // are expected to have validated already; this is the helper refusing to be
  // the way something unvalidated reaches a table every customer reads.
  const unit =
    typeof candidate.unit === 'string' && ['g', 'kg', 'ml', 'L', 'pcs'].includes(candidate.unit)
      ? candidate.unit
      : null;
  // Same arrangement for the climate band, against CARBON_TIERS in
  // packages/shared and the CHECK in 0027.
  const carbon =
    typeof candidate.carbon === 'string' && ['low', 'medium', 'high'].includes(candidate.carbon)
      ? candidate.carbon
      : null;
  // Same arrangement again, against FOOD_GROUPS in packages/shared and the
  // CHECK in 0032. 'nonfood' belongs in this list: see the migration.
  const group =
    typeof candidate.group === 'string' &&
    ['produce', 'protein', 'carbs', 'fats', 'other', 'nonfood'].includes(candidate.group)
      ? candidate.group
      : null;
  /*
   * And the tip, which has no vocabulary to be checked against — so it is
   * checked for shape and for claims instead. Anything that does not pass is
   * dropped silently: a term with no tip is the ordinary case, and refusing one
   * sentence costs a reader nothing.
   */
  const tip =
    typeof candidate.tip === 'string' && isShareableTip(candidate.tip)
      ? candidate.tip.trim()
      : null;

  try {
    // Ensure the row exists without disturbing an existing one. ignoreDuplicates
    // matters: a term already published must not have its emoji rewritten by a
    // later, differently-minded generation — the first three-caller consensus
    // stands until someone changes it deliberately.
    const { error: upsertError } = await db
      .from('item_lexicon')
      .upsert(
        {
          term,
          emoji: candidate.emoji,
          category: candidate.category,
          unit,
          carbon,
          food_group: group,
          storage_tip: tip,
          sightings: 0,
          published: false,
        },
        { onConflict: 'term', ignoreDuplicates: true },
      );
    if (upsertError) return;

    // Fill in a unit the row doesn't have yet.
    //
    // The upsert above deliberately never touches an existing row, which is
    // right for emoji and category — but every term learned before migration
    // 0021 has unit NULL, and under that rule it would stay NULL forever. The
    // `is('unit', null)` filter is what keeps the two rules compatible: an
    // established unit is still immutable, an absent one gets written once.
    if (unit) await db.from('item_lexicon').update({ unit }).eq('term', term).is('unit', null);
    // And the same fill-once rule for carbon, so every term published before
    // 0027 can still acquire a band without any of them becoming rewritable.
    if (carbon) {
      await db.from('item_lexicon').update({ carbon }).eq('term', term).is('carbon', null);
    }
    // And once more for the group, so every term published before 0032 can
    // acquire one without any of them becoming rewritable.
    if (group) {
      await db
        .from('item_lexicon')
        .update({ food_group: group })
        .eq('term', term)
        .is('food_group', null);
    }
    /*
     * And the tip, on the same fill-once rule as the three above: every term
     * published before 0040 can acquire one, and none of them becomes
     * rewritable. That matters more here than anywhere else — a sentence that
     * can be overwritten by a later generation is a sentence with no settled
     * version, and the whole point of the three-caller threshold is that one
     * consensus stands.
     */
    if (tip) {
      await db
        .from('item_lexicon')
        .update({ storage_tip: tip })
        .eq('term', term)
        .is('storage_tip', null);
    }

    const hash = await callerHash(caller, salt);
    // The composite primary key is what makes this count distinct — the same
    // caller asking repeatedly conflicts here and advances nothing.
    const { error: sightingError } = await db
      .from('item_lexicon_sightings')
      .insert({ term, caller_hash: hash });
    // A duplicate (23505) is the normal repeat-caller case, not a problem, but
    // either way there is nothing further to do for this request.
    if (sightingError) return;

    const { count, error: countError } = await db
      .from('item_lexicon_sightings')
      .select('*', { count: 'exact', head: true })
      .eq('term', term);
    if (countError || count == null) return;

    await db
      .from('item_lexicon')
      .update({ sightings: count, published: count >= PUBLISH_THRESHOLD })
      .eq('term', term);
  } catch {
    // The dictionary is an optimisation. Never let it surface as an error.
  }
}
