-- ---------------------------------------------------------------------------
-- AI abuse guard: a per-caller daily counter for the edge functions.
--
-- The AI endpoints (categorize, quick-add-parse, weekly-recap) are reachable by
-- anyone holding the public anon key, and the app allows anonymous (logged-out)
-- use, so we throttle by caller identity (client IP) per function per UTC day.
-- Only the service role (from inside the edge functions) touches this table.
-- ---------------------------------------------------------------------------

create table ai_usage (
  bucket text not null,               -- caller identity, e.g. 'ip:1.2.3.4'
  fn text not null,                   -- edge function name
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (bucket, fn, day)
);

-- No policies: RLS on with none defined blocks anon/authenticated entirely; the
-- service role bypasses RLS.
alter table ai_usage enable row level security;

-- Atomically increment and return the running count for today.
create or replace function bump_ai_usage(p_bucket text, p_fn text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c integer;
begin
  insert into ai_usage (bucket, fn, day, count)
  values (p_bucket, p_fn, (now() at time zone 'utc')::date, 1)
  on conflict (bucket, fn, day)
  do update set count = ai_usage.count + 1
  returning count into c;
  return c;
end;
$$;

revoke execute on function bump_ai_usage(text, text) from public, anon, authenticated;
grant execute on function bump_ai_usage(text, text) to service_role;
