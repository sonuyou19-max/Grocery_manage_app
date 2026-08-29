import type { DecimalMark } from '@/i18n/regions';

/** Format integer cents as a euro string, e.g. 229 -> "€2.29". */
export function euros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * A typed number, in one convention, as a plain machine-readable string.
 *
 * ---------------------------------------------------------------------------
 * Two marks, three situations
 * ---------------------------------------------------------------------------
 *
 * Given which mark this shopper's country uses for the decimal point, the other
 * one is the grouping mark — and grouping has a shape: exactly three digits
 * follow it. That shape is what lets the ambiguous cases be decided rather than
 * guessed:
 *
 *   BOTH MARKS PRESENT. "1.234,56" in Belgium, "1,234.56" in Britain. The
 *   grouping goes, the decimal stays. Unambiguous.
 *
 *   ONLY THE GROUPING MARK, three digits after it. "1,234" in Britain is one
 *   thousand two hundred and thirty four. Unambiguous.
 *
 *   ONLY THE GROUPING MARK, NOT three digits after it. "1,5" in Britain is not
 *   a number in British notation at all — it is somebody typing the mark their
 *   other keyboard uses. Read as a decimal, which is what they meant. The old
 *   parser stripped it instead and turned "1,5" into fifteen.
 *
 * Anything else — two decimal marks, a group of the wrong length — is refused.
 * Returning null is what the callers already do with nonsense, and refusing is
 * the whole lesson of the bug this replaces: the previous version reached an
 * answer for every input and was silently wrong for a whole class of them.
 */
export function normaliseNumber(input: string, decimal: DecimalMark): string | null {
  const group = decimal === ',' ? '.' : ',';
  const bare = input.replace(/[\s\u00A0\u202F]/g, '');
  if (!bare) return null;

  const decimals = bare.split(decimal).length - 1;
  const groups = bare.split(group).length - 1;
  /*
   * No early exit on a second decimal mark. There was one, and mutation testing
   * could not make it matter: the final pass refuses anything left holding two
   * points, so the check was unreachable in effect. A rule no test can
   * distinguish is a rule nobody is maintaining.
   */

  let body = bare;
  if (groups > 0) {
    // Every grouping mark must be followed by exactly three digits.
    const wellGrouped = bare
      .split(group)
      .slice(1)
      .every((part) => /^\d{3}(?:$|[^\d])/.test(part));

    if (wellGrouped) {
      body = bare.split(group).join('');
    } else if (groups === 1 && decimals === 0) {
      // The wrong mark, once, with no decimal to conflict with: they meant the
      // point. This is the "1,5 in Britain" case.
      body = bare.split(group).join(decimal);
    } else {
      return null;
    }
  }

  const cleaned = body.split(decimal).join('.').replace(/[^0-9.]/g, '');
  if (!cleaned || (cleaned.match(/\./g) ?? []).length > 1) return null;
  return cleaned;
}

/**
 * Parse a user-typed price into integer cents, or null.
 *
 * `decimal` says which mark this shopper's convention uses for the point — see
 * Region.decimal. "2,49" and "2.49" are both two forty-nine, in different
 * countries, and only the caller knows which one is being read. It is required
 * rather than defaulted on purpose: a default is a silent guess about somebody
 * else's money, and the compiler naming every caller is worth the noise.
 */
export function parsePriceToCents(input: string, decimal: DecimalMark): number | null {
  const cleaned = normaliseNumber(input, decimal);
  if (cleaned == null) return null;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}
