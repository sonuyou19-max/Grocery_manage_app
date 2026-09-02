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

/*
 * Both imports stubbed, and the stubs are shaped to keep the assertions honest.
 *
 * springTo just forwards to Reanimated, so `withSpring` becomes a recorder. The
 * EASINGS matter more: they are opaque worklets at runtime and there is nothing
 * to assert about their VALUES — so the stub records which family and which
 * direction each one asked for, which is the part a person could get wrong.
 * `Easing.out(Easing.cubic)` on an exit is a real mistake and it is exactly the
 * kind nothing else would catch.
 *
 * `useRef` is stubbed because useLastPresent lives in this file: it is motion
 * vocabulary — it exists so an exit animation is not cut off — and putting it
 * anywhere else would mean two places to look for how this app moves.
 */
const source = readFileSync(SRC, 'utf8')
  .replace(
    /^import .*from 'react-native-reanimated';$/m,
    `const withSpring = (to, cfg) => ({ to, cfg });
     const named = (kind) => ({ kind });
     const Easing = {
       cubic: named('cubic'),
       quad: named('quad'),
       out: (e) => ({ dir: 'out', of: e.kind }),
       in: (e) => ({ dir: 'in', of: e.kind }),
       inOut: (e) => ({ dir: 'inOut', of: e.kind }),
     };`,
  )
  .replace(
    /^import \{ useRef \} from 'react';$/m,
    `let cell = { current: null };
     const useRef = (init) => { if (cell.current === null) cell.current = init; return cell; };`,
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

const { rubberBand, SPRING, DURATION, EASE, useLastPresent } = mod;

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
/* The cascade. One set of numbers, or the house style varies by screen.      */
/* ------------------------------------------------------------------------- */
{
  const before = failures;
  const cascade = stripComments(readFileSync(join(here, '..', 'src', 'lib', 'cascade.ts'), 'utf8'));

  // The cap is the design. Uncapped, the delay is proportional to position and
  // a long list punishes its own length — the fortieth row waits over a second,
  // which reads as the screen being slow rather than as a flourish.
  check('the cascade is capped', /Math\.min\(Math\.max\(0, Math\.floor\(order\)\), CASCADE_CAP\)/.test(cascade), true);
  check('...at twelve steps', /CASCADE_CAP = 12/.test(cascade), true);
  check('a negative order cannot pull the delay backwards', /Math\.max\(0,/.test(cascade), true);

  /*
   * Stated rather than inherited. Reanimated's default for layout animations
   * follows the system setting, which is what we want — but a default that
   * changes in a minor release would take a whole accessibility behaviour with
   * it, silently, and nothing here would fail.
   */
  check('Reduce Motion is stated', /\.reduceMotion\(ReduceMotion\.System\)/.test(cascade), true);

  /*
   * Every screen that staggers something goes through it. Three had grown their
   * own copy with three different sets of constants before this existed; the
   * point of the helper is lost the moment a fourth appears.
   */
  const staggered = [];
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (rel === 'lib/cascade.ts') continue;
    const text = stripComments(readFileSync(file, 'utf8'));
    /*
     * A DELAY on an entrance is what makes it a stagger, and staggering is the
     * thing worth having one of. A single element arriving on its own — the
     * climate hero, the list's sticky bar — is a different gesture with its own
     * timing, and forbidding those would be tidying rather than guarding.
     */
    if (/\b(?:FadeIn|FadeOut|SlideIn|SlideOut|ZoomIn)\w*\.delay\(/.test(text)) {
      staggered.push(rel);
    }
  }
  check('no screen rolls its own stagger', staggered, []);

  if (failures === before) {
    console.log('ok   one cascade, one set of numbers, everywhere');
  }
}

/* ------------------------------------------------------------------------- */
/* The create menu's dim, which is the one scrim that cannot live in Sheet.   */
/* ------------------------------------------------------------------------- */
{
  const before = failures;
  const bar = stripComments(readFileSync(join(here, '..', 'src', 'components', 'floating-tab-bar.tsx'), 'utf8'));

  /*
   * A <Modal> is its own native window, above the whole app, so a scrim drawn
   * inside one covers the tab bar too — there is no z-order in that window that
   * can put something from a different window beneath it. Hence a dim in the
   * bar's own tree, and hence: it must be drawn BEFORE the bar, or it covers
   * the thing it exists to spare.
   */
  const dimAt = bar.indexOf('<CreateBackdrop');
  const barAt = bar.indexOf('styles.wrap');
  check('the dim exists', dimAt > 0, true);
  check('...and is painted under the bar, not over it', dimAt > 0 && dimAt < barAt, true);
  check(
    'the create sheet does not ask Sheet for a scrim',
    /scrim/.test(stripComments(readFileSync(join(here, '..', 'src', 'components', 'create-sheet.tsx'), 'utf8'))),
    false,
  );

  // React Navigation lays a custom tab bar out in a strip the height of the
  // bar, so absoluteFill would dim the strip and nothing else.
  check('it is sized from the window, not from its container', /const \{ height \} = useWindowDimensions\(\)/.test(bar), true);
  check('...growing up from the screen bottom', /backdrop: \{ position: 'absolute', left: 0, right: 0, bottom: 0 \}/.test(bar), true);

  /*
   * Never takes a touch. The Modal's own backdrop sits above this and is what
   * closes the menu — including a tap over the cross, which is the same gesture
   * as pressing the button again and has to keep working.
   */
  check('it never catches a tap', /<Animated\.View\s+pointerEvents="none"/.test(bar), true);

  /*
   * One clock. Two fades a few milliseconds apart do not read as two fades,
   * they read as one fade with something wrong with it.
   */
  check('it shares the sheet’s timings', /SHEET_OPEN_MS[\s\S]{0,200}SHEET_CLOSE_MS/.test(bar), true);
  check('...and the sheet’s black', /backgroundColor: SCRIM_COLOR/.test(bar), true);
  check(
    '...read from Sheet rather than restated',
    /import \{ SCRIM_COLOR, SHEET_CLOSE_MS, SHEET_OPEN_MS \} from '@\/components\/sheet'/.test(bar),
    true,
  );

  if (failures === before) {
    console.log('ok   the create menu dims the page and spares the bar');
  }
}

/* ================================================== the duration vocabulary */

/*
 * Sixteen `_MS` constants in sixteen files, every one a private opinion — and
 * two of them the same number for the same thing, which is the drift a shared
 * vocabulary exists to prevent. The springs had been a system since they were
 * written; durations were not, and "I have to ask for every animation" is what
 * that looks like from the outside.
 *
 * The assertions below are about the RELATIONSHIPS, not the numbers. Any of
 * these values can be retuned; what must not change is what they mean relative
 * to each other, because that is the part a person would break without noticing.
 */

const dur = (name, actual, expected) => check(`DURATION.${name}`, actual, expected);
dur('swap', DURATION.swap, 90);
dur('settle', DURATION.settle, 170);
dur('exit', DURATION.exit, 160);
dur('scrimExit', DURATION.scrimExit, 200);
dur('enter', DURATION.enter, 220);
dur('travel', DURATION.travel, 480);
dur('breathe', DURATION.breathe, 1200);
dur('sweep', DURATION.sweep, 1800);

/*
 * LEAVING IS FASTER THAN ARRIVING.
 *
 * The one rule worth arguing for. An entrance is something you are being shown
 * and can afford to be watched; an exit is something you have already decided
 * about, and every millisecond after that decision is the app making you wait
 * for a screen you asked for. Symmetric durations are the default anyone
 * reaches for, which is exactly why this is asserted rather than remembered.
 */
check('leaving is faster than arriving', DURATION.exit < DURATION.enter, true);

/*
 * ...and the same asymmetry INSIDE a value being replaced. Clearing fast and
 * arriving slower reads as the new figure being placed; matched halves read as
 * a crossfade between two things, which is not what happened.
 */
check('a value clears faster than it arrives', DURATION.swap < DURATION.settle, true);

/*
 * A scrim needs a tail. The sheet's close eases OUT, putting the slow part at
 * the end — and at a plain exit's length there is nowhere for that tail to
 * happen, so the dim reads as the background light being switched. This is the
 * one number here that was argued out in the codebase before there was a
 * vocabulary to hold it, and the argument is what the name preserves.
 */
check('an exit with a dim behind it is longer', DURATION.scrimExit > DURATION.exit, true);
check('...but still faster than arriving', DURATION.scrimExit < DURATION.enter, true);

/* The classes are ordered by how much attention they ask for. */
check(
  'the classes stay in order',
  DURATION.enter < DURATION.travel && DURATION.travel < DURATION.breathe &&
    DURATION.breathe < DURATION.sweep,
  true,
);

/* =================================================================== easing */

/*
 * There is nothing to assert about an easing's VALUE — they are opaque worklets
 * — so the loader records which family and direction each one asked for. That
 * is the part a person gets wrong: `Easing.out` on an exit is a real mistake,
 * it looks fine in a diff, and it makes the thing appear to hesitate before
 * leaving.
 */
check('arriving decelerates', EASE.enter, { dir: 'out', of: 'cubic' });
check('leaving accelerates', EASE.exit, { dir: 'in', of: 'cubic' });
check('moving between two places is eased at both ends', EASE.move, { dir: 'inOut', of: 'cubic' });

/* ==================================================== rendering your own exit */

/*
 * The flicker, and the reason it is a hook rather than a habit.
 *
 * A sheet is opened by handing it a subject and closed by handing it null —
 * both on the same frame, because the caller closes by clearing the key the
 * subject is looked up by. `if (!item) return null` therefore unmounts the
 * whole sheet before its exit can play one frame: it does not animate away, it
 * stops existing, which on screen is a flash.
 *
 * Four components worked that out independently before it had a name. That is
 * the signature of a missing abstraction — not duplicated code, duplicated
 * REASONING — and it is exactly the class of thing nobody should have to ask
 * for twice.
 */
check('it holds the value it was given', useLastPresent('a'), 'a');
check('...and keeps it once the value is gone', useLastPresent(null), 'a');

/* ----------------------------------------------- and nothing rolls its own - */

// The walker and the comment stripper this file already has, rather than a
// second copy of each — two scans of the same tree that could disagree about
// which files they cover is the class of thing this whole file is about.
const files = walk(APP).map((f) => ({
  rel: relative(APP, f).split('\\').join('/'),
  text: stripComments(readFileSync(f, 'utf8')),
}));

/*
 * NO ANONYMOUS DURATIONS.
 *
 * A number typed straight into a withTiming call is a number nobody has looked
 * at twice; one that names itself is a decision somebody took. So the rule is
 * not "always use the vocabulary" — vibe-check's two hero reveals are
 * deliberately slower than anything in it, and a vocabulary that swallowed them
 * would be the system overruling the design. The rule is that a duration is
 * either shared or NAMED, never inline.
 */
const anonymous = files
  .filter((f) => f.rel !== 'lib/motion.ts')
  .flatMap((f) =>
    (f.text.match(/duration:\s*\d+/g) ?? []).map((hit) => `${f.rel}: ${hit}`),
  );
if (anonymous.length) {
  failures += 1;
  console.log('FAIL a duration is typed inline instead of named');
  for (const a of anonymous) console.log(`  ${a}`);
  console.log('  Reach for DURATION, or name a constant and say why it differs.');
}

/*
 * ...AND A NAMED CONSTANT MUST NOT SILENTLY BE A VOCABULARY VALUE.
 *
 * The rule above allows a named number, because naming one is the act of taking
 * responsibility for it. That leaves the exact hole this whole system was built
 * for: `const SHEET_OPEN_MS = 220` is named, and it is also DURATION.enter
 * typed out again — which is how two sheets came to close at two speeds with
 * only one of them having a reason.
 *
 * Found by mutation. Restoring the literal to sheet.tsx fired nothing, because
 * every assertion here was about the vocabulary and none about whether anybody
 * was using it.
 *
 * A number that differs from every shared value is a deliberate deviation and
 * passes; one that MATCHES is the vocabulary written out by hand, and the fix
 * is to say so.
 *
 * ---------------------------------------------------------------------------
 * ...but only for constants that are actually DURATIONS
 * ---------------------------------------------------------------------------
 *
 * The first version matched every screaming-snake number in the app, and a
 * duration in milliseconds is not distinguishable from a length in dp by its
 * digits alone. It caught `MIN_SCROLL = 160` — the smallest list an overflow
 * sheet will draw — and told it to use DURATION.exit, which is 160ms and has
 * nothing to do with it.
 *
 * That is not a harmless false positive. A guard that fires on things it cannot
 * really know about is one that gets suppressed, and this one has already
 * earned its keep once. So a constant is in scope when EITHER it names itself
 * temporal, OR the file passes it to something that takes a duration. The
 * second half is the one with teeth: a hand-typed 220 called `FOLD` and handed
 * to withTiming is caught on how it is USED, whatever it is called.
 */
const shared = new Map(Object.entries(DURATION).map(([k, v]) => [v, k]));
const TEMPORAL_NAME = /(^|_)(MS|DURATION|DELAY|TIME|SPEED|FADE|ANIM)($|_)/;
// Passed where a duration goes: `{ duration: X }`, withTiming/withDelay's
// second argument, or a bare timer.
const usedAsDuration = (text, name) =>
  new RegExp(
    `duration:\\s*${name}\\b|with(?:Timing|Delay|Repeat)\\([^)]*\\b${name}\\b|set(?:Timeout|Interval)\\([^)]*\\b${name}\\b`,
  ).test(text);

const restated = files
  .filter((f) => f.rel !== 'lib/motion.ts')
  .flatMap((f) =>
    [...f.text.matchAll(/const ([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/g)]
      .filter(([, name, n]) => shared.has(Number(n)))
      .filter(([, name]) => TEMPORAL_NAME.test(name) || usedAsDuration(f.text, name))
      .map(([, name, n]) => `${f.rel}: ${name} = ${n} is DURATION.${shared.get(Number(n))}`),
  );
if (restated.length) {
  failures += 1;
  console.log('FAIL a duration restates a shared value instead of using it');
  for (const r of restated) console.log(`  ${r}`);
  console.log('  Two copies of one number is how the two sheets drifted apart.');
}

/*
 * And nothing hand-rolls the render-through-exit ref any more. The pattern is
 * `if (x) someRef.current = x` in a render body, which is what all four of them
 * wrote, and it is the thing useLastPresent replaces.
 */
const handRolled = files
  .filter((f) => f.rel !== 'lib/motion.ts')
  .filter((f) => /if \([A-Za-z]+\) [A-Za-z]+\.current = /.test(f.text))
  .map((f) => f.rel);
if (handRolled.length) {
  failures += 1;
  console.log('FAIL a component rolls its own render-through-exit ref');
  for (const h of handRolled) console.log(`  ${h}`);
  console.log('  useLastPresent is that rule with a name on it.');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
