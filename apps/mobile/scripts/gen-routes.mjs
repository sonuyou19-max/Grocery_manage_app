/**
 * Regenerate the typed-routes declaration before typechecking.
 *
 * `app.json` sets `experiments.typedRoutes`, which narrows `router.push()` to
 * the app's real routes. That union lives in a GENERATED file,
 * `.expo/types/router.d.ts`, which is gitignored and therefore per-machine.
 *
 * Expo's dev server writes it on boot and keeps it fresh while running. That is
 * fine for someone with Metro open all day, and quietly broken for anyone who
 * pulls new screens and goes straight to `typecheck` — they keep a manifest
 * from before those screens existed, and typecheck fails on routes that are
 * perfectly valid:
 *
 *     error TS2345: Argument of type '"/get-started"' is not assignable to
 *     parameter of type 'RelativePathString | ... | "/legal" | ...'
 *
 * The error names the route it rejects but never says the type is the stale
 * part, so it reads as a typo in working code. It cost real time three separate
 * times before this script existed.
 *
 * `expo-router` exposes the same generator its dev server uses, so this runs it
 * directly — no Metro, no port, about a hundred milliseconds. `typecheck` calls
 * it first, which means the check can no longer disagree with the filesystem.
 *
 * Note this is NOT wired as a `pretypecheck` hook: pnpm has implicit pre/post
 * scripts off by default, so that hook would silently never run. It is chained
 * explicitly in the `typecheck` script instead.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// expo-router prefers src/app over app when both are absent/present; resolve it
// the same way rather than hardcoding, so moving the app dir doesn't silently
// regenerate an empty manifest.
const candidates = [join(root, 'src', 'app'), join(root, 'app')];
const appRoot = candidates.find((p) => existsSync(p));
if (!appRoot) {
  console.error('gen-routes: no app directory found at src/app or app');
  process.exit(1);
}

const outDir = join(root, '.expo', 'types');
mkdirSync(outDir, { recursive: true });

// The generator reads its context from this env var at import time, so it has
// to be set before the module is loaded — hence the dynamic import below.
process.env.EXPO_ROUTER_APP_ROOT = appRoot;

const { regenerateDeclarations } = await import('expo-router/build/typed-routes/index.js');
regenerateDeclarations(outDir);
