/**
 * Translation-key usage check.
 *
 * check-locales.mjs proves the seven locale files agree with each other. It
 * cannot prove that a key the CODE asks for exists at all — if en.ts and pl.ts
 * both lack `plus.perkHistory`, they agree perfectly, and the screen renders
 *
 *     [missing "en.plus.perkHistory" translation]
 *
 * That is not hypothetical. Rewriting the `plus` block to add the expanding
 * card renamed four keys, the paywall still called the old names, every locale
 * check passed, and the buy screen — the single screen where a broken string
 * costs money — would have shipped with four error strings on it.
 *
 * So this walks the source for `t('…')` calls and looks each one up in en.ts.
 *
 * ---------------------------------------------------------------------------
 * What it can and cannot see
 * ---------------------------------------------------------------------------
 *
 * Static keys — `t('plus.title')` — are checked exactly.
 *
 * Template keys — `t(`plus.detail.${p.id}Title`)` — cannot be resolved without
 * running the screen, so the STATIC PREFIX is checked instead: at least one key
 * must exist under `plus.detail`. That catches a whole namespace being renamed
 * or deleted, which is the failure that actually happens, while staying quiet
 * about the individual ids it cannot know.
 *
 * A prefix does not have to be a whole namespace. `t(`lists.vibeEmpty${n}Title`)`
 * has the static prefix `lists.vibeEmpty`, and the keys it reaches are flat —
 * `lists.vibeEmpty1Title` — so there is no `vibeEmpty` node to look up. Treating
 * that as a dead namespace was this check's own first false positive. So the
 * prefix passes if it resolves to a node OR if any flattened key starts with it.
 *
 * Run with `pnpm --filter mobile check:i18n-keys`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');

/** Load en.ts, the source of truth for what keys exist. */
function loadEnglish() {
  const js = ts.transpileModule(readFileSync(join(SRC, 'i18n', 'locales', 'en.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports.default;
}

const en = loadEnglish();

/** Does `a.b.c` resolve to anything in the catalog? */
const resolves = (key) =>
  key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), en) !== undefined;

/** Every leaf key in dotted form — `plus.detail.historyTitle`, `lists.vibeEmpty1Title`. */
const flatKeys = [];
(function flatten(node, path) {
  for (const [name, value] of Object.entries(node)) {
    const here = path ? `${path}.${name}` : name;
    if (value !== null && typeof value === 'object') flatten(value, here);
    else flatKeys.push(here);
  }
})(en, '');

/**
 * Is a template's static prefix pointing at anything real?
 *
 * Either it names a node (`plus.detail`) or it is the literal start of some
 * key (`lists.vibeEmpty` → `lists.vibeEmpty1Title`). Both mean the namespace
 * survived; only a prefix that matches nothing at all is a rename we missed.
 */
const prefixLives = (prefix) => resolves(prefix) || flatKeys.some((k) => k.startsWith(prefix));

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The locale files define keys; they do not consume them.
      if (entry === 'locales') continue;
      out.push(...sources(full));
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const staticKeys = new Map(); // key -> [locations]
const prefixes = new Map(); // prefix -> [locations]

for (const file of sources(SRC)) {
  const text = readFileSync(file, 'utf8');
  if (!/\bt\(/.test(text)) continue;
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    // `t(...)` and `i18n.t(...)`, first argument only.
    const isT =
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'));
    if (isT && node.arguments.length > 0) {
      const arg = node.arguments[0];
      const at = `${rel}:${source.getLineAndCharacterOfPosition(arg.getStart()).line + 1}`;

      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        if (!staticKeys.has(arg.text)) staticKeys.set(arg.text, []);
        staticKeys.get(arg.text).push(at);
      } else if (ts.isTemplateExpression(arg)) {
        // Everything before the first `${` — the part we can actually check.
        const prefix = arg.head.text.replace(/\.$/, '');
        if (prefix) {
          if (!prefixes.has(prefix)) prefixes.set(prefix, []);
          prefixes.get(prefix).push(at);
        }
      }
      // Anything else — a variable, a call — is unknowable here and skipped.
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

let failures = 0;
const fail = (title, lines) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines.slice(0, 20)) console.log(`  ${line}`);
  if (lines.length > 20) console.log(`  …and ${lines.length - 20} more`);
};

const missing = [...staticKeys.entries()].filter(([key]) => !resolves(key));
if (missing.length) {
  fail(
    'every t() key must exist in en.ts',
    missing.map(([key, at]) => `"${key}" — used at ${at.join(', ')} — is not defined`),
  );
} else {
  console.log(`ok   all ${staticKeys.size} static t() keys resolve`);
}

const deadPrefixes = [...prefixes.entries()].filter(([prefix]) => !prefixLives(prefix));
if (deadPrefixes.length) {
  fail(
    'every dynamic t(`prefix.${…}`) namespace must exist',
    deadPrefixes.map(
      ([prefix, at]) => `"${prefix}…" — used at ${at.join(', ')} — matches no key in en.ts`,
    ),
  );
} else if (prefixes.size) {
  console.log(`ok   all ${prefixes.size} dynamic key namespaces exist`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
