#!/usr/bin/env node
/**
 * A sheet you type into has to get out of the keyboard's way.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * "While entering the item details, the keyboard is covering the page that
 * opens from the bottom. The keyboard should push that page up so that the user
 * can see what they are typing."
 *
 * A bottom sheet occupies exactly the part of the screen the keyboard comes up
 * over. `Sheet` has taken an `avoidKeyboard` prop since it was written and
 * `purchase-sheet` — the one form in the app with a price and a quantity in it,
 * reached from both the pantry's + and "Add purchase" — never passed it. There
 * is nothing to see at the call site: a sheet without the prop looks exactly
 * like a sheet that does not need it.
 *
 * ---------------------------------------------------------------------------
 * Two halves, and the second is the one that gets missed
 * ---------------------------------------------------------------------------
 *
 * Lifting the sheet is not enough on its own. These cards carry a pixel cap
 * (85% of the window, ~717dp) and the keyboard leaves about 508dp; a cap bigger
 * than the room available does nothing, because RN defaults `flexShrink` to 0.
 * The card keeps its full height and the `overflow: hidden` on the frosted
 * surface silently cuts off the overflow — which on a form with a pinned footer
 * is the Save button. So "I cannot see what I am typing" becomes "the Save
 * button is gone", and only for people whose keyboard is tall enough.
 *
 * So the rule has two halves and both are asserted: a sheet with a text field
 * lifts, AND the card inside it can shrink.
 *
 * Run with `pnpm --filter mobile check:keyboard-inset`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, lines = []) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  for (const line of lines) console.log(`  ${line}`);
};
const assert = (what, cond, lines) => (cond ? ok(what) : fail(what, lines));

/*
 * Comments stripped, newlines kept so reported line numbers are real. The file
 * being checked explains this rule at length and names both the prop and the
 * component, so a scan of the prose would pass on the explanation alone.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, '$1');

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.tsx')) files.push(full);
  }
})(SRC);

/**
 * Every `<Sheet ...>` opening tag in a file, with its props and its span.
 *
 * The props are read by scanning to the `>` that ends the TAG rather than by
 * regex, because a Sheet's props contain braces, arrow functions and `>` inside
 * them — `onClose={() => setPicking(null)}` ends a naive match early and takes
 * the rest of the prop list with it.
 */
function sheets(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!text.startsWith('<Sheet', i)) continue;
    // `<SheetHandle`, `<SheetFoo` — the tag name has to actually end here.
    if (/[A-Za-z0-9_]/.test(text[i + 6] ?? '')) continue;

    let depth = 0;
    let quote = null;
    let end = -1;
    for (let j = i + 6; j < text.length; j += 1) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const props = text.slice(i + 6, end);
    // Where this Sheet's children end: the matching </Sheet>, by nesting count.
    let close = text.indexOf('</Sheet>', end);
    let scan = end;
    let open = 1;
    while (close > 0) {
      const nextOpen = text.indexOf('<Sheet', scan + 1);
      if (nextOpen > 0 && nextOpen < close && !/[A-Za-z0-9_]/.test(text[nextOpen + 6] ?? '')) {
        open += 1;
        scan = nextOpen;
        continue;
      }
      open -= 1;
      if (open === 0) break;
      scan = close;
      close = text.indexOf('</Sheet>', close + 1);
    }
    out.push({
      at: i,
      body: text.slice(end, close > 0 ? close : text.length),
      lifts: /\bavoidKeyboard\b/.test(props),
    });
    i = end;
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* ========================= a field can be a component away ================= */

/*
 * "Contains a `<TextInput>`" is not the same question as "is typed into", and
 * text-prompt-modal is the proof: its Sheet renders `<Body />`, and the field is
 * in `Body` — a separate component, defined below it, because only something
 * INSIDE the Sheet can call useSheetDismiss(). A lexical scan of that Sheet's
 * body finds no field at all. That file happens to pass avoidKeyboard anyway,
 * so nothing was broken; what was broken is the rule, which could not see it,
 * and would not have seen the next sheet written the same way.
 *
 * So a component whose own source holds a field is FIELD-BEARING, a component
 * that renders a field-bearing one is too, and that runs to a fixpoint. Then a
 * Sheet has a field if its body mentions any of them.
 */
const sources = files.map((file) => ({ file, text: code(readFileSync(file, 'utf8')) }));

/** Where each component in a file begins, so a field can be attributed to one. */
function componentsIn(text) {
  const found = [];
  const re = /(?:export\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*=)/g;
  for (const m of text.matchAll(re)) found.push({ name: m[1] ?? m[2], at: m.index });
  return found;
}

/** The component tags used inside a stretch of JSX. */
const tagsIn = (text) => [...text.matchAll(/<([A-Z][A-Za-z0-9_.]*)/g)].map((m) => m[1]);

/*
 * Resolved PER FILE, which both false positives taught.
 *
 * Resolving names globally flagged receipt-source-sheet, whose local helper is
 * also called `Body` and inherited text-prompt-modal's verdict by name alone;
 * and it flagged store-picker-sheet for rendering `<TextPromptModal>`, which is
 * a Sheet of its own and already lifts — a nested sheet answers for its own
 * fields, and blaming its parent asks the wrong component to move.
 *
 * A field reached through an IMPORT is therefore not counted. That is the
 * deliberate limit: the pattern this exists for is a helper next to the sheet
 * it serves, which is where it has to be (only something inside a <Sheet> can
 * call useSheetDismiss), and it is the shape a lexical scan misses.
 */
const fieldBearingByFile = new Map();
for (const { file, text } of sources) {
  const local = new Set();
  const parts = componentsIn(text);
  for (let round = 0; round < 6; round += 1) {
    const before = local.size;
    for (let i = 0; i < parts.length; i += 1) {
      const region = text.slice(parts[i].at, parts[i + 1]?.at ?? text.length);
      if (/<TextInput\b/.test(region) || tagsIn(region).some((t) => local.has(t))) {
        local.add(parts[i].name);
      }
    }
    if (local.size === before) break;
  }
  fieldBearingByFile.set(file, local);
}

/**
 * Whether a Sheet's children are typed into, directly or a component away.
 *
 * Nested sheets are cut out first: `<Sheet>` inside a `<Sheet>` is checked on
 * its own turn through the same loop, so leaving its body in would report the
 * outer one for a field the inner one already lifts for.
 */
function typedInto(body, local) {
  const own = body.replace(/<Sheet\b[\s\S]*?<\/Sheet>/g, ' ');
  return /<TextInput\b/.test(own) || tagsIn(own).some((t) => local.has(t));
}

/* ================================ 1. a sheet with a field must lift ======== */

const unlifted = [];
let sheetsSeen = 0;
let withField = 0;

for (const { file, text } of sources) {
  for (const sheet of sheets(text)) {
    sheetsSeen += 1;
    if (!typedInto(sheet.body, fieldBearingByFile.get(file) ?? new Set())) continue;
    withField += 1;
    if (sheet.lifts) continue;
    unlifted.push({ file: relative(ROOT, file), line: lineOf(text, sheet.at) });
  }
}

/*
 * The scan has to have found the real tree, or the assertion below passes by
 * blindness — a rename of the component, a change to how the tag is written, or
 * a broken walk each leave nothing to check and nothing to say so.
 *
 * Counted on sheets that CONTAIN A FIELD, not on sheets that lift. The first
 * version counted the lifting ones, which made this fire alongside the real
 * assertion on every mutation — a sanity check that fails whenever the thing it
 * is meant to be independent of fails is not telling anybody anything. What
 * matters here is that the body slicing works and the rule has subjects.
 */
assert(
  "the scan finds the app's sheets, and the fields in them",
  sheetsSeen >= 10 && withField >= 1,
  [
    `${sheetsSeen} <Sheet> tags, ${withField} of them containing a text field`,
    'Too few to be the real tree — the tag scanner or the body slicing has broken.',
  ],
);

assert(
  'every sheet with a text field lifts above the keyboard',
  unlifted.length === 0,
  unlifted
    .map((u) => `${u.file}:${u.line} <Sheet> contains a <TextInput> but has no avoidKeyboard`)
    .concat([
      'A bottom sheet sits exactly where the keyboard comes up, so the field',
      'being typed into is underneath it. Pass avoidKeyboard on the <Sheet>.',
    ]),
);

/* ============================ 2. and the card can shrink to what is left === */

/*
 * Asserted on purchase-sheet by name rather than swept, because it is the sheet
 * where the two interact: a pinned footer, a pixel cap taller than the room the
 * keyboard leaves, and a frosted surface that clips. Sweeping every capped card
 * in the app would be a different check with a different failure.
 */
const purchase = code(readFileSync(join(SRC, 'components', 'purchase-sheet.tsx'), 'utf8'));

assert(
  'the purchase card can shrink to the room the keyboard leaves',
  /sheet:\s*\{[^}]*flexShrink:\s*1/.test(purchase),
  [
    'styles.sheet has no flexShrink: 1, so the 85% cap cannot squeeze it and',
    "GlassView's overflow: hidden clips the footer — the Save button — away.",
  ],
);

assert(
  '...by yielding from the scrolling middle, not the pinned rows',
  /scrollArea:\s*\{[^}]*flexGrow:\s*0[^}]*flexShrink:\s*1/.test(purchase),
  [
    'styles.scrollArea needs flexGrow: 0 (a short form keeps its own height)',
    'AND flexShrink: 1 (a tall one gives way instead of pushing the footer out).',
  ],
);

/*
 * Both ways in reach the SAME sheet, which is why one prop fixed both. If a
 * second <PurchaseSheet> is ever mounted somewhere else, that stops being true
 * silently — the new one would simply not lift.
 */
const pantry = code(readFileSync(join(SRC, 'app', '(tabs)', 'pantry.tsx'), 'utf8'));
const mounted = files.reduce(
  (n, f) => n + (code(readFileSync(f, 'utf8')).match(/<PurchaseSheet\b/g) ?? []).length,
  0,
);
assert(
  'the + flow and "Add purchase" still share one purchase sheet',
  mounted === 1 && (pantry.match(/setRecording\(\{/g) ?? []).length >= 2,
  [
    `${mounted} <PurchaseSheet> mounted, ${(pantry.match(/setRecording\(\{/g) ?? []).length} entry points`,
    'Both routes must drive the one sheet, or fixing one leaves the other broken.',
  ],
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
