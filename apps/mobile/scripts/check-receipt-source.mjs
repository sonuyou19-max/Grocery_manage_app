#!/usr/bin/env node
/**
 * Three ways a receipt gets here, and the two that are not the camera.
 *
 * ---------------------------------------------------------------------------
 * Why there are three
 * ---------------------------------------------------------------------------
 *
 * The camera was the whole feature and it assumed a till printed something.
 * Colruyt, Carrefour and Aldi will all email a PDF instead, and a shopper who
 * chose paperless has a receipt no camera can help with — photographing a phone
 * screen is a moiré pattern with prices in it.
 *
 * ---------------------------------------------------------------------------
 * What is worth asserting, and what is not
 * ---------------------------------------------------------------------------
 *
 * Not that the sheet has three rows. That is a fact about a list literal, and
 * it would fail on a redesign that is perfectly correct.
 *
 * What matters is the handful of things that are SILENT when wrong:
 *
 *   THE CAMERA IS NOT ASKED FOR unless it is the source. On iOS a refused
 *   permission is permanent — one needless prompt in front of the gallery
 *   picker costs that person the camera path for good, and nothing about the
 *   screen would look broken.
 *
 *   THE PICKER FIRES ONCE. A second launch stacks a second picker on iOS, and
 *   the effect that opens it re-runs whenever its dependencies settle.
 *
 *   CANCELLING LEAVES. There is nothing behind an OS picker to come back to;
 *   a screen that stays is a blank one with no controls on it.
 *
 *   THE THREE PICK OUTCOMES STAY DISTINGUISHABLE. Cancelled, too large, and
 *   picked mean three different things to the caller, and collapsing "too
 *   large" into "cancelled" turns a refusal the user needs to hear into a
 *   silent bounce back to the list.
 *
 *   ONE SHAPE OR THE OTHER, server-side. Images and a document together is a
 *   caller that does not know what it has, and picking whichever was checked
 *   first would make that a silent decision.
 *
 * Run with `pnpm --filter mobile check:receipt-source`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const FUNCTIONS = join(HERE, '..', '..', '..', 'supabase', 'functions');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, lines = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of lines) console.log(`  ${line}`);
};
const assert = (what, cond, lines) => (cond ? ok(what) : fail(what, lines));

// Stripped, once. Every file here explains this feature at length and quotes
// the shapes being asserted — an assertion satisfied by the prose about a rule
// is this repo's most repeated guard bug.
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...parts) => code(readFileSync(join(...parts), 'utf8'));

const source = read(SRC, 'lib', 'receipt-source.ts');
const capture = read(SRC, 'app', 'receipt', 'capture.tsx');
const sheet = read(SRC, 'components', 'receipt-source-sheet.tsx');
const fn = read(FUNCTIONS, 'receipt-scan', 'index.ts');

/* ================================================= 1. the three sources == */

assert(
  'the three sources are named in one place',
  /'camera', 'photos', 'file'/.test(source) && /RECEIPT_SOURCES/.test(source),
);
/*
 * A route param is a string from anywhere — a deep link, a restored navigation
 * state, a typo. Narrowed rather than cast, so an unknown value falls back to
 * the camera instead of reaching a switch that has no branch for it.
 */
assert(
  'a source arriving as a route param is validated, not cast',
  /isReceiptSource\(sourceParam\) \? sourceParam : 'camera'/.test(capture),
  ['A cast would let `?source=nonsense` through to a screen with no branch for it.'],
);

/* ============================== 2. the camera is asked for only when used = */

assert(
  'camera permission is requested only for the camera source',
  /if \(fromCamera && !permission\)/.test(capture) &&
    /if \(fromCamera && \(!permission\?\.granted \|\| mountFailed\)\)/.test(capture),
  [
    'On iOS a refusal is permanent. A prompt in front of the gallery picker',
    'costs that person the camera path for good, and nothing looks broken.',
  ],
);
assert(
  '...and the camera itself is not mounted either',
  /\{fromCamera \? \(\s*<CameraView/.test(capture),
  ['Spinning the hardware up behind a picker is a visible delay for nothing.'],
);

/* ==================================== 3. the picker opens exactly once ==== */

assert(
  'the picker is launched from an effect guarded by a ref',
  /const opened = useRef\(false\);/.test(capture) &&
    /if \(fromCamera \|\| opened\.current\) return;\s*opened\.current = true;/.test(capture),
  [
    'State would re-render before the guard took, and the effect re-runs on',
    'every dependency change. Two pickers stack on iOS.',
  ],
);
assert(
  'cancelling the picker leaves the screen',
  (capture.match(/status === 'cancelled'\)\s*\{\s*goBack\(\);/g) ?? []).length === 2,
  ['Both sources. There is nothing behind an OS picker to come back to.'],
);

/* ============================ 4. the three outcomes stay distinguishable = */

/*
 * Asserted as an enumeration of what a picker may answer, not as a ban on
 * returning null — the failure is a REFUSAL becoming silence, and null is only
 * one of the ways to write that.
 */
for (const [name, statuses] of [
  ['pickReceiptPhotos', ['picked', 'cancelled', 'tooLarge']],
  ['pickReceiptDocument', ['picked', 'cancelled', 'tooLarge', 'wrongType', 'unavailable']],
]) {
  const body = source.slice(source.indexOf(`export async function ${name}`));
  const end = body.indexOf('\nexport ', 1);
  const scoped = end > 0 ? body.slice(0, end) : body;
  const missing = statuses.filter((s) => !new RegExp(`status: '${s}'`).test(scoped));
  assert(
    `${name} answers all ${statuses.length} outcomes`,
    missing.length === 0,
    [`never returns: ${missing.join(', ')}`, 'A refusal the caller cannot see is a silent bounce.'],
  );
}
/*
 * ...and CANCELLED is returned only where the OS actually cancelled.
 *
 * The enumeration above is necessary and not sufficient, which mutation testing
 * showed: changing the LAST return of pickReceiptPhotos from `tooLarge` to
 * `cancelled` — the case where photographs were chosen and none of them
 * survived decoding — left an earlier `tooLarge` in the function and passed.
 * A guard that checks a vocabulary exists but not that it is used correctly is
 * a shape this repo has shipped before.
 *
 * Counted, because the count IS the property: one cancel path in the photo
 * picker (the user backed out) and two in the document picker (backed out, or
 * chose nothing). Any other `cancelled` is a refusal wearing a silent bounce.
 */
for (const [name, cancels] of [
  ['pickReceiptPhotos', 1],
  ['pickReceiptDocument', 2],
]) {
  const body = source.slice(source.indexOf(`export async function ${name}`));
  const end = body.indexOf('\nexport ', 1);
  const scoped = end > 0 ? body.slice(0, end) : body;
  const found = (scoped.match(/status: 'cancelled'/g) ?? []).length;
  assert(
    `${name} reports cancelled only where the picker cancelled`,
    found === cancels,
    [
      `found ${found} cancel paths, expected ${cancels}`,
      'An extra one is a refusal the shopper never hears about.',
    ],
  );
}

/* ------------------ the PDF path degrades, it does not take the app down -- */

/*
 * expo-document-picker and expo-file-system are NATIVE, and they arrived with
 * this feature. The app ships JavaScript over the air, so there is a window —
 * every skipped build — where a new bundle runs on a binary that has neither.
 * The existing Android APK is exactly that binary.
 *
 * A static import there does not degrade: it throws while the module graph is
 * being evaluated, and this module is on the receipt screen's import chain. The
 * app fails to start, taking every other fix in the same update with it. Same
 * hazard, same shape and same reasoning as lib/push's notifications().
 *
 * `await import()` is NOT the fix and was what this shipped as: a dynamic
 * import is still a static edge to Metro, so it buys nothing at runtime and
 * cannot be caught.
 */
assert(
  'the native pickers are required lazily, not imported at module scope',
  !/^import .*from 'expo-document-picker'/m.test(source) &&
    !/^import .*from 'expo-file-system'/m.test(source) &&
    /require\('expo-document-picker'\)/.test(source) &&
    /require\('expo-file-system'\)/.test(source),
  ['A top-level import throws on any binary built before this feature existed.'],
);
assert(
  '...inside a try that answers null',
  /try \{[\s\S]{0,400}?require\('expo-document-picker'\)[\s\S]{0,400}?\} catch \{\s*native = null;/.test(source),
);
assert(
  '...and a missing module is a REFUSAL, not a crash or a silence',
  /if \(!mod\) return \{ status: 'unavailable' \};/.test(source) &&
    /receipt\.pdfNeedsUpdate/.test(capture),
  ['Told their file was too large, they would go off to shrink the wrong thing.'],
);
assert(
  'no dynamic import stands in for the lazy require',
  !/await import\('expo-/.test(source),
  ['Metro resolves it statically all the same — it is a bundling edge, not a guard.'],
);

assert(
  'a too-large pick is said out loud rather than swallowed',
  /showToast\(t\('receipt\.photoTooLarge'\)\)/.test(capture) &&
    /receipt\.pdfTooLarge/.test(capture) &&
    /receipt\.notAPdf/.test(capture),
);
/*
 * And the PDF's type is checked after the picker, not only by it. `type:` is a
 * hint on Android and a provider may hand back anything; without this the
 * scanner spends a vision call finding out.
 */
assert(
  'the picked file is re-checked as a PDF',
  /asset\.mimeType === PDF_MEDIA \|\| named\.toLowerCase\(\)\.endsWith\('\.pdf'\)/.test(source),
);

/* ======================================= 5. the sheet only chooses a door = */

/*
 * It navigates and nothing else. A picker launched from the sheet would need
 * its own progress overlay, its own failure message and its own hand-off to the
 * review sheet — three things that already exist once, and would then exist
 * twice with nothing keeping them in step.
 */
assert(
  'the chooser picks a source and navigates, nothing more',
  !/ImagePicker|DocumentPicker|runScan/.test(sheet),
  ['The intake screen owns the pipeline. Two copies of it would drift.'],
);
assert(
  '...and closes before it navigates',
  /dismiss\(\(\) => onPick\(source\)\)/.test(sheet),
  ['Pushing a route from inside a Modal puts the new screen under it on Android.'],
);

/* ============================== 6. the server takes one shape or the other */

assert(
  'the scanner accepts a PDF as a document block',
  /type: 'document',\s*source: \{ type: 'base64', media_type: 'application\/pdf', data \}/.test(fn),
);
assert(
  '...bounded like the images are',
  /MAX_PDF_CHARS/.test(fn) && /data\.length > MAX_PDF_CHARS/.test(fn),
  ['An unbounded base64 string is the cheapest way to spend somebody else’s budget.'],
);
assert(
  '...and refuses both at once rather than choosing',
  /if \(\(images && document\) \|\| \(!images && !document\)\)/.test(fn),
  ['Answering from whichever was checked first makes that a silent decision.'],
);
/*
 * The prompt has to know which it is looking at. Photograph sections OVERLAP
 * and a line in two of them is one printing; PDF pages RUN ON and a line on two
 * of them is two. Told the wrong rule, the model drops real lines or invents
 * duplicates — and either is a total that does not reconcile for a reason
 * nothing in the log would explain.
 */
assert(
  'the prompt distinguishes overlapping photographs from running pages',
  /PHOTOGRAPHS are sections of ONE receipt/.test(fn) &&
    /A PDF is the shop's own emailed receipt and its pages do NOT overlap/.test(fn),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
