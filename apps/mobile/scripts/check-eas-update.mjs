/*
 * An over-the-air update has to be publishable from wherever you are standing.
 *
 * ---------------------------------------------------------------------------
 * The failure this exists for
 * ---------------------------------------------------------------------------
 *
 * `npx eas update --branch preview` was run from the workspace root instead of
 * from apps/mobile. EAS reads the package.json in the current directory to
 * decide whether the project has the native modules it needs, found no
 * `expo-updates` in the ROOT manifest — where it correctly does not belong —
 * and tried to install it:
 *
 *     > pnpm add expo-updates@~57.0.21
 *     ERR_PNPM_ADDING_TO_ROOT  Running this command will add the dependency to
 *     the workspace root, which might not be what you want
 *
 * pnpm refused, expo-cli treated the refusal as fatal, and the publish died.
 * Nothing was wrong with the app: the command was one directory too high.
 *
 * The error is a bad teacher, which is the reason this is guarded rather than
 * remembered. It names `expo-updates` and a pnpm flag, so the obvious readings
 * are "the dependency is missing" and "pass -w" — and both are wrong. Adding
 * expo-updates to the root manifest would make the message go away by moving an
 * app's native module into a manifest that builds nothing, and the next person
 * to run `pnpm install` would inherit it.
 *
 * ---------------------------------------------------------------------------
 * So the fix is a script, and this checks the script still works
 * ---------------------------------------------------------------------------
 *
 * `pnpm run update:preview` exists in both manifests and cds where it has to.
 * That removes the trap rather than documenting it. What follows asserts the
 * handful of facts that script quietly depends on — the ones that would turn it
 * back into the same forty-second detour if any of them drifted.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(HERE, '..');
const ROOT = join(MOBILE, '..', '..');

const read = (...p) => readFileSync(join(...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected)}`);
    console.log(`       actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const rootPkg = json(ROOT, 'package.json');
const mobilePkg = json(MOBILE, 'package.json');
const app = json(MOBILE, 'app.json').expo;
const eas = json(MOBILE, 'eas.json');

/* ------------------------------------------------------------------------- */
/* The dependency lives in the app, and only in the app                       */
/* ------------------------------------------------------------------------- */

check(
  'the app declares expo-updates',
  mobilePkg.dependencies?.['expo-updates'] != null,
  true,
);

/*
 * The other half, and the one that is actually load-bearing. This is the
 * condition that produced the error — and the tempting way to silence it is to
 * put expo-updates here, which is why it is asserted as an absence.
 *
 * The root manifest builds no app. A native module in it is installed for
 * everybody, pinned by nobody, and invisible to the Expo SDK version check that
 * keeps apps/mobile's copy in step with `expo`.
 */
for (const field of ['dependencies', 'devDependencies']) {
  check(
    `...and the workspace root does not (${field})`,
    rootPkg[field]?.['expo-updates'] ?? null,
    null,
  );
}

/* ------------------------------------------------------------------------- */
/* Both manifests can publish, and the root one goes to the app first         */
/* ------------------------------------------------------------------------- */

for (const channel of ['preview', 'production']) {
  const name = `update:${channel}`;

  const inApp = mobilePkg.scripts?.[name] ?? '';
  check(`the app can publish to ${channel}`, /\beas update\b/.test(inApp), true);
  check(`...on that branch`, new RegExp(`--branch ${channel}\\b`).test(inApp), true);

  const atRoot = rootPkg.scripts?.[name] ?? '';
  check(`the root can publish to ${channel}`, /\beas update\b/.test(atRoot), true);

  /*
   * The whole point of the root script. Running eas from the workspace root is
   * the original bug, so a root script that forgot the cd would reproduce it
   * under a name that promises it is safe — worse than not having the script.
   */
  check(
    `...by changing into the app first, which is the entire point`,
    atRoot.indexOf('cd apps/mobile') === 0 && atRoot.indexOf('eas update') > 0,
    true,
  );
}

/*
 * Every channel a build profile ships on needs somewhere to publish from. A
 * profile added without its script is a build nobody can update without
 * rediscovering the command — and the command is the thing that goes wrong.
 */
{
  const channels = [
    ...new Set(
      Object.values(eas.build ?? {})
        .map((profile) => profile.channel)
        .filter((c) => typeof c === 'string'),
    ),
  ].sort();
  const scripted = channels.filter((c) => rootPkg.scripts?.[`update:${c}`] != null);
  check(
    `every build channel has a publish script (${scripted.length}/${channels.length})`,
    channels.length >= 1 && scripted.length === channels.length,
    true,
  );
}

/* ------------------------------------------------------------------------- */
/* And the update has an address and a runtime to match against               */
/* ------------------------------------------------------------------------- */

/*
 * Without these the publish succeeds and the phone never asks for it — the
 * worst shape of failure available here, because the terminal says it worked.
 */
check('updates have a URL to be fetched from', typeof app.updates?.url, 'string');
check('...and a runtime version to be matched against', app.runtimeVersion != null, true);

/*
 * `appVersion` means the runtime version IS `expo.version`, so a bundle only
 * reaches a build made from the same version string. Asserted because the
 * policy decides who receives a publish, and changing it silently re-partitions
 * every installed build — a stale phone that stops updating looks like a broken
 * app, not a changed config.
 */
check('...from the app version, so a bundle matches the build it was cut for', app.runtimeVersion, {
  policy: 'appVersion',
});

/* ------------------------------------------------------------------------- */
/* The runbook tells you the same thing this file enforces                    */
/* ------------------------------------------------------------------------- */

/*
 * Fenced commands only. The prose around them discusses `eas update` in order
 * to explain why not to run it that way, and holding prose to the shape of a
 * runnable command is how a guard starts failing for style.
 *
 * Two rules. Nothing anyone can COPY may run eas from the wrong place — today
 * that holds vacuously, since the fences all reach for the script, and it is
 * written as a never so the first hand-pasted command trips it. And the runbook
 * has to actually name the script, which is the assertion with content: a
 * runbook that stops mentioning it sends the next person back to the command
 * this whole file exists to keep them away from.
 */
{
  const runbook = read(ROOT, 'docs', 'RELEASE.md');
  const fenced = [...runbook.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) =>
    m[1].split('\n'),
  );
  const rooted = fenced.filter(
    (line) => /\beas update\b/.test(line) && !line.includes('cd apps/mobile'),
  );
  check('no pasteable eas update runs from the workspace root', rooted, []);

  const scripted = fenced.filter((line) => /\bpnpm run update:\w+/.test(line));
  check('...because the runbook hands you the script instead', scripted.length >= 1, true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
