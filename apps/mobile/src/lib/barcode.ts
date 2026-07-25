/**
 * Barcode encoding — turns a loyalty-card number into bar widths we can draw.
 *
 * Why encode rather than keep the photo: a photo of a card (or a screenshot of
 * an app) is at the mercy of glare, focus, crop and screen dimming, and till
 * scanners reject it often enough to be embarrassing at the checkout. Once the
 * number is known we can re-draw the barcode ourselves at full contrast and any
 * size, which scans reliably every time. The number is also shown as text so a
 * cashier can key it in if the scanner still refuses.
 *
 * This module is deliberately pure — no React, no storage, no native calls — so
 * the encoding can be reasoned about and checked on its own.
 *
 * Output is a list of bar widths in *modules* (the width of the narrowest bar),
 * alternating white, black, white, black, … starting with white. The renderer
 * scales modules to pixels, so the same pattern works at any card size.
 */

export type Symbology = 'ean13' | 'ean8' | 'upca' | 'code128' | 'itf14' | 'qr';

/** A decoded card number, ready to be drawn. */
export interface BarcodePayload {
  symbology: Symbology;
  /** Exactly what was scanned, digits or alphanumerics, no separators. */
  value: string;
}

export interface EncodedBarcode {
  /** Alternating white/black run lengths in modules, starting white. */
  bars: number[];
  /** Total width in modules, i.e. the sum of `bars`. */
  width: number;
  /**
   * Where to break the human-readable text, for the classic EAN/UPC layout
   * ("4 006381 333931"). Empty means render `value` as one run.
   */
  textGroups: string[];
}

/* ------------------------------------------------------------------ EAN / UPC */

/**
 * EAN-13 digit patterns. Each digit is 7 modules, encoded in one of three sets:
 * L and G for the left half (which of the two is chosen per position spells out
 * the 13th digit), R for the right half.
 */
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
/** R is the bitwise complement of L. */
const EAN_R = EAN_L.map((p) => p.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')));

/** Which left-half digits use set G, indexed by the first digit. */
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** EAN-8 uses fixed sets: L for the left four, R for the right four. */

/**
 * Mod-10 check digit for EAN/UPC. Weights alternate 3 and 1 from the *right*,
 * which is why the parity depends on the payload length rather than being
 * fixed — getting this backwards is the classic EAN bug.
 */
export function eanCheckDigit(digits: string): number {
  let sum = 0;
  // Walk right-to-left so the rightmost payload digit always gets weight 3.
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit is the correct check digit for the rest. */
export function hasValidEanCheck(digits: string): boolean {
  if (digits.length < 2) return false;
  return eanCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/** Turns a 0/1 module string into alternating run lengths starting with white. */
function runsFromBits(bits: string): number[] {
  const runs: number[] = [];
  // The first run is white by convention, so a pattern that starts with a black
  // module needs a zero-width white run in front of it to keep the phase right.
  let current = '0';
  let count = 0;
  for (const bit of bits) {
    if (bit === current) {
      count += 1;
    } else {
      runs.push(count);
      current = bit;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

function encodeEan13(digits: string): EncodedBarcode {
  const parity = EAN13_PARITY[Number(digits[0])];
  let bits = '00000000000' /* 11-module quiet zone */ + '101' /* start guard */;
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(digits[i + 1]);
    bits += parity[i] === 'L' ? EAN_L[digit] : EAN_G[digit];
  }
  bits += '01010'; // centre guard
  for (let i = 7; i < 13; i += 1) bits += EAN_R[Number(digits[i])];
  bits += '101' /* end guard */ + '0000000'; // 7-module quiet zone
  return {
    bars: runsFromBits(bits),
    width: bits.length,
    textGroups: [digits.slice(0, 1), digits.slice(1, 7), digits.slice(7)],
  };
}

function encodeEan8(digits: string): EncodedBarcode {
  let bits = '0000000' + '101';
  for (let i = 0; i < 4; i += 1) bits += EAN_L[Number(digits[i])];
  bits += '01010';
  for (let i = 4; i < 8; i += 1) bits += EAN_R[Number(digits[i])];
  bits += '101' + '0000000';
  return {
    bars: runsFromBits(bits),
    width: bits.length,
    textGroups: [digits.slice(0, 4), digits.slice(4)],
  };
}

/**
 * UPC-A is EAN-13 with a leading zero, so we encode it as such and only differ
 * in how the digits are grouped under the bars.
 */
function encodeUpcA(digits: string): EncodedBarcode {
  const asEan = encodeEan13(`0${digits}`);
  return {
    ...asEan,
    textGroups: [digits.slice(0, 1), digits.slice(1, 6), digits.slice(6, 11), digits.slice(11)],
  };
}

/* --------------------------------------------------------------------- ITF-14 */

/** Interleaved 2 of 5: five bars per digit, two of them wide. */
const ITF_PATTERNS = [
  'nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw',
  'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn',
];

function encodeItf(digits: string): EncodedBarcode {
  const NARROW = 1;
  const WIDE = 3;
  // Quiet zone, then the start pattern (narrow bar/space ×2).
  const bars: number[] = [10, NARROW, NARROW, NARROW, NARROW];
  // Digits are interleaved in pairs: the first digit's widths become the bars,
  // the second's become the spaces between them.
  for (let i = 0; i < digits.length; i += 2) {
    const barWidths = ITF_PATTERNS[Number(digits[i])];
    const spaceWidths = ITF_PATTERNS[Number(digits[i + 1])];
    for (let k = 0; k < 5; k += 1) {
      bars.push(barWidths[k] === 'w' ? WIDE : NARROW);
      bars.push(spaceWidths[k] === 'w' ? WIDE : NARROW);
    }
  }
  bars.push(WIDE, NARROW, NARROW, 10); // stop pattern + quiet zone
  return {
    bars,
    width: bars.reduce((sum, n) => sum + n, 0),
    textGroups: [],
  };
}

/* ------------------------------------------------------------------- Code 128 */

/**
 * Code 128 bar patterns, indexed by code value 0–106. Each is six digits giving
 * the widths of three bars and three spaces (11 modules total), except the stop
 * pattern which is 13.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

// Structural invariant: every Code 128 symbol is 11 modules wide, except the
// stop pattern's 13, and there are exactly 107 code values (0–106). A typo in
// the table above shifts every later code value, which would encode silently
// and scan as the wrong characters — so assert it at module load in dev.
if (__DEV__) {
  const badWidth = CODE128_PATTERNS.findIndex(
    (p, i) => [...p].reduce((sum, c) => sum + Number(c), 0) !== (i === CODE128_STOP ? 13 : 11),
  );
  if (CODE128_PATTERNS.length !== 107 || badWidth >= 0) {
    throw new Error(
      `CODE128_PATTERNS corrupt: length ${CODE128_PATTERNS.length}, bad width at ${badWidth}`,
    );
  }
}

/**
 * Code B only. Loyalty numbers are digits or plain alphanumerics, and Code B
 * covers all of printable ASCII 32–126, so the density win from switching to
 * Code C for digit runs isn't worth the extra state machine here.
 */
function encodeCode128(value: string): EncodedBarcode {
  const codes: number[] = [CODE128_START_B];
  for (const char of value) codes.push(char.charCodeAt(0) - 32);
  // Checksum: start value plus each code times its 1-based position, mod 103.
  let checksum = CODE128_START_B;
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103, CODE128_STOP);

  const bars: number[] = [10]; // quiet zone
  for (const code of codes) {
    for (const width of CODE128_PATTERNS[code]) bars.push(Number(width));
  }
  bars.push(10);
  return {
    bars,
    width: bars.reduce((sum, n) => sum + n, 0),
    textGroups: [],
  };
}

/* ----------------------------------------------------------------------- entry */

/** Strip anything a user might type or a scanner might include as decoration. */
export function normalizeCardValue(raw: string): string {
  // Spaces are always print formatting, never part of a code.
  const noSpaces = raw.replace(/\s/g, '');
  // Dashes are grouping separators in a numeric card ("1234-5678-9012"), but
  // can be real payload characters in an alphanumeric one — Code 39 and Code
  // 128 both encode '-'. So they only go when what's left is purely digits.
  const noDashes = noSpaces.replace(/-/g, '');
  return /^\d+$/.test(noDashes) ? noDashes : noSpaces;
  // Deliberately NOT upper-cased. Code 128 Code B is case-sensitive, so
  // upper-casing a card number containing lowercase letters would encode a
  // *different* value — a barcode that scans cleanly as the wrong account.
}

/**
 * A value straight from the scanner, stored verbatim apart from surrounding
 * whitespace. The scanner has already decoded the real symbol, so any further
 * "tidying" here can only corrupt it — a QR payload in particular is often a
 * URL or a mixed-case token where every character matters.
 */
export function normalizeScannedValue(raw: string): string {
  return raw.trim();
}

/**
 * Clean a value for the symbology it will be drawn as. QR payloads are kept
 * byte-for-byte; linear codes get the space/dash treatment above.
 */
export function normalizeForSymbology(symbology: Symbology, raw: string): string {
  return symbology === 'qr' ? normalizeScannedValue(raw) : normalizeCardValue(raw);
}

/**
 * Best symbology for a value the user typed by hand. Length plus a valid check
 * digit is a strong signal, so we only claim EAN/UPC when the checksum agrees —
 * otherwise Code 128 will encode the digits faithfully and still scan.
 */
export function guessSymbology(value: string): Symbology {
  const clean = normalizeCardValue(value);
  if (/^\d+$/.test(clean)) {
    if (clean.length === 13 && hasValidEanCheck(clean)) return 'ean13';
    if (clean.length === 8 && hasValidEanCheck(clean)) return 'ean8';
    if (clean.length === 12 && hasValidEanCheck(clean)) return 'upca';
    if (clean.length === 14) return 'itf14';
  }
  return 'code128';
}

/**
 * Map a scanner's reported format onto a symbology we can re-draw.
 *
 * The scanner recognises more formats than we can render, so a few are
 * deliberately substituted. The decoded *string* is always preserved exactly —
 * only the way it's drawn changes, and a till reads the number, not the
 * symbology:
 *
 * - `code39` / `code93` / `codabar` / `upc_e` → **Code 128**, which every
 *   modern POS scanner reads and which encodes the same characters.
 * - `pdf417` / `aztec` / `datamatrix` → **QR**, staying 2D with the same
 *   payload.
 *
 * The add flow shows the re-drawn code next to the number before saving, so a
 * substitution that a particular retailer won't accept is visible up front
 * rather than at the checkout.
 */
export function symbologyFromScanner(scannedType: string, value: string): Symbology {
  const preferred = ((): Symbology => {
    switch (scannedType) {
      case 'ean13':
        return 'ean13';
      case 'ean8':
        return 'ean8';
      case 'upc_a':
        return 'upca';
      case 'itf14':
        return 'itf14';
      case 'qr':
      case 'pdf417':
      case 'aztec':
      case 'datamatrix':
        return 'qr';
      default:
        return 'code128';
    }
  })();

  // Degrade rather than render nothing: a reported type whose payload doesn't
  // actually fit it (an odd-length ITF, say) still has to end up on screen.
  if (canEncode(preferred, value)) return preferred;
  return canEncode('code128', value) ? 'code128' : 'qr';
}

/** True when `value` can be drawn as `symbology`. */
export function canEncode(symbology: Symbology, value: string): boolean {
  const clean = normalizeCardValue(value);
  if (!clean) return false;
  switch (symbology) {
    case 'ean13':
      return /^\d{13}$/.test(clean);
    case 'ean8':
      return /^\d{8}$/.test(clean);
    case 'upca':
      return /^\d{12}$/.test(clean);
    // ITF encodes digits in pairs, so an odd count cannot be represented.
    case 'itf14':
      return /^\d+$/.test(clean) && clean.length % 2 === 0;
    case 'code128':
      // Code B covers printable ASCII only.
      return /^[\x20-\x7E]+$/.test(clean);
    case 'qr':
      return true;
  }
}

/**
 * Encode a card number for drawing, or null when the value doesn't fit the
 * symbology (callers fall back to showing the number as text, which a cashier
 * can key in). QR returns null here — it has its own renderer.
 */
export function encodeBarcode(symbology: Symbology, value: string): EncodedBarcode | null {
  const clean = normalizeCardValue(value);
  if (symbology === 'qr' || !canEncode(symbology, clean)) return null;
  switch (symbology) {
    case 'ean13':
      return encodeEan13(clean);
    case 'ean8':
      return encodeEan8(clean);
    case 'upca':
      return encodeUpcA(clean);
    case 'itf14':
      return encodeItf(clean);
    case 'code128':
      return encodeCode128(clean);
  }
}

/** Human-readable number, grouped the way the symbology conventionally is. */
export function formatCardValue(symbology: Symbology, value: string): string {
  // A QR payload is shown as-is: it's frequently a URL or token, where
  // regrouping into blocks of four would be nonsense and stripping characters
  // would be wrong.
  if (symbology === 'qr') return value.trim();
  const clean = normalizeCardValue(value);
  const encoded = encodeBarcode(symbology, clean);
  if (encoded && encoded.textGroups.length > 0) return encoded.textGroups.join(' ');
  // Everything else gets even groups of four, which is how people read long
  // numbers off a card anyway.
  if (/^\d+$/.test(clean) && clean.length > 8) return clean.replace(/(.{4})/g, '$1 ').trim();
  return clean;
}
