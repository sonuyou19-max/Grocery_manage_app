/**
 * Barcode encoder check.
 *
 * A loyalty card that encodes to the *wrong* number is worse than one that
 * fails to encode: it scans cleanly at the till and charges someone else's
 * account. A digit-pattern or parity-table typo produces exactly that, and it
 * is invisible on screen — the bars look plausible either way. So this asserts
 * against published check-digit vectors and round-trips through decoders
 * written from the spec *separately* from the encoder.
 *
 * The separation matters: the first version of this check shared a
 * copy-pasted Code 128 table with the implementation, so it happily passed
 * 2,500 round-trips while that table had two bogus rows shifting every code
 * value above 82. The reference table below is transcribed independently, with
 * an explicit index per entry, and cross-checked against Code 128's structural
 * invariants.
 *
 * Run with `pnpm --filter mobile check:barcode`. Exits non-zero on any problem.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const BARCODE_TS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'barcode.ts');

// Let the real compiler strip the types. This started as a hand-rolled set of
// regexes and broke the first time a function took a union-typed parameter — a
// check that can't load the module it checks is worse than no check.
const { outputText } = ts.transpileModule(readFileSync(BARCODE_TS, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

// barcode.ts asserts its Code 128 table at module load under __DEV__, so
// loading the module here also exercises that guard.
globalThis.__DEV__ = true;
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
);

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

/* ---------------------------------------------------------- check digits */

// Real-world barcodes: check digit is the published last digit.
const known = [
  ['400638133393', 1], // Nutella 400g
  ['590123412345', 7], // GS1 spec example
  ['978014300723', 4], // ISBN-13
  ['501234567890', 0],
  ['9638507', 4], // EAN-8 payload: 96385074 is the GS1 worked example
];
for (const [payload, expected] of known) {
  check(`eanCheckDigit(${payload})`, mod.eanCheckDigit(payload), expected);
}
check('hasValidEanCheck(4006381333931)', mod.hasValidEanCheck('4006381333931'), true);
check('hasValidEanCheck(4006381333930)', mod.hasValidEanCheck('4006381333930'), false);

/* ---------------------------------------------- structural module counts */

const bitsOf = (bars) => {
  // Rebuild the 0/1 string from alternating runs starting white.
  let out = '';
  bars.forEach((n, i) => {
    out += (i % 2 === 0 ? '0' : '1').repeat(n);
  });
  return out;
};

const ean13 = mod.encodeBarcode('ean13', '4006381333931');
check('ean13 total width = sum(bars)', ean13.width, ean13.bars.reduce((a, b) => a + b, 0));
check('ean13 core width 95', ean13.width - 11 - 7, 95);
const ean8 = mod.encodeBarcode('ean8', '96385074');
check('ean8 core width 67', ean8.width - 7 - 7, 67);

/* ------------------------------------- independent EAN-13 decoder round-trip */

// Written from the spec separately from the encoder: split the 95-module core
// into guards and 7-module digit cells, look each cell up in L/G/R, and recover
// the leading digit from the left half's L/G parity signature.
const L = [
  '0001101','0011001','0010011','0111101','0100011',
  '0110001','0101111','0111011','0110111','0001011',
];
const G = [
  '0100111','0110011','0011011','0100001','0011101',
  '0111001','0000101','0010001','0001001','0010111',
];
const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const PARITY = [
  'LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG',
  'LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL',
];

function decodeEan13(bars) {
  const bits = bitsOf(bars);
  // Find the core: first '1' begins the start guard.
  const start = bits.indexOf('1');
  const core = bits.slice(start, start + 95);
  if (core.slice(0, 3) !== '101') return 'bad start guard';
  if (core.slice(45, 50) !== '01010') return 'bad centre guard';
  if (core.slice(92, 95) !== '101') return 'bad end guard';

  let signature = '';
  const left = [];
  for (let i = 0; i < 6; i += 1) {
    const cell = core.slice(3 + i * 7, 10 + i * 7);
    const li = L.indexOf(cell);
    const gi = G.indexOf(cell);
    if (li >= 0) { signature += 'L'; left.push(li); }
    else if (gi >= 0) { signature += 'G'; left.push(gi); }
    else return `unknown left cell ${i}: ${cell}`;
  }
  const first = PARITY.indexOf(signature);
  if (first < 0) return `unknown parity signature ${signature}`;

  const right = [];
  for (let i = 0; i < 6; i += 1) {
    const cell = core.slice(50 + i * 7, 57 + i * 7);
    const ri = R.indexOf(cell);
    if (ri < 0) return `unknown right cell ${i}: ${cell}`;
    right.push(ri);
  }
  return `${first}${left.join('')}${right.join('')}`;
}

// Round-trip every valid EAN-13 whose first digit exercises each parity row,
// plus a spread of payloads.
let roundTripFails = 0;
for (let firstDigit = 0; firstDigit <= 9; firstDigit += 1) {
  for (let n = 0; n < 200; n += 1) {
    let payload = String(firstDigit);
    for (let k = 0; k < 11; k += 1) {
      payload += String(Math.floor(Math.random() * 10));
    }
    const full = payload + mod.eanCheckDigit(payload);
    const decoded = decodeEan13(mod.encodeBarcode('ean13', full).bars);
    if (decoded !== full) {
      roundTripFails += 1;
      if (roundTripFails <= 3) console.log(`  round-trip ${full} -> ${decoded}`);
    }
  }
}
check('ean13 round-trip 2000 codes', roundTripFails, 0);

// UPC-A must decode as EAN-13 with a leading zero.
const upc = mod.encodeBarcode('upca', '036000291452');
check('upca decodes as 0 + payload', decodeEan13(upc.bars), '0036000291452');

/* ----------------------------------- independent EAN-8 decoder round-trip */

function decodeEan8(bars) {
  const bits = bitsOf(bars);
  const start = bits.indexOf('1');
  const core = bits.slice(start, start + 67);
  if (core.slice(0, 3) !== '101') return 'bad start guard';
  if (core.slice(31, 36) !== '01010') return 'bad centre guard';
  if (core.slice(64, 67) !== '101') return 'bad end guard';
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    const idx = L.indexOf(core.slice(3 + i * 7, 10 + i * 7));
    if (idx < 0) return `unknown left cell ${i}`;
    out += idx;
  }
  for (let i = 0; i < 4; i += 1) {
    const idx = R.indexOf(core.slice(36 + i * 7, 43 + i * 7));
    if (idx < 0) return `unknown right cell ${i}`;
    out += idx;
  }
  return out;
}
let ean8Fails = 0;
for (let n = 0; n < 500; n += 1) {
  let payload = '';
  for (let k = 0; k < 7; k += 1) payload += String(Math.floor(Math.random() * 10));
  const full = payload + mod.eanCheckDigit(payload);
  const decoded = decodeEan8(mod.encodeBarcode('ean8', full).bars);
  if (decoded !== full) {
    ean8Fails += 1;
    if (ean8Fails <= 3) console.log(`  ean8 round-trip ${full} -> ${decoded}`);
  }
}
check('ean8 round-trip 500 codes', ean8Fails, 0);

/* -------------------------------- independent Code 128 decoder round-trip */

/**
 * Reference Code 128 table, transcribed independently of the one in
 * barcode.ts and in a deliberately different layout — every entry carries its
 * own code value, so an inserted or dropped row cannot silently shift the rest
 * (which is exactly the bug the first version of this script missed by
 * copy-pasting the implementation's table).
 */
const REFERENCE_128 = {
  0: '212222', 1: '222122', 2: '222221', 3: '121223', 4: '121322',
  5: '131222', 6: '122213', 7: '122312', 8: '132212', 9: '221213',
  10: '221312', 11: '231212', 12: '112232', 13: '122132', 14: '122231',
  15: '113222', 16: '123122', 17: '123221', 18: '223211', 19: '221132',
  20: '221231', 21: '213212', 22: '223112', 23: '312131', 24: '311222',
  25: '321122', 26: '321221', 27: '312212', 28: '322112', 29: '322211',
  30: '212123', 31: '212321', 32: '232121', 33: '111323', 34: '131123',
  35: '131321', 36: '112313', 37: '132113', 38: '132311', 39: '211313',
  40: '231113', 41: '231311', 42: '112133', 43: '112331', 44: '132131',
  45: '113123', 46: '113321', 47: '133121', 48: '313121', 49: '211331',
  50: '231131', 51: '213113', 52: '213311', 53: '213131', 54: '311123',
  55: '311321', 56: '331121', 57: '312113', 58: '312311', 59: '332111',
  60: '314111', 61: '221411', 62: '431111', 63: '111224', 64: '111422',
  65: '121124', 66: '121421', 67: '141122', 68: '141221', 69: '112214',
  70: '112412', 71: '122114', 72: '122411', 73: '142112', 74: '142211',
  75: '241211', 76: '221114', 77: '413111', 78: '241112', 79: '134111',
  80: '111242', 81: '121142', 82: '121241', 83: '114212', 84: '124112',
  85: '124211', 86: '411212', 87: '421112', 88: '421211', 89: '212141',
  90: '214121', 91: '412121', 92: '111143', 93: '111341', 94: '131141',
  95: '114113', 96: '114311', 97: '411113', 98: '411311', 99: '113141',
  100: '114131', 101: '311141', 102: '411131', 103: '211412', 104: '211214',
  105: '211232', 106: '2331112',
};
const PATTERNS = Object.keys(REFERENCE_128)
  .map(Number)
  .sort((a, b) => a - b)
  .map((k) => REFERENCE_128[k]);

// Extract the implementation's own table and compare entry by entry.
const implTable = [
  ...readFileSync(BARCODE_TS, 'utf8')
    .match(/const CODE128_PATTERNS = \[([\s\S]*?)\];/)[1]
    .matchAll(/'(\d+)'/g),
].map((m) => m[1]);
check('code128 table length', implTable.length, 107);
const mismatch = implTable.findIndex((p, i) => p !== PATTERNS[i]);
check('code128 table matches reference', mismatch, -1);
if (mismatch >= 0) {
  console.log(`  first mismatch at ${mismatch}: impl ${implTable[mismatch]} vs ref ${PATTERNS[mismatch]}`);
}

// Structural invariants from the standard, which hold independently of any
// transcription: 11 modules (13 for stop), widths 1-4, all patterns distinct,
// and Code 128's self-checking property that the three bars always sum even.
check(
  'code128 all 11 modules (13 for stop)',
  implTable.every((p, i) => [...p].reduce((a, c) => a + Number(c), 0) === (i === 106 ? 13 : 11)),
  true,
);
check('code128 widths within 1-4', implTable.every((p) => /^[1-4]+$/.test(p)), true);
check('code128 patterns distinct', new Set(implTable).size, 107);
check(
  'code128 bar widths sum even (self-checking)',
  implTable.every((p) => {
    let sum = 0;
    for (let i = 0; i < p.length; i += 2) sum += Number(p[i]);
    return sum % 2 === 0;
  }),
  true,
);

function decodeCode128(bars) {
  // Drop the leading quiet zone (first white run) and trailing quiet zone.
  const widths = bars.slice(1, -1);
  const symbols = [];
  for (let i = 0; i < widths.length; ) {
    const take = widths.length - i === 7 ? 7 : 6;
    symbols.push(widths.slice(i, i + take).join(''));
    i += take;
  }
  const codes = symbols.map((s) => PATTERNS.indexOf(s));
  if (codes.some((c) => c < 0)) return `unknown symbol ${symbols[codes.indexOf(-1)]}`;
  if (codes[0] !== 104) return `expected START B, got ${codes[0]}`;
  if (codes[codes.length - 1] !== 106) return 'missing stop';
  const check = codes[codes.length - 2];
  const data = codes.slice(1, -2);
  let sum = 104;
  data.forEach((c, i) => { sum += c * (i + 1); });
  if (sum % 103 !== check) return `checksum ${sum % 103} != ${check}`;
  return data.map((c) => String.fromCharCode(c + 32)).join('');
}

const code128Cases = ['12345670', 'ABC-1234', '9900123456789', 'A1B2C3', 'HELLO', '7'];
for (const value of code128Cases) {
  const clean = mod.normalizeCardValue(value);
  check(`code128 round-trip ${value}`, decodeCode128(mod.encodeBarcode('code128', value).bars), clean);
}

/* ------------------------------------------------- ITF-14 structure + decode */

function decodeItf(bars) {
  // bars: [quiet, n,n,n,n, (5 bar/space pairs per digit pair)…, w,n,n, quiet]
  const body = bars.slice(5, -4);
  if (body.length % 10 !== 0) return `body length ${body.length}`;
  const P = [
    'nnwwn','wnnnw','nwnnw','wwnnn','nnwnw',
    'wnwnn','nwwnn','nnnww','wnnwn','nwnwn',
  ];
  let out = '';
  for (let i = 0; i < body.length; i += 10) {
    let barPat = '';
    let spacePat = '';
    for (let k = 0; k < 5; k += 1) {
      barPat += body[i + k * 2] === 3 ? 'w' : 'n';
      spacePat += body[i + k * 2 + 1] === 3 ? 'w' : 'n';
    }
    const a = P.indexOf(barPat);
    const b = P.indexOf(spacePat);
    if (a < 0 || b < 0) return `unknown pair at ${i}`;
    out += `${a}${b}`;
  }
  return out;
}
check('itf14 round-trip', decodeItf(mod.encodeBarcode('itf14', '15400141288763').bars), '15400141288763');
check('itf odd length rejected', mod.encodeBarcode('itf14', '1234567'), null);

/* ------------------------------------------------------- guess + formatting */

check('guess 4006381333931 -> ean13', mod.guessSymbology('4006381333931'), 'ean13');
check('guess bad check 13-digit -> code128', mod.guessSymbology('4006381333930'), 'code128');
check('guess 036000291452 -> upca', mod.guessSymbology('036000291452'), 'upca');
check('guess 96385074 -> ean8', mod.guessSymbology('96385074'), 'ean8');
check('guess 14-digit -> itf14', mod.guessSymbology('15400141288763'), 'itf14');
check('guess alnum -> code128', mod.guessSymbology('AB-1234'), 'code128');
check('guess spaced input', mod.guessSymbology('4006 3813 33931'), 'ean13');

check('format ean13', mod.formatCardValue('ean13', '4006381333931'), '4 006381 333931');
check('format upca', mod.formatCardValue('upca', '036000291452'), '0 36000 29145 2');
check('format ean8', mod.formatCardValue('ean8', '96385074'), '9638 5074');
check('format code128 long digits', mod.formatCardValue('code128', '9900123456789'), '9900 1234 5678 9');
check('format short', mod.formatCardValue('code128', 'ABC123'), 'ABC123');

check('canEncode qr anything', mod.canEncode('qr', 'https://example.com/x'), true);
check('canEncode empty false', mod.canEncode('code128', '  '), false);
check('encodeBarcode qr null', mod.encodeBarcode('qr', 'x'), null);

/* -------------------------------------------------- normalization guarantees */

// Case must survive. Code 128 Code B is case-sensitive, so upper-casing a card
// number would encode a different value — a barcode that scans cleanly as the
// wrong account. This is the check that stops that regressing.
check('case preserved', mod.normalizeCardValue('abc123x'), 'abc123x');
check('mixed case preserved', mod.normalizeCardValue('Ab-9x Yz'), 'Ab-9xYz');
check(
  'code128 round-trips lowercase',
  decodeCode128(mod.encodeBarcode('code128', 'abc123').bars),
  'abc123',
);
// Spaces always go; dashes only when the remainder is purely numeric.
check('spaces stripped', mod.normalizeCardValue('4006 3813 33931'), '4006381333931');
check('numeric dashes stripped', mod.normalizeCardValue('1234-5678-9012'), '123456789012');
check('alnum dashes kept', mod.normalizeCardValue('AB-1234'), 'AB-1234');
check(
  'code128 round-trips a kept dash',
  decodeCode128(mod.encodeBarcode('code128', 'AB-1234').bars),
  'AB-1234',
);

// QR payloads are stored and displayed byte-for-byte: a URL or mixed-case
// token is destroyed by space/dash/case rules that suit a printed number.
const qrUrl = 'https://loyalty.example.com/a-Bc_123';
check('qr value untouched', mod.normalizeForSymbology('qr', qrUrl), qrUrl);
check('qr format untouched', mod.formatCardValue('qr', qrUrl), qrUrl);
check('qr trims surrounding space', mod.normalizeScannedValue(`  ${qrUrl}\n`), qrUrl);
check(
  'linear value still cleaned',
  mod.normalizeForSymbology('ean13', '4006 3813 33931'),
  '4006381333931',
);

// A scanner's reported format decides how we draw it, degrading when the
// payload doesn't fit the claim.
check('scanner ean13', mod.symbologyFromScanner('ean13', '4006381333931'), 'ean13');
check('scanner upc_a -> upca', mod.symbologyFromScanner('upc_a', '036000291452'), 'upca');
check('scanner code39 -> code128', mod.symbologyFromScanner('code39', 'ABC123'), 'code128');
check('scanner datamatrix -> qr', mod.symbologyFromScanner('datamatrix', 'x'), 'qr');
// itf14 claimed but odd length: must degrade rather than render nothing.
check('scanner odd itf degrades', mod.symbologyFromScanner('itf14', '1234567'), 'code128');
check('scanner ean13 wrong length degrades', mod.symbologyFromScanner('ean13', '12345'), 'code128');

/* ------------------------------------------------ the user-chosen 1D/2D format */

// The bug this guards: guessSymbology has no path that returns 'qr', so a
// manually-typed card number always came out as a barcode. Chains differ —
// Colruyt issues QR, Delhaize a barcode — and nothing in the digits says which,
// so the format has to be selectable and must round-trip.
check('guessSymbology alone never yields qr', mod.guessSymbology('4006381333931') === 'qr', false);
check('choosing qr yields qr', mod.symbologyForFormat('qr', '4006381333931'), 'qr');
check(
  'choosing barcode picks the best linear symbology',
  mod.symbologyForFormat('barcode', '4006381333931'),
  'ean13',
);
check('choosing barcode falls back to code128', mod.symbologyForFormat('barcode', 'AB-1234'), 'code128');

// formatOf must classify every symbology the encoder supports, so the toggle
// always shows a defined state rather than defaulting to the wrong side.
for (const sym of ['ean13', 'ean8', 'upca', 'code128', 'itf14']) {
  check(`formatOf(${sym}) is barcode`, mod.formatOf(sym), 'barcode');
}
check('formatOf(qr) is qr', mod.formatOf('qr'), 'qr');

// Round-trip: toggling to QR and back must land on the same symbology, or a
// user experimenting at the till would silently degrade their card.
const original = 'ean13';
const value = '4006381333931';
const toQr = mod.symbologyForFormat('qr', value);
const back = mod.symbologyForFormat(mod.formatOf(original), value);
check('barcode -> qr -> barcode round-trips', [toQr, back], ['qr', 'ean13']);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
