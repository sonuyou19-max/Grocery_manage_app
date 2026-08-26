/**
 * Motion check — the rubber-band curve and the spring presets.
 *
 * `rubberBand` runs on the UI thread on every frame of every swipe, and it is
 * pure arithmetic with genuinely awkward edges: a boundary at zero, negative
 * travel, and a requirement to be continuous at the limit or the row visibly
 * jumps as the finger crosses it. None of that shows up in a typecheck, and a
 * wrong curve doesn't crash — it just feels bad, which is the hardest kind of
 * bug to notice in a diff.
 *
 * The zero-limit case is here because the first version of this function was
 * wrong there: it expressed the give as a fraction of the limit, so at limit 0
 * it collapsed to no movement at all while three call sites had comments
 * promising elastic resistance.
 *
 * Run with `pnpm --filter mobile check:motion`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', 'lib', 'motion.ts');

// springTo just forwards to Reanimated; the curve and the presets are what
// this file is about, so the import is stubbed rather than mocked.
const source = readFileSync(SRC, 'utf8').replace(
  /^import .*from 'react-native-reanimated';$/m,
  'const withSpring = (to, cfg) => ({ to, cfg });',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
};
const near = (name, actual, expected, tol = 1e-9) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ~${expected}\n  actual    ${actual}`);
  }
};

const { rubberBand, SPRING } = mod;

/* ------------------------------------------- inside the limit: pass through */

// Below the boundary the element must track the finger EXACTLY. Any scaling
// here would make normal dragging feel laggy, which is worse than no
// rubber-banding at all.
for (const v of [0, 1, 40, 99.9, 130]) {
  check(`tracks the finger exactly at ${v}`, rubberBand(v, 130), v);
  check(`tracks the finger exactly at ${-v}`, rubberBand(-v, 130), -v);
}

/* ---------------------------------------------------- continuity at the edge */

// A discontinuity here is a visible jump mid-drag.
const L = 130;
near('continuous just below the limit', rubberBand(L - 0.001, L), L - 0.001, 1e-6);
near('exactly at the limit returns the limit', rubberBand(L, L), L);
near('just past the limit barely moves', rubberBand(L + 0.001, L), L, 0.002);

/* --------------------------------------------------------- past the boundary */

const give = L * 0.55; // the default
near('at over === give, half the give is used', rubberBand(L + give, L), L + give / 2, 1e-9);
check('never reaches limit + give', rubberBand(L + 100000, L) < L + give, true);
check('approaches limit + give from below', rubberBand(L + 1e9, L) > L + give * 0.999, true);

// Monotonic and strictly increasing: more finger travel must never produce
// less movement, or the row stutters backwards under a steady drag.
let prev = -Infinity;
let monotonic = true;
for (let v = 0; v <= 600; v += 3) {
  const out = rubberBand(v, L);
  if (out < prev) monotonic = false;
  prev = out;
}
check('monotonic across the whole range', monotonic, true);

// Symmetric: dragging left must feel exactly like dragging right.
let symmetric = true;
for (let v = 0; v <= 600; v += 7) {
  if (Math.abs(rubberBand(-v, L) + rubberBand(v, L)) > 1e-9) symmetric = false;
}
check('symmetric about zero', symmetric, true);

/* ------------------------------------------- the zero-limit case (the bug) */

// A boundary at zero with an explicit give: a sheet already fully open, or a
// row already closed, dragged the wrong way. This must still move.
check('zero limit with give does move', rubberBand(50, 0, 44) > 0, true);
near('zero limit, over === give, uses half the give', rubberBand(44, 0, 44), 22);
check('zero limit never exceeds the give', rubberBand(1e9, 0, 44) < 44, true);
check('zero limit is symmetric', rubberBand(-50, 0, 44), -rubberBand(50, 0, 44));
// And the degenerate case: no give means a hard stop, not NaN.
check('zero give is a hard clamp, not NaN', rubberBand(500, 130, 0), 130);
check('zero limit and zero give pins to zero', rubberBand(500, 0, 0), 0);
check('no NaN anywhere', [0, 1, -1, 500, -500, 1e9].every((v) => Number.isFinite(rubberBand(v, 0, 44))), true);

/* --------------------------------------------------------- the spring presets */

const REQUIRED = ['settle', 'sheet', 'snappy', 'fling', 'gentle'];
for (const key of REQUIRED) {
  const cfg = SPRING[key];
  check(`preset ${key} exists`, Boolean(cfg), true);
  if (!cfg) continue;
  check(`${key} damping is positive`, cfg.damping > 0, true);
  check(`${key} stiffness is positive`, cfg.stiffness > 0, true);
  check(`${key} mass is positive`, cfg.mass > 0, true);
  // Underdamped springs oscillate forever at low damping ratios; over ~2 they
  // crawl. Both extremes are bugs you only notice on device.
  const ratio = cfg.damping / (2 * Math.sqrt(cfg.stiffness * cfg.mass));
  check(`${key} damping ratio ${ratio.toFixed(2)} is in a sane band`, ratio > 0.5 && ratio < 1.6, true);
}

// The surfaces where an overshoot would expose the screen behind them must be
// clamped. This is a correctness property, not a taste one.
check('sheet is overshoot-clamped', SPRING.sheet.overshootClamping, true);
check('fling is overshoot-clamped', SPRING.fling.overshootClamping, true);
// And the ones where a little bounce is the whole point must NOT be.
check('settle is allowed to overshoot', Boolean(SPRING.settle.overshootClamping), false);
check('snappy is allowed to overshoot', Boolean(SPRING.snappy.overshootClamping), false);

/* --------------------------- presets are the only spring configs ---------- */

/*
 * lib/motion.ts opens by saying presets exist "so two sheets can never drift
 * apart by one damping point". That was aspirational: the tab bar carried two
 * inline configs, one of them character-for-character identical to SPRING.snappy
 * and the other a fourth unnamed spring, and the bag squash in list/[id] a
 * fifth. A file of presets nothing is required to use is documentation, not a
 * design system.
 *
 * So: a spring config literal may only be written here. Naming it forces the
 * question the presets exist to answer — what IS this thing that is moving? —
 * and two call sites that answer the same way now share a value rather than
 * two numbers that happen to match today.
 */
const APP = join(here, '..', 'src');

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

const SHEET = join(here, '..', 'src', 'components', 'sheet.tsx');

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const inline = [];
for (const file of walk(APP)) {
  if (file === SRC) continue;
  const text = stripComments(readFileSync(file, 'utf8'));
  // A spring config is recognisable by its keys, not by where it sits: damping
  // and stiffness are the two nobody omits.
  for (const m of text.matchAll(/withSpring\s*\([^;]*?\{[^}]*\b(damping|stiffness)\b/g)) {
    inline.push(relative(APP, file).split('\\').join('/'));
    break;
  }
}

if (inline.length) {
  failures += 1;
  console.log('FAIL a spring config is written outside lib/motion.ts');
  for (const rel of [...new Set(inline)]) console.log(`  ${rel}`);
  console.log('  Add a named preset instead. Two call sites that want the same');
  console.log('  motion should share one value, not two literals that agree today.');
} else {
  console.log('ok   every spring config is a named preset');
}

/* ------------------------------------- a dialog must be able to animate out */

/*
 * `<Sheet visible>` — hardcoded rather than bound — is a sheet that can never
 * animate, and it is invisible in review because the component LOOKS animated:
 * it renders Sheet, Sheet owns the motion, everything seems fine.
 *
 * What actually happens is the parent closes it by nulling the data it reads,
 * the component answers `if (!thing) return null`, and the whole Sheet is
 * unmounted on the closing frame. Sheet's exit cannot play when the thing being
 * torn down IS Sheet. The entrance is missing for the mirror reason: mounted
 * with visible already true, there is nothing to animate from.
 *
 * purchase-ledger shipped exactly this and the Pantry's history sheet appeared
 * and vanished instantly; staple-sheet had shipped it before that. Two is a
 * pattern, so it gets a guard: pass the real state and keep a snapshot of the
 * last-open data to render during the exit.
 */
const hardcoded = [];
for (const file of walk(APP)) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(/<Sheet\b([^>]*?)>/g)) {
    // Attribute NAMES only. Values are blanked first, because `visible={visible}`
    // contains the word twice and the second one is followed by `}` rather than
    // `=` — which made the first version of this guard fail on a correct file.
    const names = m[1]
      .replace(/=\s*\{[^}]*\}/g, '=v')
      .replace(/=\s*"[^"]*"/g, '=v');
    // A bare `visible` with no `=` after it is the JSX shorthand for true.
    if (/\bvisible\b(?!\s*=)/.test(names)) {
      hardcoded.push(relative(APP, file).split('\\').join('/'));
      break;
    }
  }
}

if (hardcoded.length) {
  failures += 1;
  console.log('FAIL a <Sheet> is mounted with a hardcoded `visible`');
  for (const rel of [...new Set(hardcoded)]) console.log(`  ${rel}`);
  console.log('  Pass the real open state so Sheet can animate both ways, and');
  console.log('  keep a snapshot of the last-open data to render during the exit.');
} else {
  console.log('ok   every <Sheet> is given real open state to animate from');
}

/*
 * Stock `fade` cross-dissolves a dialog in place, which says nothing about where
 * it came from — the reason sheet.tsx took over the motion for all eleven of
 * them. Banned rather than merely discouraged, because it is one word and looks
 * harmless next to `animationType="none"`.
 */
const faded = [];
for (const file of walk(APP)) {
  if (/animationType\s*=\s*["']fade["']/.test(stripComments(readFileSync(file, 'utf8')))) {
    faded.push(relative(APP, file).split('\\').join('/'));
  }
}
if (faded.length) {
  failures += 1;
  console.log('FAIL animationType="fade" on a Modal');
  for (const rel of faded) console.log(`  ${rel}`);
  console.log('  Use <Sheet>, which scales out of the bottom of the screen, or');
  console.log('  animationType="none" plus your own transform. A cross-dissolve');
  console.log('  in place tells the reader nothing about where the dialog is from.');
} else {
  console.log('ok   no Modal cross-dissolves in place');
}


/* ------------------------------------------------------------------------- */
/* The scrim. It has to be animated, and it has to be its own layer.          */
/*                                                                           */
/* A static backdrop colour is invisible while the sheet is open and reads as */
/* a flash when it closes: the card fades, the dim does not, and then the     */
/* Modal's window goes and takes 45% black with it between two frames.        */
/* Nothing animated it away, so nothing could look soft.                      */
/*                                                                           */
/* It also cannot go back on the backdrop Pressable, which is the view that   */
/* catches a tap outside the card — animating the thing that owns a touch     */
/* target is how that stops being reliable.                                   */
/* ------------------------------------------------------------------------- */
{
  const before = failures;
  const sheet = stripComments(readFileSync(SHEET, 'utf8'));

  check(
    'the scrim is an animated layer',
    /<Animated\.View\s+pointerEvents="none"\s+style=\{\[StyleSheet\.absoluteFill, styles\.scrim, scrimAnim\]\}/.test(sheet),
    true,
  );
  check(
    '...rendered whenever a scrim is asked for, whatever the motion',
    /\{scrim && \(/.test(sheet),
    true,
  );
  check(
    '...and never a flat colour on the view that catches taps',
    /styles\.backdrop,[\s\S]{0,200}styles\.scrim/.test(sheet),
    false,
  );
  check(
    'it does not block the backdrop it sits over',
    /pointerEvents="none"/.test(sheet),
    true,
  );

  /*
   * The exit must not accelerate. `Easing.in` spends the whole close near 1 and
   * drops in the last few frames, which on a scrim is a cut rather than a fade
   * — the reported flash. The slow part belongs at the end.
   */
  check(
    'the close eases OUT, so the dim settles instead of dropping',
    /duration: CLOSE_MS, easing: Easing\.out\(Easing\.quad\)/.test(sheet),
    true,
  );
  /*
   * Scoped to scrimAnim's own body. Written against the whole file this matched
   * `opacity: progress.value` in cardAnim instead — it passed while the scrim
   * was pinned at a constant, which is the exact bug it was written to catch.
   */
  {
    const from = sheet.indexOf('const scrimAnim');
    const body = from < 0 ? '' : sheet.slice(from, sheet.indexOf('}));', from));
    check(
      'the scale scrim shares the card’s clock',
      /:\s*progress\.value/.test(body),
      true,
    );
    check(
      '...and the sliding one keeps its own reading',
      /interpolate\(sheetY\.value/.test(body),
      true,
    );
  }

  if (failures === before) {
    console.log('ok   the scrim fades rather than being switched off');
  }
}

/* ------------------------------------------------------------------------- */
/* The staple sheet's "Stopped buying" reveal.                                */
/*                                                                           */
/* An affordance that explains an unlabelled icon, which means its whole      */
/* value is that it costs nothing to show. Every assertion here guards a way  */
/* of accidentally making it cost something — most of all by letting it into  */
/* the layout, where a two-second chip reflows the item's name and slides the */
/* rest of the sheet down and back up.                                       */
/* ------------------------------------------------------------------------- */
{
  // This file's `check` is silent on success, so the group prints one line of
  // its own — a section that can only ever speak up by failing is a section
  // nobody can tell is still wired in.
  const before = failures;
  const sheet = stripComments(
    readFileSync(join(here, '..', 'src', 'components', 'staple-sheet.tsx'), 'utf8'),
  );

  // The slot is a constant. If a width ever tracks `open` here, the header
  // starts measuring differently mid-animation and everything below it moves.
  check(
    'the reveal has a fixed-width slot in the flow',
    /revealSlot:\s*\{[^}]*width:\s*ICON\b/.test(sheet),
    true,
  );
  check(
    "...and the slot's width does not depend on the animation",
    /revealSlot:\s*\{[^}]*open\.value/.test(sheet),
    false,
  );
  // The thing that grows is absolute, so it grows over the name rather than
  // against it.
  check(
    'the chip that grows is positioned absolutely',
    /reveal:\s*\{\s*position:\s*"absolute"/.test(sheet),
    true,
  );
  check(
    '...anchored to the right edge',
    /reveal:\s*\{[^}]*right:\s*0/.test(sheet),
    true,
  );
  check(
    '...and it is the chip, not the slot, that the width animates',
    /const chip = useAnimatedStyle\(\(\) => \(\{\s*width: ICON \+ open\.value/.test(sheet),
    true,
  );

  // Pinned right means a narrowing chip clips its LEFT — the label — and the
  // icon never moves. Left-aligned, the icon would slide away instead.
  check(
    'the chip content is pinned right so the icon holds still',
    /revealRow:\s*\{[^}]*justifyContent:\s*"flex-end"/.test(sheet),
    true,
  );
  check(
    'the label refuses to shrink, so onLayout measures its true width',
    /revealText:\s*\{[^}]*flexShrink:\s*0/.test(sheet),
    true,
  );
  check('the chip clips rather than overflows', /reveal:\s*\{[^}]*overflow:\s*"hidden"/.test(sheet), true);

  // The plate has to be solid before the words are legible, or the item name
  // reads through them for a beat.
  check(
    'the backing plate fades in ahead of the width',
    /interpolate\(open\.value, \[0, 0\.35, 1\], \[0, 1, 1\]\)/.test(sheet),
    true,
  );

  /*
   * Reduce Motion keeps the WORDS and drops the MOVEMENT. Returning early with
   * open.value left at 0 would look like respecting the setting and would
   * actually withhold the explanation from the people who set it.
   */
  check('Reduce Motion is honoured', /const reduced = useReducedMotion\(\)/.test(sheet), true);
  check(
    '...by leaving the chip open rather than never showing it',
    /if \(reduced\) \{\s*open\.value = 1;\s*return;\s*\}/.test(sheet),
    true,
  );

  // Keyed on the open item, not on mount: this component stays mounted between
  // openings so it can animate the sheet out, so a [] effect would fire once
  // ever and the reveal would never play again.
  check(
    'the reveal replays for each item opened',
    /\}, \[labelW, open, reduced, revealFor\]\);/.test(sheet),
    true,
  );
  check(
    '...and folds away when the sheet closes',
    /if \(revealFor == null \|\| labelW === 0\) \{\s*open\.value = 0;/.test(sheet),
    true,
  );

  // One teardown, written once. Two copies and losing one leaves the other
  // looking like proof — see the scan overlay.
  check(
    'the sequence is cancelled on unmount, exactly once',
    (sheet.match(/cancelAnimation\(open\)/g) ?? []).length,
    1,
  );

  // The chip says the words. A hardcoded English string here would be the one
  // untranslated thing on a translated sheet.
  check('the chip is translated', /const label = t\("stopped\.label"\);/.test(sheet), true);

  /*
   * MEASURED ONCE. This shipped as a plain setState in onLayout and looped:
   * onLayout fires again as the chip animates, the width returns a fraction
   * different, labelW changes, the effect re-runs because labelW is in its
   * deps, and the sequence restarts from its opening delay. The chip froze
   * partway open, waited, and started over — on device it read as broken
   * rather than as animating.
   */
  check(
    'the label is measured once, not on every frame it animates',
    /setMeasured\(\(prev\) => \(prev\?\.text === label \? prev : \{ text: label, w \}\)\)/.test(sheet),
    true,
  );

  /*
   * `styles.reveal` is absolutely positioned, and exactly one element may wear
   * it. A rename applied with a global replace once put it on every cadence
   * preset instead, which stacked all five on top of the paragraph beside them
   * — a typecheck cannot see this, because both keys exist and both are valid
   * styles.
   */
  check(
    'only the reveal itself is absolutely positioned',
    (sheet.match(/styles\.reveal,/g) ?? []).length,
    1,
  );
  check(
    'the cadence presets stay in the flow',
    /style=\{\[\s*styles\.chip,/.test(sheet),
    true,
  );
  check(
    'and the reader is not told the same control twice',
    /accessible=\{false\}[\s\S]{0,120}importantForAccessibility="no"/.test(sheet),
    true,
  );

  if (failures === before) {
    console.log('ok   the stopped-buying reveal explains itself without moving anything');
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
