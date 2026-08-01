/**
 * Conditional-hook check.
 *
 * React requires every render of a component to call the same hooks in the same
 * order. A hook that sits BELOW an early `return` breaks that: on the render
 * where the guard fires, the hooks after it never run, and React throws
 * "Rendered more hooks than during the previous render" — a red screen, not a
 * warning.
 *
 * This is the third time that crash has shipped in this app (Insights, Pantry,
 * then the list detail screen), which is what this file is for. Every instance
 * had the same shape and the same reason it survived review: the guard is
 * usually a data guard — `if (!list) return`, `if (!session) return <Teaser/>` —
 * so it only fires in the state you do not have while you are developing. The
 * screen works on your machine, works in the simulator, and crashes for the
 * user who opened it a fraction of a second before the fetch landed.
 *
 * `eslint-plugin-react-hooks` catches most of this, but only where the rule is
 * actually enabled and only where its component heuristic fires; the three
 * crashes here all reached production regardless. This check is deliberately
 * cruder and non-negotiable: in a function whose name starts with a capital
 * letter, once a top-level `return` is reachable, nothing below it may call a
 * `use*` function.
 *
 * ---------------------------------------------------------------------------
 * The two ways to fix a hit
 * ---------------------------------------------------------------------------
 *
 *  1. **Move the hook up**, above the guard. Right when the hook is cheap and
 *     independent of the thing being guarded — `useAnimatedStyle` over a shared
 *     value, say. Its cost on the render that bails is a wasted allocation.
 *
 *  2. **Split the component in two**: a gate that decides, and a screen that
 *     assumes. Right when the hooks below the guard genuinely need the guarded
 *     value, because the gate then has no hooks to skip and the screen never
 *     runs without its data. This is what both teaser screens do.
 *
 * Never "fix" it by deleting the guard.
 *
 * Run with `pnpm --filter mobile check:hooks`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SRC = join(ROOT, 'src');

/** Every .ts/.tsx under src. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isHook = (name) => /^use[A-Z]/.test(name);

/**
 * Does this statement contain a `return` belonging to the component itself?
 *
 * Nested functions are skipped: a `return` inside a callback passed to
 * `.filter()` or a `useEffect` cleanup exits the callback, not the render, and
 * counting it would flag nearly every component in the app.
 */
function hasOwnReturn(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
  return found;
}

/**
 * Hook calls made by this statement, again ignoring nested functions.
 *
 * A hook inside a callback is not a render-time call — `onPress={() => ...}`
 * bodies do not run during render, and a `use*` helper called inside another
 * hook's callback is that hook's business. Only the component's own top-level
 * calls affect its hook order.
 */
function ownHookCalls(node) {
  const names = new Set();
  const walk = (n) => {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && isHook(n.expression.text)) {
      names.add(n.expression.text);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return [...names];
}

let failures = 0;

/** Walk one component body's top-level statements in order. */
function inspect(body, componentName, file, source) {
  if (!body || !ts.isBlock(body)) return;
  let guard = null;
  for (const stmt of body.statements) {
    if (guard === null) {
      // A bare `return`, or an `if` whose body can return. Both make everything
      // below them conditional.
      if (ts.isReturnStatement(stmt) || (ts.isIfStatement(stmt) && hasOwnReturn(stmt))) {
        guard = stmt;
      }
      continue;
    }
    const hooks = ownHookCalls(stmt);
    if (hooks.length === 0) continue;
    const line = (n) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    failures += 1;
    console.log(
      `FAIL ${relative(ROOT, file)}:${line(stmt)}\n` +
        `  ${componentName} calls ${hooks.join(', ')} below the early return on line ${line(guard)}.\n` +
        `  Move the hook above the guard, or split the component into a gate and a screen.`,
    );
    // One report per component: the first hook below the guard is the bug, and
    // the rest are the same bug restated.
    return;
  }
}

for (const file of sources(SRC)) {
  const text = readFileSync(file, 'utf8');
  // Cheap bail — most files have no hooks at all.
  if (!/\buse[A-Z]/.test(text)) continue;

  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    // `function Thing() {}` — including `export default function`.
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
      inspect(node.body, node.name.text, file, source);
    }
    // `const Thing = () => {}`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^[A-Z]/.test(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      inspect(node.initializer.body, node.name.text, file, source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (failures === 0) console.log('ok   no hook is called below an early return');
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
