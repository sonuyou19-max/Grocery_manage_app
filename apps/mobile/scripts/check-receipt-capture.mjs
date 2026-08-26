/**
 * The camera side of receipt scanning.
 *
 * Three separate things, all of which fail quietly:
 *
 * 1. THE SIZE PICKER. `pickPictureSize` is the only reason a twelve-megapixel
 *    phone produces an image small enough to send. Both obvious wrong answers —
 *    take the first, take the largest — return a real string that looks like it
 *    worked, and the feature then fails at the till on a full trolley's receipt
 *    rather than in a test.
 *
 * 2. THE TWO CEILINGS. The device refuses an oversized image before uploading
 *    it, and receipt-scan refuses it again on arrival. Those are two copies of
 *    the same two numbers in two languages, and copies drift. Drift in the
 *    permissive direction (device ceiling above the function's) means every
 *    long receipt makes the round trip to be rejected.
 *
 * 3. THE CONSUMED HAND-OFF. `takeRun` empties the stash, which makes it wrong
 *    to call in a render body — the first paint gets the scan and every
 *    re-render after it gets null, so the screen blanks the moment anything
 *    changes. It is called inside a useState initialiser for exactly that
 *    reason, and that is the kind of line an unrelated cleanup removes.
 *
 * Run with `pnpm --filter mobile check:receipt-capture`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPO = join(ROOT, '..', '..');

const read = (p) => readFileSync(p, 'utf8');

/*
 * Comments stripped, for every assertion that matches source text.
 *
 * This has now bitten twice in one day. check-safe-area tested a file for
 * `useSafeAreaInsets()` and passed against a component that had stopped calling
 * it, because that file's own doc comment says the name four times explaining
 * why it is used. Then the same thing here: `contentFit="contain"` is written
 * in the prose above the line it describes, so the assertion held while the
 * code said "cover".
 *
 * A well-commented file is exactly the file where this happens, and this
 * codebase is nothing but well-commented files. So the stripping is done once,
 * at the top, rather than remembered per assertion — an assertion that matches
 * the prose describing the code is not an assertion about the code.
 */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const capture = codeOnly(read(join(ROOT, 'src/lib/receipt-capture.ts')));
const run = codeOnly(read(join(ROOT, 'src/lib/receipt-run.ts')));
const screen = codeOnly(read(join(ROOT, 'src/app/receipt/capture.tsx')));
const review = codeOnly(read(join(ROOT, 'src/app/receipt/review.tsx')));
const fn = read(join(REPO, 'supabase/functions/receipt-scan/index.ts'));
const overlay = codeOnly(read(join(ROOT, 'src/components/scan-overlay.tsx')));

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`  ✗ ${name}`);
  if (detail) console.error(`      ${detail}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

/* -------------------------------------------------- 1. the size picker --- */

console.log('\npickPictureSize');

/*
 * Loaded by evaluating the function's own source rather than importing it: the
 * module is TypeScript and this runs under bare node. The extraction is
 * anchored on the export and terminated on a line-start brace, which is why the
 * function must stay top-level and brace-terminated.
 */
const source = capture.match(/export function pickPictureSize[\s\S]*?\n}/);
if (!source) {
  fail('pickPictureSize is extractable', 'no top-level `export function pickPictureSize ... \\n}`');
} else {
  const body = source[0]
    .replace('export function', 'function')
    .replace(/: readonly string\[\]/, '')
    .replace(/, target = TARGET_LONG_EDGE\)/, ', target = 1600)')
    .replace(/: string \| null/, '')
    .replace(/: \{ size: string; longEdge: number \} \| null/, '');
  const pickPictureSize = new Function(`${body}; return pickPictureSize;`)();

  assert(
    pickPictureSize(['4032x3024', '1920x1080', '3264x2448', '640x480']) === '1920x1080',
    'takes the smallest size that still clears the target',
    'a larger one means uploading pixels the vision API discards',
  );

  assert(
    pickPictureSize(['1920x1080', '4032x3024']) === '1920x1080',
    'not simply the largest',
  );

  assert(
    pickPictureSize(['4032x3024', '1920x1080']) === '1920x1080',
    'not simply the first',
  );

  assert(
    pickPictureSize(['1080x1920']) === '1080x1920',
    'reads the long edge whichever way round it is printed',
  );

  assert(
    pickPictureSize(['640x480', '800x600']) === null,
    'null when nothing clears the target, so the camera keeps its own default',
  );

  assert(
    pickPictureSize(['nonsense', 'x', '1920x1080']) === '1920x1080',
    'skips sizes it cannot parse rather than guessing at them',
  );

  assert(
    pickPictureSize(['2048x1536'], 4000) === null,
    'honours an explicit target',
  );
}

/* ------------------------------------------------------ 2. the ceilings --- */

console.log('\nceilings agree with receipt-scan');

const num = (text, name) => {
  const m = new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(text);
  return m ? Number(m[1].replace(/_/g, '')) : null;
};

const deviceChars = num(capture, 'MAX_IMAGE_CHARS');
const fnChars = num(fn, 'MAX_IMAGE_CHARS');
assert(
  deviceChars != null && deviceChars === fnChars,
  'MAX_IMAGE_CHARS matches the function',
  `device ${deviceChars}, receipt-scan ${fnChars}`,
);

const shots = num(capture, 'MAX_SHOTS');
const fnImages = num(fn, 'MAX_IMAGES');
assert(
  shots != null && shots === fnImages,
  'MAX_SHOTS matches the function’s MAX_IMAGES',
  `device ${shots}, receipt-scan ${fnImages}`,
);

const target = num(capture, 'TARGET_LONG_EDGE');
assert(
  target != null && target >= 1568,
  'TARGET_LONG_EDGE is at or above the vision API’s own resize threshold',
  `is ${target}; below 1568 hands the model an image already softened, and the first thing a receipt loses is its decimal points`,
);

const fallback = /FALLBACK_QUALITY\s*=\s*([\d.]+)/.exec(capture);
const quality = /CAPTURE_QUALITY\s*=\s*([\d.]+)/.exec(capture);
assert(
  fallback != null && quality != null && Number(fallback[1]) < Number(quality[1]),
  'the retry quality is lower than the first attempt',
  'a retry at the same quality produces the same oversized image, twice',
);

/* -------------------------------------------------------- the shot loop --- */

console.log('\ncapture screen');

assert(
  /tooLarge\(base64\)/.test(screen),
  'the shot is size-checked before it is kept',
  'without it an oversized image travels to the function to be refused there',
);

assert(
  /disabled=\{!ready \|\| busy \|\| full\}/.test(screen),
  'the shutter is held until onCameraReady',
  'takePictureAsync before the camera is ready throws on Android',
);

assert(
  /if \(!ready \|\| busy \|\| pending \|\| shots\.length >= MAX_SHOTS\) return;/.test(screen),
  'shoot() re-checks every condition itself',
  'the disabled prop is a hint; a double-tap that lands before the re-render is not. `pending` is the fourth: a second capture over a shot still waiting to be judged would silently discard the first',
);

assert(
  /onMountError=\{\(\) => setMountFailed\(true\)\}/.test(screen),
  'a camera that fails to mount falls back to an explanation',
);

/* --------------------------------------------------- 3. the hand-off ----- */

console.log('\nhand-off');

assert(
  /useState<ScanRun \| null>\(\(\) => takeRun\(\)\)/.test(review),
  'the review screen takes the run in a useState initialiser',
  'takeRun() empties the stash, so calling it in the render body blanks the screen on the second render',
);

const takeRunBody = /export function takeRun[\s\S]*?\n}/.exec(run);
assert(
  takeRunBody != null && /pending = null/.test(takeRunBody[0]),
  'takeRun clears the stash',
  'a run left behind is a receipt somebody can land on and import twice',
);

/* ------------------------------------------------------ pipeline order --- */

console.log('\nrunScan order');

const at = (needle) => run.indexOf(needle);
assert(
  at('matchPurchases(') < at('matchResidue(') && at('matchPurchases(') > 0,
  'the free rungs run before the model is asked anything',
  'asking first spends money to be told what normalizeKey already proved',
);

assert(
  at('claimedIds(offline)') > 0 && at('claimedIds(offline)') < at('applyAiMatches('),
  'the model is told which list rows are already taken',
  'offering a spoken-for row invites the one answer that cannot be shown to be wrong',
);

assert(
  at('applyAiMatches(') > at('matchResidue('),
  'the model’s answers are folded in last, through applyAiMatches',
  'applyAiMatches is what stops a model overruling an exact-key match',
);

/* --------------------------------------- 3b. the shot, before it counts --- */

console.log('\nconfirm before keeping');

/*
 * A live camera preview cannot tell you whether the PRICES came out legible,
 * and that is the only property that matters — a blurred receipt looks exactly
 * like a receipt until the review sheet is full of nonsense, several seconds
 * and one vision call later. So the shot is held, looked at, and only then
 * counted.
 */
assert(
  /setPending\(\{ uri: photo\.uri, base64 \}\)/.test(screen),
  'a shot is HELD, not appended',
  'appending straight from the shutter is what left a blurred frame undetectable until the scan came back',
);

assert(
  /const keep = \(\) => \{[\s\S]{0,200}setShots\(\(prev\) => \[\.\.\.prev, pending\]\)/.test(screen),
  'only Use photo appends it',
);

assert(
  /const retake = \(\) => \{[\s\S]{0,120}setPending\(null\)/.test(screen),
  'Retake discards it',
);

assert(
  /contentFit="contain"/.test(screen),
  'the confirm view shows the WHOLE frame',
  'cover would crop the edges off the thing being inspected, hiding the failure most likely to matter — part of the receipt outside the frame',
);

assert(
  /\{pending && !scanning && \(/.test(screen),
  'the confirm step yields to the scan overlay',
);

/* ----------------------------------------------- 4. the wait, while it waits */

console.log('\nwhile the scan runs');

/*
 * A vision call plus a matcher call is several seconds, and it used to be a
 * spinner inside a button over a live camera preview. The overlay shows the
 * shopper's OWN photograph with a line travelling down it, which does one thing
 * a stock animation cannot: it shows them WHAT is being read. The first test
 * shot of this whole feature was a photograph of a sofa.
 */
assert(
  /\{scanning && <ScanOverlay/.test(screen),
  'the scan is covered by the overlay for its whole duration',
);

assert(
  /uris=\{shots\.map\(\(s\) => s\.uri\)\}/.test(screen),
  'the overlay shows EVERY shot, not just the first',
  'a long receipt is up to four photographs; showing shots[0] alone left three quarters of what was being read invisible, and a bad fourth frame hidden until the review sheet',
);

assert(
  /setShown\(\(i\) => \(i \+ 1\) % uris\.length\)/.test(overlay),
  'the preview steps through them',
);

assert(
  /if \(uris\.length < 2\) return;/.test(overlay),
  'a single shot does not cycle',
  'a timer running against a static image is just a timer',
);

assert(
  /uris\[shown % uris\.length\]/.test(overlay),
  'the index wraps rather than trusting it is in range',
  'an index past the end blanks the frame, which looks exactly like a failed scan',
);

const runSrc = read(join(ROOT, 'src/lib/receipt-run.ts'));

assert(
  /onPhase\?\.\('reading'\)/.test(runSrc) && /onPhase\?\.\('matching'\)/.test(runSrc),
  'both phases are announced by the work itself',
);

assert(
  /if \(left\.length > 0\) onPhase\?\.\('matching'\)/.test(runSrc),
  'the matching phase is claimed ONLY when there is something to match',
  'a receipt the free rungs settled entirely never enters that phase, and saying it had would be the invented-progress problem the two-phase design exists to avoid',
);

assert(
  !/setTimeout|setInterval/.test(runSrc),
  'no phase is advanced on a timer',
  'a timed caption reads "almost done" over a request that has not returned — the one thing a progress display must never do',
);

assert(
  /useReducedMotion\(\)/.test(overlay) && /reduced\s*\?/.test(overlay),
  'the sweep honours Reduce Motion',
  'this is the app’s first animation that never stops on its own, which is exactly what that setting is for',
);

assert(
  /cancelAnimation\(travel\)/.test(overlay),
  'the loop is cancelled when the overlay goes',
  'withRepeat(-1) with no teardown keeps running after unmount',
);

assert(
  !/require\(['"]\.\.\/\.\.\/assets|\.gif['"]/.test(overlay),
  'no image asset was added for this',
  'a GIF or Lottie file would be a bundled asset at best and a native dependency at worst — the feature stays shippable over the air',
);

/* ------------------------------------------ one screen at a time --------- */

/*
 * Three screens live in this file — the camera, the confirm, and the scan
 * progress — and the last two are absoluteFill. They are rendered BEFORE the
 * camera's chrome, so painting order puts the chrome on top of both unless
 * something stops it.
 *
 * Nothing did. The capture hint landed on top of "Can you read the amounts?" as
 * one unreadable line of two sentences, and the Scan button sat over "Use
 * photo" — two overlays and three sets of controls all live at once, with the
 * wrong one reachable.
 *
 * Asserted structurally, because nothing about it can be observed from the
 * outside: every piece drew correctly, in the wrong place, on top of a screen
 * that had replaced it.
 */
{
  const chrome = screen.indexOf('<Safe style={styles.overlay}>');
  const guard = screen.indexOf('{!pending && !scanning && (');
  assert(guard > 0, 'the camera chrome is guarded');
  assert(guard > 0 && guard < chrome, '...and the guard comes before it');

  // Both screens it defers to are full-screen, which is the reason the guard
  // has to exist at all. If either stopped covering the screen, the guard would
  // be hiding controls for no reason.
  assert(
    /confirmRoot: \{ \.\.\.StyleSheet\.absoluteFillObject/.test(screen),
    'the confirm screen fills the screen',
  );
  assert(
    /root: \{\s*\.\.\.StyleSheet\.absoluteFillObject/.test(overlay),
    'the scan screen fills the screen',
  );

  // Each screen carries its own hint, and only one is ever mounted — which is
  // what stops two sentences sharing a line.
  /*
   * Each screen carries its own hint and only one is ever mounted, which is what
   * stops two sentences sharing a line.
   *
   * Against the guarded REGION, not against the guard's position: ConfirmShot is
   * declared below the component, so "before the guard" is false for it and the
   * first version of this failed on correct code.
   */
  /*
   * Anchored to the line, not to the characters. `'      )}'` also occurs INSIDE
   * `'          )}'` — the thumbnail strip's own closing brace — so the region
   * ended a third of the way through and the Scan button fell outside it. The
   * assertion below then passed by testing the wrong span, which is the failure
   * this whole file exists to avoid.
   */
  const guardEnd = screen.indexOf('\n      )}\n    </View>', guard);
  const inGuard = (needle) => {
    const at = screen.indexOf(needle);
    return at > guard && at < guardEnd;
  };
  assert(guardEnd > guard, 'the guarded region was found');
  assert(inGuard("t('receipt.hint'"), 'the camera hint is inside the guard');
  assert(!inGuard("t('receipt.checkShot')"), 'the confirm hint is not');
  // And the Scan button IS — it belongs to the camera, and it was the control
  // that ended up sitting over "Use photo".
  assert(inGuard("t('receipt.scan')"), 'the Scan button is inside the guard');
}

/* ------------------------------- the matcher is not on the critical path -- */

/*
 * The review sheet has everything it displays the moment the READ comes back:
 * the lines, the prices, the totals, and whatever normalizeKey settled for
 * free. The AI matcher is a second round trip that cannot even start until then,
 * and awaiting it meant the shopper watched a progress screen through a whole
 * extra call to learn which of two rows the chocolate belonged to.
 *
 * So it is started and not awaited. Which makes the merge the delicate part:
 * an answer composed BEFORE the sheet existed must never undo an edit made
 * after it.
 */
{
  const runSrc = codeOnly(read(join(ROOT, 'src/lib/receipt-run.ts')));
  const reviewSrc = codeOnly(read(join(ROOT, 'src/app/receipt/review.tsx')));
  const merge = codeOnly(read(join(ROOT, 'src/lib/receipt-review.ts')));

  assert(!/await matchResidue\(/.test(runSrc), 'the run does not await the matcher');
  assert(/settle: Promise<Map<string, MatchOutcome>>/.test(runSrc), '...it hands back a promise instead');
  assert(/matches: offline, settle/.test(runSrc), '...and the offline answers immediately');
  // matchResidue already answers [] on every failure; this covers the rest.
  assert(/\.catch\(\(\) => offline\)/.test(runSrc), 'a failed match degrades to the offline half');

  assert(/run\.settle\.then\(/.test(reviewSrc), 'the review folds them in when they land');
  assert(/mergeLateMatches\(prev, matches\)/.test(reviewSrc), '...through the guarded merge');
  // A setState after the import has navigated away is a warning at best.
  assert(/if \(alive\) setDecisions/.test(reviewSrc), '...and never after the screen has gone');

  /*
   * The two refusals. Without the first, a late answer overwrites an assignment
   * the shopper made by hand; without the second it can move a claim off the
   * line they just put it on, because `assign` moves rather than duplicates.
   */
  assert(
    /if \(!current \|\| current\.itemId != null\) continue;/.test(merge),
    'an assigned purchase is left alone',
  );
  assert(
    /if \(taken\.has\(m\.itemId\)\) continue;/.test(merge),
    '...and a row already spoken for is not handed out twice',
  );
}

/* ------------------------------------------------------------------------ */

if (failures > 0) {
  console.error(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\n✓ receipt capture checks passed');
