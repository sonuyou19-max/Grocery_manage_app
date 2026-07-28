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

## Gotcha: typed routes and a stale `.expo/types/router.d.ts`

`app.json` sets `experiments.typedRoutes: true`, which makes `router.push()`
accept only real routes. The route union is **generated** into
`.expo/types/router.d.ts` — and `.expo/` is gitignored, so it is per-machine and
not covered by a fresh clone.

The dev server writes that file on boot. A machine that pulls new screens and
runs `typecheck` **without** having started the dev server since then keeps an
old manifest, and typecheck fails on routes that are perfectly valid:

```
error TS2345: Argument of type '"/cards"' is not assignable to parameter of
type 'RelativePathString | ExternalPathString | "/legal" | ...'
```

That list is the manifest's idea of the routes, from before those screens
existed. Fix by regenerating:

```bash
cd apps/mobile
rm -rf .expo/types
pnpm --filter mobile start     # wait for "Waiting on http://localhost:8081"
                               # then Ctrl+C
```

Then typecheck again. Deleting `.expo/types` **without** regenerating also makes
typecheck pass, but for the wrong reason: with no manifest the route union is
never narrowed and `router.push()` stops being checked at all. Prefer
regenerating, so the check keeps its value.

This never blocks a build. EAS does not run `tsc`, and Metro strips types — a
stale manifest is a local type-checking artifact only.
