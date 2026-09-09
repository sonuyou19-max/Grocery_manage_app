-- ---------------------------------------------------------------------------
-- A receipt read, kept where a dead socket cannot take it.
--
-- A scan takes the better part of a minute. The phone locks after thirty
-- seconds, the JS thread suspends, the upload in flight dies — and the model
-- call it abandoned runs to completion on the server and is billed. The answer
-- was returned into a socket nobody was listening to, so the shopper starts
-- again and pays a second time for a read that already happened.
--
-- This is where that answer goes instead. The function writes the finished read
-- here under a key the CLIENT chose before it sent anything, so the client can
-- come back for it: after the screen wakes, after the app is foregrounded, or
-- on a second press of Scan. Two problems, one row — the retry is free because
-- the read is already here, and the wait survives being interrupted because the
-- result outlives the request that produced it.
--
-- ---------------------------------------------------------------------------
-- Why the key is not a hash of the receipt
-- ---------------------------------------------------------------------------
--
-- It has to be known BEFORE the read, so it cannot be `fingerprint()` — that is
-- store, total and printed time, none of which exist until the model has
-- answered. It also has to be computable on a phone with no native crypto
-- module, because this feature ships over the air and adding one would need a
-- new binary.
--
-- So the client builds a short descriptor of what it is about to send — the
-- file's name and byte length, or the sizes of the photographs — and that is
-- the key. See lib/scan-key.ts, which is the only implementation of it.
-- ---------------------------------------------------------------------------

create table if not exists scan_jobs (
  /*
   * Who asked. `user:<uuid>` or `ip:<addr>`, exactly as callerBucket() spells
   * it — the same identity the spend cap is keyed by, so there is one notion of
   * "this caller" in the function and not two.
   */
  caller text not null,

  /*
   * What was asked. Chosen by the client, opaque here.
   *
   * The server never derives or validates it, which is deliberate: a second
   * implementation of the recipe is a second thing to keep in step, and the one
   * thing this value must never do is differ between two attempts at the same
   * receipt. One implementation, on the device that picks the file.
   *
   * The pair is the primary key, so one caller reusing a key overwrites their
   * own row and can never read another caller's.
   */
  key text not null,

  status text not null check (status in ('running', 'done', 'failed')),

  /** The whole response body, as the function would have returned it. */
  result jsonb,

  /** Why it failed, for the log. Never shown to a shopper. */
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (caller, key)
);

-- The sweep reads this, and it is the only query that is not by primary key.
create index if not exists scan_jobs_created_at_idx on scan_jobs (created_at);

/*
 * No policies. RLS on with none defined denies every command to anon and
 * authenticated; only the service role, inside the edge function, bypasses it.
 * That absence IS the control — a receipt read is the household's money and
 * belongs in front of them through the app, not through a table anyone holding
 * an anon key can select from. Same reasoning, and the same shape, as ai_usage.
 */
alter table scan_jobs enable row level security;
