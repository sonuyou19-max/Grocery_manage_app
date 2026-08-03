/**
 * Plus gate coverage check.
 *
 * The rule for "is Korb Plus withholding something" is two terms —
 * `gateActive && !entitled` — and it is now needed on seven screens. Two terms
 * is short enough that every screen could just write it, which is exactly the
 * problem: this codebase has already shipped the same bug twice from precisely
 * that reasoning.
 *
 *   The plural rule was registered for Polish only, because "everything else
 *   uses the default one/other rule anyway". Six languages broke.
 *
 *   The category table held 55 English words while the emoji and unit tables
 *   held 646 across seven languages, because nobody re-checked that the three
 *   still agreed. 619 terms fell through to the AI.
 *
 * Both were duplicates that stopped agreeing quietly. So:
 *
 *   1. Only lib/plus-gate.ts may combine gateActive with entitled.
 *   2. Only lib/plus-gate.ts and the entitlement store may read `gateActive`
 *      at all — a screen reading it directly is one refactor away from
 *      rebuilding the rule by hand.
 *   3. Every screen that gates something must import usePlusGate, so a new
 *      gated surface cannot invent a third mechanism.
 *
 * Run with `pnpm --filter mobile check:plus-gate`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');

/** The two files allowed to know how the rule is built. */
const OWNERS = ['src/lib/plus-gate.ts', 'src/store/entitlement.tsx'];

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};

const files = sources(SRC).map((f) => ({
  path: f,
  rel: relative(ROOT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

/* --------------------------------- 1. nobody else rebuilds the rule */

/**
 * Any line mentioning both halves. Deliberately loose — `gateActive &&
 * !entitled`, `!entitled && gateActive`, and anything spelled across a ternary
 * all trip it. A false positive here costs one comment; a false negative costs
 * a screen that silently disagrees with the other six.
 */
const rebuilt = files.filter(
  (f) =>
    !OWNERS.includes(f.rel) &&
    f.text.split('\n').some((line) => /gateActive/.test(line) && /entitled/.test(line)),
);
if (rebuilt.length) {
  fail(
    'only lib/plus-gate.ts may combine gateActive with entitled',
    rebuilt.map((f) => `${f.rel} rebuilds the rule — use usePlusGate() instead`),
  );
} else {
  console.log('ok   the locked rule has exactly one definition');
}

/* ------------------------------- 2. gateActive is not read elsewhere */

const readsGate = files.filter((f) => !OWNERS.includes(f.rel) && /\bgateActive\b/.test(f.text));
if (readsGate.length) {
  fail(
    'gateActive is internal to the gate',
    readsGate.map((f) => `${f.rel} reads gateActive directly — read \`locked\` from usePlusGate()`),
  );
} else {
  console.log('ok   gateActive is read only by the gate and the store that fetches it');
}

/* ---------------------------- 3. gated screens go through the hook */

/**
 * Screens known to gate something. Listed explicitly rather than inferred,
 * because the failure this catches is a screen QUIETLY LOSING its gate during
 * an unrelated refactor — and something inferred from the file's own contents
 * would stop noticing at exactly that moment.
 */
const MUST_GATE = [
  'src/app/(tabs)/insights.tsx',
  'src/app/(tabs)/pantry.tsx',
  'src/app/(tabs)/index.tsx',
  'src/components/plus-card.tsx',
  'src/components/plus-badge.tsx',
];
const missing = MUST_GATE.filter((rel) => {
  const f = files.find((x) => x.rel === rel);
  return !f || !/usePlusGate/.test(f.text);
});
if (missing.length) {
  fail(
    'every gated screen must go through usePlusGate',
    missing.map((rel) => `${rel} no longer imports usePlusGate — was its gate removed?`),
  );
} else {
  console.log(`ok   all ${MUST_GATE.length} gated surfaces use the shared gate`);
}

/* ------------------------- 4. the paid tier is reachable to buy */

const gate = files.find((f) => f.rel === 'src/lib/plus-gate.ts');
if (!gate || !/billingAvailable/.test(gate.text)) {
  fail('the gate must not prompt when there is nothing to sell', [
    'plus-gate.ts should short-circuit requirePlus() on billingAvailable() === false,',
    'or every locked tap opens a paywall that cannot take money.',
  ]);
} else {
  console.log('ok   requirePlus() stays silent when billing is not configured');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
