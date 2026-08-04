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
  'src/components/plus-badge.tsx',
  'src/components/create-sheet.tsx',
  // The only Plus feature with its own route, so the only one that can be
  // reached without passing the button that gates it.
  'src/app/recipe.tsx',
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

/* ------------------------- 4. a locked tap always goes somewhere */

/*
 * This check used to assert the OPPOSITE: that requirePlus() short-circuits on
 * billingAvailable() === false, on the reasoning that a paywall which cannot
 * take money reads as a broken app. Shipping it proved otherwise — on a build
 * with no store key, tapping Purchase History ran no action and showed no
 * prompt, which is indistinguishable from a crash.
 *
 * Worse, the check kept passing after the behaviour was removed, because it
 * only looked for the STRING `billingAvailable` and plus-gate.ts still explains
 * in a comment why it no longer calls it. A guard that a comment can satisfy is
 * not a guard. So this now asserts the real invariant — requirePlus navigates,
 * unconditionally — by requiring the router push and forbidding an early return
 * in front of it.
 */
const gate = files.find((f) => f.rel === 'src/lib/plus-gate.ts');
const requireBody = gate?.text.match(/const requirePlus = useCallback\(([\s\S]*?)\n  \}, \[/)?.[1];
if (!requireBody || !/router\.push\(['"]\/paywall['"]\)/.test(requireBody)) {
  fail('requirePlus() must always open the paywall', [
    'plus-gate.ts: could not find an unconditional router.push("/paywall") in requirePlus().',
    'A locked tap that runs no action is indistinguishable from a crash.',
  ]);
} else if (/\breturn\b/.test(requireBody)) {
  fail('requirePlus() must not bail out before navigating', [
    'plus-gate.ts: requirePlus() contains an early return. The paywall handles having',
    'no products to sell; silence does not.',
  ]);
} else {
  console.log('ok   requirePlus() always opens the paywall');
}

/* -------------------- 5. one description of Plus, and it is complete */

/*
 * There used to be two lists — one on the Plus card at the foot of Insights,
 * one on the paywall — kept in the same order by hand, and this check asserted
 * they matched. They had already drifted once: the recipe importer was named in
 * the Terms of Service as a paid feature while appearing in neither, so the app
 * was contractually selling something it never mentioned.
 *
 * Asserting that two lists agree is the weaker fix. There is now one list
 * (lib/plus-pillars.ts), the card is gone, and what needs guarding is different:
 * that every capability in it resolves to real copy, and that nothing quietly
 * falls out of the grouping. A feature moved into a pillar that no longer
 * renders would vanish with no test failing.
 */
const pillars = files.find((f) => f.rel === 'src/lib/plus-pillars.ts')?.text ?? null;
const en = readFileSync(join(SRC, 'i18n/locales/en.ts'), 'utf8');

if (!pillars) {
  fail('lib/plus-pillars.ts is missing', ['It is the only description of what Plus sells.']);
} else {
  const ids = [...pillars.matchAll(/id: '([^']+)' \}/g)].map((m) => m[1]);
  const pillarIds = [...pillars.matchAll(/^    id: '([^']+)',$/gm)].map((m) => m[1]);

  const orphans = ids.filter((id) => !en.includes(`${id}Title:`) || !en.includes(`${id}Body:`));
  const headless = pillarIds.filter(
    (id) => !en.includes(`${id}Title:`) || !en.includes(`${id}Kicker:`),
  );

  if (orphans.length || headless.length) {
    fail('every Plus capability and pillar needs copy', [
      ...orphans.map((id) => `plus.detail.${id}Title / ${id}Body missing from en.ts`),
      ...headless.map((id) => `plus.pillar.${id}Title / ${id}Kicker missing from en.ts`),
    ]);
  } else if (pillarIds.length !== 3) {
    fail('the carousel expects three pillars', [
      `Found ${pillarIds.length}: ${pillarIds.join(', ')}. The dots and the copy assume three.`,
    ]);
  } else {
    /*
     * The count is pinned because the Terms of Service enumerates what Plus
     * includes. Adding a capability here without adding it there — or the
     * reverse — is the exact divergence that started this check.
     */
    const TERMS_COUNT = 10;
    if (ids.length !== TERMS_COUNT) {
      fail('Plus must sell exactly what the Terms say it sells', [
        `lib/plus-pillars.ts lists ${ids.length} capabilities; legal/terms-of-service.md`,
        `and lib/legal.ts enumerate ${TERMS_COUNT}. Update both, or neither.`,
      ]);
    } else {
      console.log(`ok   ${ids.length} capabilities in 3 pillars, all with copy`);
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
