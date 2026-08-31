#!/usr/bin/env node
/**
 * Nobody waits on a request with no way to tell it is being waited on.
 *
 * ---------------------------------------------------------------------------
 * The failure this closes
 * ---------------------------------------------------------------------------
 *
 * The approval gate shipped with a silence attached: a requester saw "waiting
 * to be let in" and nothing else, ever, and could not distinguish four
 * completely different situations — wrong code, broken app, seen and ignored,
 * or nobody has opened Korb since. That is the specific way an approval step
 * ends up WORSE than none. The old behaviour let anyone in with a code, which
 * was too permissive, but it never stranded anybody.
 *
 * ---------------------------------------------------------------------------
 * What has to hold, and why none of it is visible from the app
 * ---------------------------------------------------------------------------
 *
 *   1. THE NOTIFY ENDPOINT IS NOT AN OPEN RELAY. The obvious shape — the client
 *      naming recipients and text — would let any account push arbitrary words
 *      to anybody they could name. Recipients are derived server-side from the
 *      request id and the caller's own verified token, and a bug there looks
 *      exactly like the feature working.
 *
 *   2. IT SENDS ONCE. The client triggers it, and clients retry, background and
 *      get double-tapped. Without the stamps a housemate gets buzzed four times
 *      for one request.
 *
 *   3. THE PERMISSION IS ASKED AT THE RIGHT MOMENT. On launch it is refused
 *      once and permanently, and no code change afterwards can undo that for
 *      the people it happened to.
 *
 *   4. THE TWO COPIES OF THE FORTNIGHT AGREE. The TTL lives in SQL and is
 *      mirrored in the client so a card can say "lapsed" without a round trip.
 *      Drift means a request the server has cleared still showing as live.
 *
 * Run with `pnpm --filter mobile check:join-signals`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const REPO = join(here, '..', '..', '..');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, detail) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  if (detail) console.log(`  ${detail}`);
};
const assert = (what, cond, detail) => (cond ? ok(what) : fail(what, detail));

// Comments stripped everywhere, once. This repo's most repeated guard bug, and
// these files explain themselves at length — an assertion matching the prose
// about a rule is not an assertion about the rule.
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sqlOnly = (t) => t.replace(/^\s*--.*$/gm, '');

const sql = sqlOnly(
  readFileSync(join(REPO, 'supabase', 'migrations', '0043_join_signals.sql'), 'utf8'),
);
const fn = code(
  readFileSync(join(REPO, 'supabase', 'functions', 'notify-join', 'index.ts'), 'utf8'),
);
const push = code(readFileSync(join(SRC, 'lib', 'push.ts'), 'utf8'));
const store = code(readFileSync(join(SRC, 'store', 'household.tsx'), 'utf8'));
const waiting = code(readFileSync(join(SRC, 'components', 'pending-joins.tsx'), 'utf8'));
const queue = code(readFileSync(join(SRC, 'components', 'join-requests.tsx'), 'utf8'));

/* ================================ 1. the endpoint is not an open relay === */

/*
 * Asserted by ENUMERATING what is read off the request body, not by naming the
 * one field that would be wrong.
 *
 * The first version banned `userIds` and passed against a function that read
 * `(body as any)?.userIds` — a spelling the pattern did not anticipate, which
 * is the whole problem with blacklisting a shape. Found by mutation, on the
 * single most important assertion in this file.
 *
 * Reading exactly one field is the property. Anything the caller could add is
 * something the server would have to decide whether to trust.
 */
const bodyReads = [...fn.matchAll(/body[\s\S]{0,20}?\?\.\s*([A-Za-z_]+)/g)].map((m) => m[1]);
assert(
  'the client names a request, never a recipient',
  bodyReads.length > 0 && bodyReads.every((f) => f === 'requestId'),
  `the request body is read for: ${[...new Set(bodyReads)].join(', ') || 'nothing'} — only requestId may be`,
);
/*
 * VERIFIED, not decoded. Elsewhere in this codebase a token is read for a rate
 * limit bucket, where a forged `sub` buys nothing. Here it decides whose
 * household can be pushed into.
 */
assert(
  'the caller is verified against Supabase',
  /auth\.getUser\(jwt\)/.test(fn),
  'decoding the JWT would let a forged sub send into a household it is not in',
);
assert(
  '...and an unverifiable caller sends nothing',
  /const uid = await callerId\(req\);\s*if \(!uid\) return done\(\);/.test(fn),
);

/*
 * The two pairings, and only these two: a pending request may be announced by
 * the person who made it, a decision by an owner of that household. Anything
 * else is somebody sending on a stranger's behalf.
 */
assert(
  'only the requester announces their own request',
  /row\.user_id !== uid \|\| row\.asked_notified_at != null/.test(fn),
);
assert(
  'only an owner announces a decision',
  /\(mine as \{ role\?: string \} \| null\)\?\.role !== 'owner'/.test(fn),
);
assert(
  '...and the owner check is of THIS request’s household',
  /\.eq\('household_id', row\.household_id\)\s*\.eq\('user_id', uid\)/.test(fn),
  'checking any household would let an owner of one push into another',
);

/*
 * The token table is write-only from the client. Nothing in the app has a
 * reason to read it, and a readable one is a list of everybody's push
 * addresses one policy mistake from being public.
 */
const tokenPolicies = sql.match(/create policy "own device tokens[^"]*"[\s\S]*?;/g) ?? [];
assert('device tokens carry their own policies', tokenPolicies.length === 3);
assert(
  '...and none of them is a read',
  !tokenPolicies.some((p) => /for select/.test(p)),
  'the send path uses the service role, which is the only thing that should',
);
assert('...with row-level security on', /alter table device_tokens enable row level security/.test(sql));
assert(
  '...and a client may only write its own',
  (sql.match(/user_id = auth\.uid\(\)/g) ?? []).length >= 4,
);

/* ============================================== 2. it sends exactly once = */

/*
 * Both halves asserted, and the presence half first.
 *
 * `indexOf(...) < indexOf(...)` is vacuously true when the left side is
 * MISSING — it is -1, and -1 is less than everything. So deleting the stamp
 * outright passed an assertion whose entire purpose is that the stamp happens.
 * Found by mutation; the same shape as the crash-instead-of-fail hole in
 * check-receipt-archive.
 */
const order = (what, before, after, detail) => {
  const a = fn.indexOf(before);
  const b = fn.indexOf(after);
  assert(what, a >= 0 && b >= 0 && a < b, a < 0 ? `\`${before}\` is not there at all` : detail);
};
order(
  'the ask is stamped before it is sent',
  'asked_notified_at: new Date().toISOString()',
  'copy.asked',
  'stamping after the send loses idempotency on every retry, which is the failure people notice',
);
order(
  'the decision is stamped before it is sent',
  'decided_notified_at: new Date().toISOString()',
  'copy.approved',
);
assert(
  'a second attempt at a decision sends nothing',
  /if \(row\.decided_notified_at != null\) return done\(\);/.test(fn),
);
assert(
  'both stamps exist in the schema',
  /add column if not exists asked_notified_at timestamptz/.test(sql) &&
    /decided_notified_at timestamptz/.test(sql),
);

/*
 * Every path answers 200. The join has already happened; this is a courtesy on
 * top of it, and an error here would turn "your housemate will not get a buzz"
 * into "joining failed".
 */
assert('nothing here reports failure to the client', !/status: [45]\d\d/.test(fn));
assert(
  '...and the client cannot surface one either',
  /void supabase\.functions\.invoke\('notify-join'[\s\S]{0,80}?\.catch\(\(\) => \{\}\)/.test(push),
);

/* ================================ 3. the permission is asked in context == */

/*
 * NOT ON LAUNCH. A prompt on first open has no context — nothing has happened
 * that a notification could be about — and it is refused once, permanently.
 * iOS never asks again. It is asked at the two moments where the answer is
 * self-evident: you made a household, or you asked to join one.
 */
assert(
  'creating a household asks',
  /if \(created\?\.id\) adoptHousehold\(created\);[\s\S]{0,200}?registerForPush\(language\)/.test(store),
);
assert(
  'asking to join asks',
  /nudgeJoin\(row\.request_id\);\s*void registerForPush\(language\)/.test(store),
);
const layout = code(readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8'));
const boot = code(readFileSync(join(SRC, 'components', 'boot-gate.tsx'), 'utf8'));
assert(
  '...and nothing asks on launch',
  !/registerForPush/.test(layout) && !/registerForPush/.test(boot),
  'a prompt with no context is refused once and permanently',
);
/*
 * THE NATIVE MODULE IS NEVER IMPORTED AT MODULE SCOPE.
 *
 * expo-notifications is native, and this app ships JavaScript over the air —
 * so there is always a window where a new bundle runs on an older binary that
 * does not contain it. A top-level import there does not degrade, it throws
 * while the module graph is still evaluating, and this file is reached from the
 * household store, which is in the provider tree. The app fails to open.
 *
 * A feature that cannot work on an old binary is fine. One that stops the old
 * binary from starting is not — and it would take every other fix in the same
 * update down with it.
 */
assert(
  'the native module is required lazily, never imported',
  !/^import .*from 'expo-notifications'/m.test(push) &&
    /require\('expo-notifications'\)/.test(push),
  'a top-level import throws on any binary built before push existed',
);
assert(
  '...inside a try, so an absent module is null rather than a crash',
  /try \{[\s\S]{0,400}?require\('expo-notifications'\)[\s\S]{0,600}?\} catch \{\s*loaded = null;/.test(push),
);
assert(
  '...and every entry point checks before using it',
  /const Notifications = notifications\(\);\s*[\s\S]{0,200}?if \(!Notifications\) return;/.test(push),
);
/*
 * Including the handler. Setting it at module scope is the specific line that
 * would run on an old binary, and it is the one thing here with no caller to
 * guard it.
 */
assert(
  'the notification handler is set after the module loads, not at import',
  !/^Notifications\.setNotificationHandler/m.test(push) &&
    /mod\.setNotificationHandler/.test(push),
);

assert(
  'a previous refusal is not asked again',
  /existing\.canAskAgain/.test(push),
  'requestPermissions after a refusal is a no-op that looks like a bug',
);
assert(
  'the entitled state is never assumed',
  /if \(!granted\) return;/.test(push),
);
/*
 * A device that never joins a household never needs the Android channel, and
 * creating one at launch would be the same context-free presumption as the
 * prompt.
 */
assert('the Android channel is created on the same path', /setNotificationChannelAsync/.test(push));

/* ======================================== 4. one fortnight, two spellings = */

const ttlSql = /select interval '(\d+) days'/.exec(sql)?.[1];
const ttlClient = /JOIN_TTL_MS = (\d+) \* 24 \* 60 \* 60 \* 1000/.exec(store)?.[1];
assert('the TTL is declared in SQL', ttlSql != null);
assert('...and mirrored in the client', ttlClient != null);
assert(
  '...and the two agree',
  ttlSql === ttlClient,
  `SQL says ${ttlSql} days, the client says ${ttlClient}`,
);

/*
 * The stale row is cleared where it would actually block something — asking
 * again — and nowhere else. Scoped to the caller's own row, in this household,
 * genuinely past the TTL. A delete that reached a live request, or somebody
 * else's, would be this feature quietly cancelling requests.
 */
const clearing = /delete from household_join_requests[\s\S]*?;/.exec(sql)?.[0] ?? '';
assert('a lapsed request is cleared before a new one', clearing.length > 0);
assert('...only the caller’s own', /user_id = auth\.uid\(\)/.test(clearing));
assert('...only in this household', /household_id = h\.id/.test(clearing));
assert('...only if pending', /status = 'pending'/.test(clearing));
assert(
  '...and only once it is genuinely past the TTL',
  /created_at < now\(\) - join_request_ttl\(\)/.test(clearing),
  'without the age test this deletes the live request it is about to replace',
);

/* ============================================= what the two cards now say = */

/*
 * Four situations, three sentences, where there used to be one. This is the
 * whole user-facing point of the migration.
 */
for (const [what, key] of [
  ['nobody has opened the app', 'join.waitingUnseen'],
  ['somebody has looked', 'join.waitingSeen'],
  ['it ran out', 'join.lapsed'],
]) {
  assert(`the waiting card can say ${what}`, new RegExp(`'${key}'`).test(waiting));
}
assert(
  '...and no longer says one thing for all of them',
  !/join\.waitingBody/.test(waiting),
);

/*
 * SEEN is stamped by an owner having the queue on screen, which until push is
 * granted is the only signal a requester gets at all. Owners only — enforced in
 * the RPC, not in the component, because a member glancing at the card is not
 * the event being reported.
 */
assert('the queue reports having been seen', /markRequestsSeen\(id\)/.test(queue));
const seenFn = /create or replace function mark_join_requests_seen[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? '';
assert('the stamp is owner-only, in the function', /role = 'owner'/.test(seenFn));
assert(
  '...and silent for a member rather than an error',
  /\) then\s*return;\s*end if;/.test(seenFn),
  'a member reading the queue is doing something legitimate',
);
assert(
  '...and records the FIRST sighting only',
  /seen_at is null/.test(seenFn),
  'refreshing it daily would read to the requester as a decision being made repeatedly',
);

/*
 * A lapsed request leaves the owner's queue. It is no longer answerable, and a
 * card still offering Approve would let an owner admit somebody who has been
 * told their request expired.
 */
assert(
  'lapsed requests leave the owner’s queue',
  /r\.user_id !== \(user\?\.id \?\? ''\) && !r\.lapsed/.test(store),
);

/* ================================================== the copy, in seven === */

/*
 * The one place in the product where user-facing text lives on the server: a
 * notification is composed after the app that would translate it has closed.
 * A missing language falls back to English silently, and nobody who reads
 * English will ever see it happen — so it is asserted rather than noticed.
 */
const langs = [...readFileSync(join(SRC, 'i18n', 'languages.ts'), 'utf8')
  .matchAll(/\{ code: '([a-z]{2})'/g)].map((m) => m[1]);
assert('the shipped languages are findable', langs.length >= 7);
const missing = langs.filter((l) => !new RegExp(`^  ${l}: \\{`, 'm').test(fn));
assert(
  'every shipped language has notification copy',
  missing.length === 0,
  `missing: ${missing.join(', ')}`,
);
assert(
  'the copy is chosen per DEVICE, not per sender',
  /copyFor\(d\.language\)/.test(fn),
  'a German owner approving a French housemate is one send and two languages',
);
assert(
  '...and the language travels with the token',
  /language text/.test(sql) && /language,\n/.test(push),
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
