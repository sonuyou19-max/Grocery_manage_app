// Term normalization, shared by the lexicon writer and — by exact duplication
// of behaviour — the client's lib/item-emoji.ts fold().
//
// This is a two-implementation invariant, which is the kind that rots quietly:
// nothing crashes if the two drift, the lexicon simply stores terms under keys
// the client will never ask for, and the feature degrades to "the AI never
// seems to help". scripts/check-lexicon.mjs loads BOTH implementations and
// asserts they agree character for character, so the drift is caught in CI
// rather than by wondering why the dictionary looks empty.
//
// It lives in its own file so that check can import it without dragging in the
// Supabase SDK that the rest of lexicon.ts needs.

const LIGATURES: Record<string, string> = {
  'ł': 'l', 'ø': 'o', 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i',
};

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[łøœæßđðþı]/g, (c) => LIGATURES[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
