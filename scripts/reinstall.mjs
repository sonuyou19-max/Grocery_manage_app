#!/usr/bin/env node
/**
 * Delete every node_modules in the workspace and install again.
 *
 * ---------------------------------------------------------------------------
 * Why this needs a script rather than a line of documentation
 * ---------------------------------------------------------------------------
 *
 * `.npmrc` sets `node-linker=hoisted`, because React Native's Metro needs a
 * flat node_modules and cannot follow pnpm's symlinked layout. A flat tree is
 * not a set of links pnpm can re-point: changing a version means DELETING a
 * directory and writing another one in its place.
 *
 * On Windows a locked file makes that removal fail — a Metro still running in
 * another terminal, an editor with a file open, a virus scanner mid-read. pnpm
 * reports success for everything it did manage, and the tree is left as a mix
 * of two installs. Nothing says so. The first symptom is a module resolving to
 * a version nobody asked for, from a stack ten frames inside a bundler:
 *
 *     Error: Cannot find module 'image-size'
 *     - node_modules\@expo\metro\node_modules\metro\src\Assets.js
 *
 * That is not a missing dependency. It is an old metro, left behind by an
 * install that could not remove it, reaching for something the version in the
 * lockfile does not use. Nothing in package.json, the lockfile, or the error
 * points at the actual fault.
 *
 * ---------------------------------------------------------------------------
 * And why it is not `rm -rf node_modules && pnpm install`
 * ---------------------------------------------------------------------------
 *
 * Three reasons, and the repo has been bitten by the first one already.
 *
 *   `rm -rf` IS NOT A COMMAND ON WINDOWS. pnpm runs scripts through cmd.exe,
 *   which has neither `rm` nor `-rf`. A shell loop in package.json is what
 *   produced `tz was unexpected at this time.` — see scripts/run-tz.mjs, and
 *   check-scripts-portable, which exists because of it.
 *
 *   THERE ARE FOUR TREES, not one. The root, apps/mobile, packages/shared, and
 *   whatever else the workspace grows. Removing only the one you are standing
 *   in leaves the mix that caused the problem.
 *
 *   A FAILED DELETE HAS TO BE LOUD. Node's `rm` retries EBUSY and EPERM, which
 *   covers a scanner holding a handle for a moment; it does not cover a Metro
 *   that is still running. When a directory survives, that is the whole answer
 *   and it gets said in those words, rather than being handed to `pnpm install`
 *   to rebuild half of.
 *
 * Metro's own transform cache is a separate staleness and lives outside this
 * tree, so a reinstall does not clear it — start with `npx expo start -c` once
 * afterwards.
 *
 *   pnpm reinstall
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Every workspace package, read off the directories rather than parsed out of
 * pnpm-workspace.yaml. The globs there are `apps/*` and `packages/*`, and a
 * YAML parser to learn that would be a dependency for something two readdirs
 * answer — and one that could disagree with the filesystem, which is precisely
 * the failure mode being cleaned up.
 */
const trees = [ROOT];
for (const group of ['apps', 'packages']) {
  const dir = join(ROOT, group);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) trees.push(join(dir, entry.name));
  }
}

const stuck = [];
for (const tree of trees) {
  for (const name of ['node_modules', '.expo']) {
    const target = join(tree, name);
    if (!existsSync(target)) continue;
    try {
      // maxRetries/retryDelay are Node's own answer to Windows holding a
      // handle for a moment. They do not help against a process that has one
      // open for good, which is the case worth reporting.
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.log(`removed  ${target.slice(ROOT.length + 1) || name}`);
    } catch (err) {
      stuck.push([target, err instanceof Error ? err.message : String(err)]);
    }
  }
}

if (stuck.length > 0) {
  console.error('\nCould not remove:');
  for (const [target, message] of stuck) console.error(`  ${target}\n    ${message}`);
  console.error(
    '\nSomething is holding those files open. Almost always a Metro bundler\n' +
      'still running in another terminal — stop it (Ctrl+C there, or\n' +
      '`taskkill /F /IM node.exe` on Windows) and run this again.\n' +
      '\nInstalling on top of a tree that could not be cleared is how the two\n' +
      'installs get mixed in the first place, so this stops here instead.',
  );
  process.exit(1);
}

console.log('\npnpm install\n');
/*
 * shell:true because on Windows `pnpm` is `pnpm.cmd`, and spawn without a
 * shell will not find it. No part of this command comes from anywhere but this
 * file, so there is nothing for a shell to interpret that was not written here.
 */
const install = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
if (install.status !== 0) process.exit(install.status ?? 1);

console.log(
  '\nDone. Metro keeps its own transform cache outside node_modules, so start\n' +
    'once with `npx expo start -c` to clear that too.',
);
