# Korb mobile app

Expo SDK 54 / React Native. Run everything with `pnpm` from the **repo root**
(this is a pnpm workspace with `node-linker=hoisted`; npm produces a tree Expo
cannot resolve, which shows up much later as `expo config --json exited with
non-zero code: 1`).

```bash
pnpm install                          # repo root
pnpm --filter mobile start            # dev server
pnpm --filter mobile typecheck
```

## Before a build: the pre-flight gate

One command runs all eight and stops at the first failure:

```bash
pnpm --filter mobile check:all
```

Individually, if you want to see which is which:

```bash
pnpm --filter mobile typecheck
pnpm --filter mobile check:locales        # 7 locales in parity, placeholders intact
pnpm --filter mobile check:barcode        # loyalty-card symbologies round-trip
pnpm --filter mobile check:purchase-log   # week bucketing + price trends
pnpm --filter mobile check:pantry-intel   # interval precedence, staples, resting
pnpm --filter mobile check:item-emoji     # emoji in 7 languages, keys reachable
pnpm --filter mobile check:lexicon        # both fold() impls agree; share gates
pnpm --filter mobile check:motion         # rubber-band curve, spring presets
```

Then, from `apps/mobile`:

```bash
eas build --profile preview --platform android
```

`preview` builds an installable APK (not an AAB) with Sentry upload disabled.

## Typed routes: generated, and regenerated for you

`app.json` sets `experiments.typedRoutes: true`, which narrows `router.push()`
to the app's real routes. That union lives in a **generated** file,
`.expo/types/router.d.ts`, which is gitignored and therefore per-machine.

Expo's dev server writes it on boot. That leaves anyone who pulls new screens
and goes straight to `typecheck` holding a manifest from before those screens
existed — and typecheck then fails on routes that are perfectly valid:

```
error TS2345: Argument of type '"/get-started"' is not assignable to
parameter of type 'RelativePathString | ... | "/legal" | ...'
```

The error names the route it rejects but never says the *type* is the stale
part, so it reads as a typo in working code.

`typecheck` now regenerates the manifest first (`scripts/gen-routes.mjs`, which
calls the same generator the dev server uses — no Metro, ~100ms), so this cannot
happen. Run it alone with `pnpm --filter mobile gen:routes` if you ever want to.

Do **not** "fix" a route error by deleting `.expo/types`. Typecheck will pass,
but for the wrong reason: with no manifest the union is never narrowed and route
strings stop being checked at all.

A stale manifest never blocked a build in any case — EAS does not run `tsc`, and
Metro strips types.
