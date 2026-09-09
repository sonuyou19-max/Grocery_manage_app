import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Where a receipt read waits for the phone to come back.
 *
 * ---------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------
 *
 * A read takes the better part of a minute. The phone locks after thirty
 * seconds, the JS thread suspends, and the upload dies — while this function
 * carries on, finishes, is billed, and returns the answer into a socket nobody
 * is listening to. The shopper starts again and pays a second time for a read
 * that already happened.
 *
 * So the answer is written here as well as returned. The client chose the key
 * before it sent anything (see the app's lib/scan-key), so it can come back for
 * the answer after the screen wakes — and a second press of Scan finds the row
 * and costs nothing.
 *
 * ---------------------------------------------------------------------------
 * Two things this deliberately does NOT do
 * ---------------------------------------------------------------------------
 *
 * It does not derive the key. A second implementation of that recipe is a
 * second thing to keep in step, and the one thing the key must never do is
 * differ between two attempts at the same receipt. The client owns it; this
 * stores what it is given, under that caller and no other.
 *
 * And it does not change what the function returns to a client that stayed
 * awake. The read is still answered synchronously on the same request. An app
 * that knows nothing about any of this — the Android build still in people's
 * hands — keeps working exactly as before, because every part of this is a side
 * channel rather than a new protocol.
 */
let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}

export type JobStatus = 'running' | 'done' | 'failed';

export interface Job {
  status: JobStatus;
  result: unknown | null;
  error: string | null;
}

/** How long a finished read is worth coming back for. */
const KEEP_HOURS = 24;

/**
 * A `running` row older than this is not running: it is the corpse of an
 * invocation that was torn down mid-read.
 *
 * Nothing can tell the difference from the outside — there is no process to
 * ask — so it is decided by the clock, generously. The scan timeout on the
 * device is two minutes; five leaves room for a slow one and still means a
 * genuinely dead job never blocks a fresh attempt for long.
 */
const STALE_MINUTES = 5;

/** The row for this caller and key, or null. Stale `running` rows read as null. */
export async function readJob(caller: string, key: string): Promise<Job | null> {
  try {
    const { data, error } = await adminClient()
      .from('scan_jobs')
      .select('status, result, error, updated_at')
      .eq('caller', caller)
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as Job & { updated_at: string };
    if (row.status === 'running') {
      const age = Date.now() - new Date(row.updated_at).getTime();
      if (age > STALE_MINUTES * 60_000) return null;
    }
    return { status: row.status, result: row.result, error: row.error };
  } catch {
    /*
     * A cache that is down must not fail the scan it was meant to help. Every
     * one of these answers "no row", so the function reads the receipt the way
     * it always did and the only thing lost is the saving.
     */
    return null;
  }
}

/** Record where a scan has got to. Never throws, for the reason above. */
export async function writeJob(
  caller: string,
  key: string,
  status: JobStatus,
  result: unknown | null,
  error: string | null,
): Promise<void> {
  try {
    await adminClient()
      .from('scan_jobs')
      .upsert(
        { caller, key, status, result, error, updated_at: new Date().toISOString() },
        { onConflict: 'caller,key' },
      );
  } catch {
    // See readJob. The scan has already succeeded or failed on its own terms;
    // losing the record of it costs a re-read, not a receipt.
  }
}

/**
 * Drop what nobody is coming back for.
 *
 * Opportunistic rather than scheduled: this table is written once per scan and
 * a household scans a few times a week, so it is small, and a cron job to keep
 * it small would be more moving parts than the thing it maintains. Called from
 * inside waitUntil, so a slow delete never sits between the shopper and their
 * receipt.
 */
export async function sweepJobs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - KEEP_HOURS * 3_600_000).toISOString();
    await adminClient().from('scan_jobs').delete().lt('created_at', cutoff);
  } catch {
    // Nothing depends on this having run.
  }
}
