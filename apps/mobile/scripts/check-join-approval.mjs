#!/usr/bin/env node
/**
 * Getting into a household is now somebody's decision.
 *
 * ---------------------------------------------------------------------------
 * What the invite code used to be
 * ---------------------------------------------------------------------------
 *
 * A key. Anyone holding it walked in — and once inside they can read every
 * list, every price and the whole purchase history of everybody in that
 * household. A code travels: in a message, in a screenshot, over a shoulder,
 * through a phone that changes hands. There was no second step and no record
 * that anybody had used it until you went looking at the member list.
 *
 * So it is an introduction now. It says WHICH household you are asking about;
 * the owner says whether you come in.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * Every rule below is invisible from inside the app. A bypass does not look
 * like a bug — it looks like joining working nicely — and the person who would
 * notice is the one who never saw the request. Three specific ways it could
 * quietly stop being an approval gate at all:
 *
 *   1. THE OLD DOOR LEFT OPEN. join_household created a membership from a code
 *      alone. Left callable, any older build walks straight past the gate.
 *
 *   2. THE INVITE CODE HANDED TO A PENDING REQUESTER. The natural thing to
 *      return from "ask to join" is the households row, and that row carries
 *      `invite_code` — which would give somebody who has NOT been approved the
 *      one credential the whole feature exists to devalue, plus the ability to
 *      pass it on.
 *
 *   3. A CLIENT-SIDE OWNER CHECK. Drawing the Approve button only for owners is
 *      cosmetics. If the RPC does not check ownership itself, any member can
 *      admit anybody by calling it.
 *
 * Run with `pnpm --filter mobile check:join-approval`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const MIGRATIONS = join(here, '..', '..', '..', 'supabase', 'migrations');

let failures = 0;
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what, detail) => {
  failures += 1;
  console.log(`FAIL ${what}`);
  if (detail) console.log(`  ${detail}`);
};
const assert = (what, cond, detail) => (cond ? ok(what) : fail(what, detail));

const rawSql = readFileSync(join(MIGRATIONS, '0042_join_requests.sql'), 'utf8');
/*
 * Comments stripped before anything is matched.
 *
 * This repo's single most repeated guard bug, and it bit here on the first run:
 * the counting assertion below found `invite_code` three times and failed,
 * because two of them are in the prose explaining why the column must not
 * escape. A well-commented migration is exactly the migration where this
 * happens, and an assertion that matches the reasoning ABOUT the code is not an
 * assertion about the code.
 */
const sql = rawSql.replace(/^\s*--.*$/gm, '');
const fnBody = (name) => {
  const m = new RegExp(
    `create or replace function ${name}\\([\\s\\S]*?\\n\\$\\$;`,
  ).exec(sql);
  return m?.[0] ?? '';
};

/* ------------------------------------------- 1. the old door is closed ---- */

const oldJoin = fnBody('join_household');
assert('the old join_household is redefined', oldJoin.length > 0);
assert(
  '...and it no longer creates a membership',
  !/insert into household_members/.test(oldJoin),
  'a build that predates approval would walk straight past the gate',
);
assert(
  '...it raises instead',
  /raise exception 'use_request_join'/.test(oldJoin),
  'silently succeeding would tell an old client it had joined a household it cannot read',
);
/*
 * Raising rather than forwarding, deliberately. Forwarding would have to return
 * `households` — invite code included — to somebody who is now only pending.
 */
assert(
  '...rather than forwarding to the new path',
  !/request_join_household/.test(oldJoin),
);
const client = readFileSync(join(SRC, 'store', 'household.tsx'), 'utf8');
assert(
  'the client turns that into something a person can act on',
  /use_request_join.*householdError\.updateApp/s.test(client.slice(client.indexOf('friendlyError'), client.indexOf('friendlyError') + 1800)),
);

/* ------------------------- 2. a pending requester gets a NARROW answer ---- */

const request = fnBody('request_join_household');
assert('request_join_household exists', request.length > 0);
/*
 * The signature is the guarantee. `returns households` would hand back
 * invite_code, and no amount of care inside the function would help — the
 * caller reads the row.
 */
assert(
  'asking to join does not return the households row',
  !/returns households/.test(request),
  'that row carries invite_code, which is exactly what a pending requester must not have',
);
assert(
  '...it returns a narrow shape of its own',
  /returns join_request_result/.test(request),
);
const type = /create type join_request_result as \([\s\S]*?\);/.exec(sql)?.[0] ?? '';
assert('...whose fields are declared', type.length > 0);
assert(
  '...and none of them is the invite code',
  !/invite_code/.test(type),
);
/*
 * The code is LOOKED UP and never carried anywhere. Banning the column outright
 * would ban the one legitimate use — matching what was typed — so what is
 * asserted is that the only mention in the whole migration IS that match. A
 * select, an assignment, a returned field or a view would all be a second
 * mention, and any of them is the column escaping to somebody not yet let in.
 */
const codeMentions = sql.match(/invite_code/g) ?? [];
assert(
  'the invite code is matched against, and never carried',
  codeMentions.length === 1 && /where invite_code = upper\(trim\(p_code\)\)/.test(request),
  `invite_code appears ${codeMentions.length} times; a second mention is how it escapes`,
);

/*
 * The household NAME crosses the boundary, and it has to: a pending requester
 * is not a member, so RLS gives them nothing, and without the name they cannot
 * tell whether they typed the right code. Copied onto the request rather than
 * joined, so nothing else can come with it.
 */
assert(
  'the household name is copied onto the request',
  /household_name text not null/.test(sql),
);
assert(
  '...and set from the household at the time of asking',
  /values \(h\.id, auth\.uid\(\), clean, h\.name\)/.test(request),
);

/* ----------------------------- 3. the decision is checked at the server --- */

const decide = fnBody('decide_join_request');
assert('decide_join_request exists', decide.length > 0);
assert(
  'deciding checks ownership in the function',
  /role = 'owner'/.test(decide) && /raise exception 'not_owner'/.test(decide),
  'drawing the button for owners only is cosmetics; any member could call the RPC',
);
assert(
  '...before it writes anything',
  decide.indexOf("raise exception 'not_owner'") < decide.indexOf('insert into household_members'),
);
assert(
  'approving is the only thing that creates a membership',
  /if p_approve then\s*insert into household_members/.test(decide),
);
/*
 * One function for both answers. Two would be two copies of the same
 * authorisation check, and two copies is how one of them comes to be missing
 * it.
 */
assert(
  'approve and decline share one authorisation check',
  (sql.match(/raise exception 'not_owner'/g) ?? []).length === 1,
);
/*
 * A second tap, or the other owner's phone a second earlier, is not an error.
 * Raising would show somebody a failure for an action that has succeeded.
 */
assert(
  'a request already decided is a no-op, not a failure',
  /if r\.status <> 'pending' then\s*return;/.test(decide),
);

/* --------------------------------------------- the table's own defences --- */

assert(
  'the request table has row-level security on',
  /alter table household_join_requests enable row level security/.test(sql),
);
assert(
  'reading is the requester or the household',
  /using \(user_id = auth\.uid\(\) or is_household_member\(household_id\)\)/.test(sql),
);
/*
 * And NO write policy at all. One would have to express "for a household you
 * can name, but only for yourself, and only if you know its invite code" — and
 * that last clause cannot be written without letting the client read invite
 * codes to check against.
 */
const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
assert('exactly one policy on the table', policies.length === 1);
assert(
  '...and it is a read policy',
  /for select/.test(policies[0] ?? ''),
  'any insert/update policy is a second way in that does not go through the RPCs',
);

/*
 * One live request per person per household — partial, so a decline does not
 * bar somebody forever. People fall out and back in with their households, and
 * a permanent bar would be this table holding a grudge.
 */
assert(
  'asking twice does not queue twice',
  /create unique index[\s\S]*?on household_join_requests \(household_id, user_id\)\s*where status = 'pending'/.test(sql),
);

/* --------------------------------------------------------- the client ---- */

const screen = readFileSync(join(SRC, 'app', 'auth', 'household.tsx'), 'utf8');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screenCode = code(screen);

assert(
  'the join form asks rather than joins',
  /requestJoin\(code, finalName\)/.test(screenCode) && !/joinHousehold\(/.test(screenCode),
);
/*
 * A PENDING REQUEST MUST NOT SWITCH YOU ANYWHERE. There is nothing to switch to
 * — RLS gives a pending requester no household row, no lists and no members —
 * so closing onto the dashboard would show an empty app and read as everything
 * having been lost.
 */
assert(
  'a pending request stops on the screen instead of navigating',
  /if \('status' in result && result\.status === 'pending'\) \{[\s\S]{0,120}?setSent\([\s\S]{0,60}?return;/.test(screenCode),
);
const storeCode = code(client);
assert(
  '...and the store only switches for a code you were already in',
  /if \(row\.status === 'member'\) \{[\s\S]{0,200}?setActiveHousehold/.test(storeCode),
);

/*
 * BOTH SIDES ARE VISIBLE, and that is what makes the gate humane rather than
 * just restrictive. An owner who never sees the queue and a requester who
 * cannot tell whether they are queued, rejected or mistaken are the two ways an
 * approval step is worse than no approval step.
 */
const queue = code(readFileSync(join(SRC, 'components', 'join-requests.tsx'), 'utf8'));
const pending = code(readFileSync(join(SRC, 'components', 'pending-joins.tsx'), 'utf8'));
const home = code(readFileSync(join(SRC, 'app', '(tabs)', 'index.tsx'), 'utf8'));

assert('the owner sees a queue', /incomingRequests/.test(queue));
assert('...on the first screen', /<JoinRequests \/>/.test(home));
assert('the requester sees their own ask', /outgoingRequests/.test(pending));
assert('...on the same screen', /<PendingJoins \/>/.test(home));
assert(
  'a member who cannot decide is told so rather than shown nothing',
  /join\.ownerDecides/.test(queue),
);
assert(
  'and the requester can withdraw',
  /cancelRequest/.test(pending),
  'a mistyped code names a real household belonging to strangers',
);
/*
 * The owner check the buttons are drawn from comes from the store, which holds
 * both halves — who this device is and the roster. A component assembling it
 * from the auth context would be a second source of truth for "who am I".
 */
assert('the button check asks the store', /isOwnerOf\(r\.household_id\)/.test(queue));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
