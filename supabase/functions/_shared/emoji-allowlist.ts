// The closed set of emoji the model may choose from.
//
// Why a closed set rather than "return a fitting emoji":
//
// The answer lands in item_lexicon, which every customer reads. A single odd
// generation — a flag, a person, a weapon, a zero-width-joiner sequence that
// renders as tofu on an older Android — is therefore not one bad row on one
// phone, it is one bad row on every phone. Constraining the output to a list we
// chose makes that class of failure impossible rather than unlikely, and turns
// validation into a set membership test with no edge cases.
//
// It also improves the answers. Asked for "an emoji", a model will happily
// invent something clever and inconsistent; asked to pick the closest match
// from a list, it does the thing we actually want, which is to map an unfamiliar
// product onto the visual vocabulary the app already uses.
//
// Every entry here is a single-codepoint food, drink, or household glyph with
// wide font coverage. No flags (political), no people or body parts (identity
// and skin-tone variants), no ZWJ sequences (rendering), nothing that reads as
// a judgement about what someone bought.
//
// This file is the authority. The client does not duplicate the list — anything
// it reads from item_lexicon was validated here on the way in, so it only needs
// a cheap structural sanity check. Keeping one copy is the point: two copies
// drift, and the one that drifts is the one that stops matching.

export const EMOJI_ALLOWLIST: readonly string[] = [
  // fruit
  '🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒',
  '🍑', '🥭', '🍍', '🥥', '🥝', '🫒', '🍅',
  // vegetables
  '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🫑', '🥒', '🥬', '🥦', '🧄', '🧅',
  '🍄', '🥜', '🫘', '🌰', '🌿', '🍠',
  // bakery & grains
  '🍞', '🥐', '🥖', '🫓', '🥨', '🥯', '🥞', '🧇', '🍚', '🍜', '🍝', '🌾',
  // dairy & eggs
  '🧀', '🥚', '🍳', '🧈', '🥛', '🍼',
  // meat & fish
  '🥩', '🍗', '🍖', '🥓', '🌭', '🍔', '🐟', '🍤', '🦐', '🦑', '🦀', '🐙',
  // prepared & frozen
  '🍕', '🥪', '🌮', '🌯', '🥗', '🥘', '🍲', '🥫', '🧊', '🍟',
  // sweets
  '🍦', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍯',
  // drinks
  '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍾', '🍷', '🍸', '🍺', '🍻', '💧',
  // seasoning & staples
  '🧂', '🥣', '🍽️', '🫙',
  // household
  '🧻', '🧼', '🧽', '🧴', '🧹', '🧺', '🪣', '🗑️', '🕯️', '🔋', '💡', '🧯',
  '🪥', '🪒', '💊', '🩹', '🧷', '🧵', '📦', '✏️', '📎', '🔌',
  // pets, plants, misc
  '🐱', '🐶', '🌱', '💐', '🌸', '🎈', '🎁', '🛒',
] as const;

const ALLOWED = new Set(EMOJI_ALLOWLIST);

/** True only for an exact member of the allowlist. */
export function isAllowedEmoji(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED.has(value);
}

/**
 * A term is eligible for the SHARED lexicon only if it looks like a grocery
 * word rather than someone's private note.
 *
 * This runs before the model is asked to judge anything, because the cheapest
 * way to keep "call dr rutten about the rash" out of a table every customer
 * reads is to never consider it in the first place. Shopping staples are short
 * and wordy; personal notes reliably carry digits, punctuation, or length.
 *
 * Rejecting a real product here costs nothing — the caller still gets their
 * emoji in the response. It only means the term is not shared onward.
 */
export function isShareableTerm(term: string): boolean {
  if (term.length < 2 || term.length > 24) return false;
  // Letters, spaces, hyphens and apostrophes only. The term arrives already
  // folded (accents stripped), so a-z covers every language the app ships.
  if (!/^[a-z][a-z '-]*[a-z]$/.test(term)) return false;
  const words = term.split(/\s+/);
  if (words.length > 3) return false;
  return true;
}
