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
          sightings: 0,
          published: false,
        },
        { onConflict: 'term', ignoreDuplicates: true },
      );
    if (upsertError) return;

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
