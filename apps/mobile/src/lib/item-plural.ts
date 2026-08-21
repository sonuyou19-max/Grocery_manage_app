import { fold } from '@/lib/item-emoji';

/**
 * "Potato" and "Potatoes" are one thing to buy.
 *
 * ---------------------------------------------------------------------------
 * Why this cannot be normalizeKey
 * ---------------------------------------------------------------------------
 *
 * normalizeKey is not a style choice — it is a transcription of a Postgres
 * generated column, character for character, and check-item-identity asserts
 * that it stays one (including, explicitly, that "Tomaten" stays its own item).
 * Teaching it about plurals would mean either changing the generated column and
 * re-keying every row in every household's list, or letting the client and the
 * database disagree about what an item IS — which is the exact failure mode
 * lib/item-dup exists to prevent.
 *
 * So this is a SECOND, looser question, asked only by the UI and never stored:
 * not "will Postgres reject this insert" but "did the shopper already write
 * this down". It is allowed to be fuzzy precisely because being wrong here
 * costs an insert that does not happen, never one that fails.
 *
 * ---------------------------------------------------------------------------
 * What it handles, and what it does not
 * ---------------------------------------------------------------------------
 *
 * The -s family (English, French, Spanish, and the Dutch words that take -s)
 * and the -en family (German, and the Dutch words that take -en without
 * changing their stem). Between them that is five of the seven locales the app
 * ships in, though Dutch only in part: "tomaat" pluralises to "tomaten", and
 * getting from one to the other means undoing the open/closed-syllable vowel
 * doubling as well as the suffix. That is left alone — a rule that turns "omat"
 * back into "omaat" has to be willing to do it everywhere, and everywhere is
 * where it starts merging unrelated words.
 *
 * Italian and Polish are NOT handled and are not attempted. Italian pluralises
 * by changing the final vowel — pomodoro/pomodori, mela/mele — so the plural
 * marker is a vowel that is also the singular ending of thousands of other
 * words, and any rule that catches pomodori also merges words that have nothing
 * to do with each other. Polish inflects for seven cases on top of number.
 * Neither is a suffix problem, and a bad stemmer here does not fail loudly: it
 * silently refuses to let someone add a real second item to their list. A miss
 * is a duplicate row the shopper can delete; a false merge is the app arguing
 * with them about what they just typed. So the rules below only fire where the
 * plural marker is unambiguous, and everything else is left alone.
 *
 * ---------------------------------------------------------------------------
 * Why fold() and not a bare lowercase
 * ---------------------------------------------------------------------------
 *
 * The same folding the emoji table, the category tables and the lexicon all key
 * on, so "Tomate" and "tomaté" reach these rules identically. normalizeKey
 * deliberately preserves accents because Postgres does; this is not the
 * database's question, and an accent is not a different vegetable.
 */

/**
 * Minimum length before a suffix may be stripped.
 *
 * Short words are where stemming does its damage: "gas" would become "ga",
 * "bus" "bu", and either could then collide with something real. Four
 * characters is the shortest that leaves a stem worth comparing, and it still
 * covers the plurals that actually matter — "eggs" is exactly four.
 */
const MIN_S = 4;

/** The -en rule needs one more, so "oven" and "hen" are left intact. */
const MIN_EN = 5;

function singularizeWord(word: string): string {
  let w = word;

  // -ies → -y. "berries" → "berry", "cherries" → "cherry".
  if (w.length >= MIN_EN && w.endsWith('ies')) {
    w = `${w.slice(0, -3)}y`;
  }
  // -oes → -o. Ahead of the general -es rule because "potatoes" would otherwise
  // fall through to the -s rule and stem to "potatoe", which matches nothing —
  // the plural and the singular would end up on opposite sides of the compare,
  // which is the one outcome worse than not trying.
  else if (w.length >= MIN_EN && w.endsWith('oes')) {
    w = w.slice(0, -2);
  }
  // -es after a sibilant, where the "e" is part of the plural rather than the
  // stem: "dishes" → "dish", "boxes" → "box", "glasses" → "glass".
  else if (w.length >= MIN_EN && w.endsWith('es') && /(?:s|x|z|ch|sh)$/.test(w.slice(0, -2))) {
    w = w.slice(0, -2);
  }
  // Plain -s. Not after "ss" (glass, dress) and not after "us" (hummus,
  // asparagus, couscous) — both are singular endings that the rule would
  // otherwise chew into a stem no singular form produces.
  else if (w.length >= MIN_S && w.endsWith('s') && !/(?:ss|us)$/.test(w)) {
    w = w.slice(0, -1);
  }

  // -en → -e, applied AFTER the -s rules rather than instead of them, and to
  // their output. German and Dutch build plurals this way (Tomate/Tomaten,
  // Banane/Bananen), but the reason it runs second is English: "chickens"
  // stems to "chicken" above, and if that were the final answer it would never
  // meet the singular "chicken", which this rule takes to "chicke". Running
  // both in sequence means every word reaches the same place from either side.
  if (w.length >= MIN_EN && w.endsWith('en')) {
    w = w.slice(0, -1);
  }

  return w;
}

/**
 * The key two names share when they are the same item in different numbers.
 *
 * Word by word, so a qualifier pluralises independently of its head — "spring
 * onions" and "spring onion" agree without the phrase needing to be in any
 * table.
 */
export function singularKey(name: string): string {
  const folded = fold(name);
  if (!folded) return '';
  return folded.split(' ').map(singularizeWord).join(' ');
}

/**
 * Whether two names are the same item up to plural form.
 *
 * Exact equality is not special-cased: two identical names fold and stem
 * identically, so they arrive here true anyway.
 */
export function samePlural(a: string, b: string): boolean {
  const ka = singularKey(a);
  return ka !== '' && ka === singularKey(b);
}
