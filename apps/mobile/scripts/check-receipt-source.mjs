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

/* ============= 3. the picker opens once, after the screen is really there = */

/*
 * A REF, and set before anything can await. Which sources are allowed through
 * the guard is a separate question with its own rule further down — this one is
 * only about the guard being a ref that latches immediately.
 */
assert(
  'the picker is launched from an effect guarded by a ref',
  /const opened = useRef\(false\);/.test(capture) &&
    /if \([^)]*\|\| opened\.current\) return;\s*opened\.current = true;/.test(capture),
  [
    'State would re-render before the guard took, and the effect re-runs on',
    'every dependency change. Two pickers stack on iOS.',
  ],
);
/*
 * AND IT WAITS FOR THE TRANSITION.
 *
 * Straight out of a mount effect this did nothing at all: on iOS an OS picker
 * asked for while the screen is still being presented is a presentation onto a
 * view controller that is not on screen yet, and UIKit declines it silently.
 * BOTH sources failed identically, which is what said it was the timing rather
 * than either picker.
 */
assert(
  'the picker waits for the navigation animation to finish',
  /InteractionManager\.runAfterInteractions\(\(\) => \{\s*void openPicker\(\);/.test(capture),
  ['Presented mid-transition, UIKit declines it and says nothing.'],
);
assert(
  '...and the effect cancels the task it scheduled',
  /return \(\) => task\.cancel\(\);/.test(capture),
  ['A picker opening onto a screen that has been left is worse than none.'],
);
/*
 * The manual button is not a nicety. runAfterInteractions is a promise about
 * scheduling, not a guarantee — so the screen has to have a way forward that
 * does not depend on it, and a way out. Its absence is what turned a picker
 * that did not open into a screen nobody could leave except by the camera's
 * own close button, which was drawing there by accident.
 */
assert(
  'the screen can open the picker by hand as well',
  /onPress=\{\(\) => void openPicker\(\)\}/.test(capture) &&
    /receiptSource\.choose/.test(capture),
  ['If the auto-open ever silently fails again, this is the way through.'],
);
assert(
  'cancelling the picker leaves the screen',
  (capture.match(/status === 'cancelled'\)\s*\{\s*goBack\(\);/g) ?? []).length === 2,
  ['Both sources. There is nothing behind an OS picker to come back to.'],
);

/* ================== 3b. and the camera's chrome stays on the camera ======= */

/*
 * The reported screen. Both non-camera sources fell through to the camera's own
 * overlay — the capture hint, the shutter, the Scan button — over a black
 * screen with no camera behind it. Instructions for photographing a receipt, on
 * a screen whose job was to open a file picker.
 */
assert(
  "the camera's chrome is drawn only for the camera",
  /\{fromCamera && !pending && !scanning && \(/.test(capture),
  ['Otherwise a gallery pick is presented as "photograph the receipt".'],
);
assert(
  '...and the other sources have a body of their own',
  /\{!fromCamera && !pending && !scanning && \(/.test(capture),
);

/* ============================ 4. the three outcomes stay distinguishable = */

/*
 * Asserted as an enumeration of what a picker may answer, not as a ban on
 * returning null — the failure is a REFUSAL becoming silence, and null is only
 * one of the ways to write that.
 */
for (const [name, statuses] of [
  ['pickReceiptPhotos', ['picked', 'cancelled', 'tooLarge', 'denied', 'failed']],
  ['pickReceiptDocument', ['picked', 'cancelled', 'tooLarge', 'wrongType', 'unavailable', 'failed']],
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
/*
 * Stated as a RULE about which packages may be imported at module scope, not as
 * a list of the two that must not be.
 *
 * The list version passed while `expo-image-manipulator` was added as a static
 * import two commits later — the same hazard, the same module-scope
 * `requireNativeModule`, and an assertion that could not see it because it was
 * enumerating names instead of the property.
 *
 * The allowlist is what the OLDEST binary in the field already contains.
 * expo-image-picker shipped in the SDK 54 build, so importing it costs nothing;
 * everything added since has to be reached through a lazy require, or a bundle
 * delivered to that binary throws before the app can start.
 */
const SHIPPED_IN_OLDEST_BINARY = ['expo-image-picker'];
const staticNative = [...source.matchAll(/^import .*from '(expo-[^']+)'/gm)]
  .map((m) => m[1])
  .filter((pkg) => !SHIPPED_IN_OLDEST_BINARY.includes(pkg));

assert(
  'nothing added since the last build is imported at module scope',
  staticNative.length === 0,
  [
    ...staticNative.map((pkg) => `  ${pkg}`),
    '',
    'These call requireNativeModule() as they are evaluated. On a binary that',
    'does not have them, a static import throws before the app can start —',
    'taking every other fix in the same update with it. Reach them through a',
    'lazy require in a try, the way documentPicker() and imageManipulator() do.',
  ],
);
assert(
  '...and each is reached through a lazy require instead',
  /require\('expo-document-picker'\)/.test(source) &&
    /require\('expo-file-system'\)/.test(source) &&
    /require\('expo-image-manipulator'\)/.test(source),
  ['The absence of a static import is not the same as the feature being there.'],
);
assert(
  '...answering null rather than throwing when it is missing',
  /manipulator = null;/.test(source) && /if \(!mod\) return null;/.test(source),
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

/* ================== 4b. a library photo is fitted, never refused ========== */

/*
 * THE REPORTED BUG, and it was a design mistake rather than a slip.
 *
 * A gallery photograph is a 12-megapixel HEIC somebody did not choose the
 * settings for and cannot change. Refusing it as "too large to send" asks them
 * to solve a problem that is not theirs with a tool they do not have — and the
 * camera path never had it, because pickPictureSize bounds the capture before
 * it happens. The gallery has no equivalent, so the bound has to be applied
 * after the fact.
 *
 * Downscaling costs the model nothing: Anthropic resizes anything over 1568px
 * on its long edge before reading it, so every pixel above TARGET_LONG_EDGE is
 * bytes uploaded to be discarded at the far end.
 */
assert(
  'a library photo is resized rather than rejected',
  /manipulateAsync\(/.test(source) && /resize: \{ width: TARGET_LONG_EDGE \}/.test(source),
  ['Refusing a photograph for a size the shopper cannot change is not a refusal they can act on.'],
);
assert(
  '...to the same long edge the camera aims for',
  /TARGET_LONG_EDGE/.test(source),
  ['A second number here would be a second answer to "how big is big enough".'],
);
assert(
  '...trying the fallback quality before giving up',
  /\[CAPTURE_QUALITY, FALLBACK_QUALITY\]/.test(source),
  ['One pass at 0.85 can still overshoot on an enormous original.'],
);
/*
 * And the picker is NOT asked for base64. Doing so loads the full original into
 * JavaScript as a string — tens of megabytes, four times over — only for the
 * resize to discard all of it a moment later.
 */
assert(
  'the original is never pulled into JS as base64',
  !/allowsMultipleSelection: true,[\s\S]{0,200}?base64: true/.test(source),
  ['The manipulator reads from the uri and returns base64 of the SHRUNK image.'],
);

/* ============== 4c. and a photo that IS picked has somewhere to go ======== */

/*
 * "I selected a photo but it didn't come through."
 *
 * The pick succeeded, `shots` filled, and the screen went on rendering "Choose
 * a photo" with a Choose button — no thumbnails, no way to scan, no sign
 * anything had happened. The photographs were in memory the whole time with
 * nothing on screen able to reach them, because the non-camera body only ever
 * knew how to ask again.
 */
assert(
  'the non-camera body has a state for photos already chosen',
  /shots\.length === 0 \? \(/.test(capture),
  ['Without it a successful pick looks identical to no pick at all.'],
);
assert(
  '...that can send them',
  /<PrimaryButton label=\{t\('receipt\.scan'\)\} onPress=\{\(\) => scan\(\)\} \/>/.test(capture),
  ['A screen holding four photographs and no way to scan them is the bug.'],
);
assert(
  '...and can drop one and choose again',
  /removeShot\(i\)/.test(capture) && /receiptSource\.chooseAgain/.test(capture),
);

assert(
  'a too-large pick is said out loud rather than swallowed',
  /receipt\.photoTooLarge/.test(capture) &&
    /receipt\.pdfTooLarge/.test(capture) &&
    /receipt\.notAPdf/.test(capture),
);
/*
 * A THROW IS AN ANSWER TOO, and it was the missing one.
 *
 * Both picker calls sat in an unawaited async IIFE with no catch, so a
 * rejection went nowhere: the screen had not opened anything and could not say
 * why. Every await that reaches a native module is wrapped now, and `failed`
 * is its own outcome rather than a silence.
 */
/*
 * Counted across both spellings. One of the three catches now decides between
 * `busy` and `failed` — a refusal that cannot be retried told apart from one
 * that can — so a literal count of `status: 'failed'` reads that catch as
 * missing. What the rule is about is that all three native calls END IN A NAMED
 * OUTCOME, not which name.
 */
assert(
  'a picker that throws is caught rather than left to reject into nothing',
  (source.match(/return \{ status: 'failed' \};/g) ?? []).length +
    (source.match(/'busy' : 'failed'/g) ?? []).length >=
    3,
  ['launchImageLibraryAsync, getDocumentAsync and the file read all throw.'],
);
assert(
  '...and the refusal reaches the screen',
  /receipt\.pickerFailed/.test(capture) && /receipt\.photosDenied/.test(capture),
);
/*
 * The library permission is asked for BEFORE the picker rather than left to it.
 * On Android launchImageLibraryAsync throws without it, which from the screen
 * is indistinguishable from a picker that never opened.
 */
assert(
  'the photo library is asked for, not assumed',
  /requestMediaLibraryPermissionsAsync\(\)/.test(source) &&
    /if \(!perm\.granted\) return \{ status: 'denied' \};/.test(source),
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

/* -------------------------------------------------------------------------- */
/* The document picker is never opened from an effect                          */
/* -------------------------------------------------------------------------- */

/*
 * "I clicked Choose but it isn't opening anything, and then I got a message
 * that it did not work."
 *
 * Read DocumentPickerModule.swift. getDocumentAsync throws immediately when the
 * module's `pickingContext` is non-nil, and that context is cleared in exactly
 * two places — the two delegate callbacks. A picker presented while the screen
 * is still being presented is declined by UIKit without its delegate ever
 * firing, so the context stays set for the LIFE OF THE PROCESS and every later
 * call throws PickingInProgressException. One badly timed automatic call
 * disables the feature until the app is restarted, which is why pressing the
 * button afterwards did nothing either.
 *
 * expo-image-picker overwrites its context instead of refusing, which is why
 * the photo path survives the same timing and is deliberately left alone.
 *
 * The rule is therefore about WHICH SOURCE may be opened automatically, and it
 * is asserted on the effect's own guard rather than on a comment about it.
 */
{
  const capture = read(SRC, 'app', 'receipt', 'capture.tsx');
  const effect = /const opened = useRef\(false\);\s*useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(capture);
  const body = effect?.[1] ?? '';

  assert('the auto-open effect is still where this rule can see it', body.length > 0, [
    'The `const opened = useRef(false)` effect in capture.tsx has moved or been rewritten.',
  ]);
  assert("only the photo source opens its picker automatically", /source !== 'photos'/.test(body), [
    "The effect must bail unless source === 'photos'.",
    'Opening the DOCUMENT picker from an effect can wedge it until the app is',
    'restarted — see the note above, and DocumentPickerModule.swift.',
  ]);
  assert(
    '...not merely "anything that is not the camera"',
    !/fromCamera \|\| opened\.current/.test(body),
    ['That older guard let the file source through, which is the bug this rule is about.'],
  );
}

/*
 * And the wedged state is told apart from an ordinary failure, because the
 * advice differs: nothing in JS can clear that context and it does not time
 * out, so "try again" is false and "restart" is the only thing that works.
 */
assert(
  'a wedged picker is reported as its own state',
  /'busy' : 'failed'/.test(source) && /\| \{ status: 'busy' \}/.test(source),
  [
    "pickReceiptDocument must map the in-progress exception to 'busy',",
    'or the app tells people to retry something that cannot succeed.',
  ],
);


console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
