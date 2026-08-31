#!/usr/bin/env node
/**
 * Run a check under several timezones.
 *
 * ---------------------------------------------------------------------------
 * Why this is a Node script and not a shell loop
 * ---------------------------------------------------------------------------
 *
 * It was a shell loop — `for tz in UTC …; do TZ=$tz node …; done` — written on
 * Linux, in package.json, three times. On Windows pnpm runs scripts through
 * cmd.exe, which does not have `for … in … do … done` and answers
 * `tz was unexpected at this time.`
 *
 * That is the same failure check-scripts-portable was written for and did not
 * catch, because it reads the .mjs files and nothing had ever looked at the
 * shell in package.json. Both halves are fixed: the loop moves here, and the
 * guard now reads package.json too.
 *
 * ---------------------------------------------------------------------------
 * What it asserts
 * ---------------------------------------------------------------------------
 *
 * That the check passes in EVERY zone, not just that it ran in each. The shell
 * version piped each run through `tail -1` and never looked at an exit code —
 * so a check that failed in Kiritimati printed `1 FAILURE(S)` in the middle of
 * the output and the command still succeeded. A green suite that contains a red
 * line is worse than a red suite.
 *
 * The zones are the argument, defaulted, because the three callers do not agree
 * on them and should not: list-sweep cares about Asia/Kolkata's half-hour
 * offset, the calendar cares about the two extremes.
 *
 *   node scripts/run-tz.mjs check-calendar.mjs [Zone/One Zone/Two …]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const [script, ...zones] = process.argv.slice(2);
if (!script) {
  console.error('usage: node scripts/run-tz.mjs <check-script.mjs> [zone …]');
  process.exit(2);
}

/*
 * Both extremes and the awkward middle. Kiritimati is +14 and Los Angeles is
 * -8, which is the widest gap a date can be read across; Brussels and Warsaw
 * observe DST, which is the case a duration in milliseconds gets wrong.
 */
const DEFAULT_ZONES = [
  'UTC',
  'Europe/Brussels',
  'Europe/Warsaw',
  'America/Los_Angeles',
  'Pacific/Kiritimati',
];

const list = zones.length > 0 ? zones : DEFAULT_ZONES;

let failed = 0;
for (const tz of list) {
  const run = spawnSync(process.execPath, [join(here, script)], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });

  // The last line of a check is its verdict — ALL PASS or the failure count.
  const lines = (run.stdout ?? '').trimEnd().split('\n');
  const verdict = lines[lines.length - 1] ?? '(no output)';
  const ok = run.status === 0;
  if (!ok) failed += 1;

  console.log(`${ok ? 'ok  ' : 'FAIL'} ${tz.padEnd(20)} ${verdict}`);
  // Only on failure, and all of it: a check that fails in one zone out of five
  // is the whole reason this exists, and the one line above is not enough to
  // act on.
  if (!ok) {
    for (const line of lines) console.log(`       ${line}`);
    if (run.stderr) console.log(run.stderr);
  }
}

console.log(
  failed === 0
    ? `\n${script} passes in all ${list.length} zones`
    : `\n${script} FAILS in ${failed} of ${list.length} zones`,
);
process.exit(failed === 0 ? 0 : 1);
