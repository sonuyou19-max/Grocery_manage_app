// Shared abuse guard for the AI edge functions. Counts calls per caller (client
// IP) per function per UTC day in the ai_usage table and returns a 429 once a
// generous daily cap is exceeded. It fails OPEN: if the limiter itself errors we
// let the request through, since its only job is to cap runaway abuse — never to
// take down the AI features for legitimate users.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Generous daily caps per caller — well above any real user's usage, low enough
// to blunt a scripted abuser. Tune here if needed.
const CAPS: Record<string, number> = {
  categorize: 400,
  'quick-add-parse': 120,
  'weekly-recap': 60,
};

/**
 * Best-effort client IP from the proxy headers Supabase forwards.
 *
 * Exported because the lexicon needs the same value: it is the only stable
 * per-caller identifier this function has, and it is hashed with a secret salt
 * before it goes anywhere near the database (see _shared/lexicon.ts).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown';
}

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

/**
 * Returns a 429 Response if the caller is over today's cap for `fn`, otherwise
 * null (allowed). Never throws.
 */
export async function rateLimit(req: Request, fn: string): Promise<Response | null> {
  const cap = CAPS[fn] ?? 100;
  const bucket = `ip:${clientIp(req)}`;
  try {
    const { data, error } = await adminClient().rpc('bump_ai_usage', {
      p_bucket: bucket,
      p_fn: fn,
    });
    if (error) return null; // fail open
    if (typeof data === 'number' && data > cap) {
      return Response.json(
        { error: 'Daily limit reached. Please try again tomorrow.' },
        { status: 429 },
      );
    }
    return null;
  } catch {
    return null; // fail open
  }
}
