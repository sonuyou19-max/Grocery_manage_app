// Supabase Edge Function: notify-join
//
// The push notification for the two moments in a join request that somebody is
// waiting on: "X wants to join" and "you're in".
//
// Deploy: supabase functions deploy notify-join

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * ---------------------------------------------------------------------------
 * Why the caller does not say who to notify
 * ---------------------------------------------------------------------------
 *
 * The obvious shape for this is `{ userIds, title, body }` from the client, and
 * it is an open relay: anyone with an account could push arbitrary text to
 * anybody they could name. So the request body carries ONE id — the join
 * request — and everything else is derived here from the row and from the
 * caller's own token.
 *
 * Three things are checked before a single notification is sent, and they are
 * the whole security model:
 *
 *   WHO IS ASKING. The caller's JWT is verified against Supabase, not decoded.
 *   The audience of these notifications is a household, and a forged `sub`
 *   would let somebody push into one they are not in.
 *
 *   WHETHER THEY ARE PART OF THIS. A pending request may only be announced by
 *   the person who made it; a decision only by an owner of that household. Any
 *   other pairing is somebody trying to send on a stranger's behalf.
 *
 *   WHETHER IT HAS ALREADY GONE. `asked_notified_at` and `decided_notified_at`
 *   are stamped before the send, so a retried, backgrounded or double-tapped
 *   client sends nothing the second time.
 *
 * ---------------------------------------------------------------------------
 * Why the client triggers it at all
 * ---------------------------------------------------------------------------
 *
 * The alternative is a database webhook and pg_net, firing from the RPCs
 * themselves. That is more correct in the abstract — it cannot be skipped — and
 * it is a queue, a retry policy and an extension to keep working for a message
 * whose entire value is being timely. A client that fails to call this loses one
 * notification; the in-app queue is unchanged and the request is still there.
 * That is the right failure to have.
 *
 * ---------------------------------------------------------------------------
 * Failing is not an error
 * ---------------------------------------------------------------------------
 *
 * Every path here answers 200. The join has already happened — the row is
 * written, the membership exists — and this function is a courtesy on top of
 * it. Returning an error would give the client something to retry and surface,
 * turning "your friend will not get a buzz" into "joining failed".
 */

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/**
 * The two sentences this function can send, in every language Korb ships.
 *
 * ---------------------------------------------------------------------------
 * Why the copy is here and not in the locale files
 * ---------------------------------------------------------------------------
 *
 * Every other string in the app is composed on the device, by a reader whose
 * language is known. A notification is composed here, minutes or hours later,
 * on a server, for an app that is closed — so this is the one place in the
 * product where the text has to live beside the sender rather than beside the
 * reader. `device_tokens.language` is how the reader's choice reaches it.
 *
 * check-join-signals asserts this covers every shipped language, because the
 * failure is silent and one-directional: a missing entry falls back to English
 * and nobody who reads English will ever see it happen.
 */
const COPY = {
  en: {
    asked: (who: string) => `${who} is asking to join`,
    approved: "You're in — your lists are ready",
    declined: 'Your request was turned down',
  },
  de: {
    asked: (who: string) => `${who} möchte beitreten`,
    approved: 'Du bist dabei — deine Listen sind bereit',
    declined: 'Deine Anfrage wurde abgelehnt',
  },
  fr: {
    asked: (who: string) => `${who} demande à vous rejoindre`,
    approved: 'Vous y êtes — vos listes vous attendent',
    declined: 'Votre demande a été refusée',
  },
  it: {
    asked: (who: string) => `${who} chiede di entrare`,
    approved: 'Sei dentro — le tue liste sono pronte',
    declined: 'La tua richiesta è stata rifiutata',
  },
  es: {
    asked: (who: string) => `${who} quiere unirse`,
    approved: 'Ya estás dentro: tus listas te esperan',
    declined: 'Han rechazado tu solicitud',
  },
  pl: {
    asked: (who: string) => `${who} prosi o dołączenie`,
    approved: 'Jesteś w środku — twoje listy czekają',
    declined: 'Twoja prośba została odrzucona',
  },
  nl: {
    asked: (who: string) => `${who} wil meedoen`,
    approved: 'Je doet mee — je lijsten staan klaar',
    declined: 'Je verzoek is afgewezen',
  },
} as const;

type Lang = keyof typeof COPY;

// English when the device never said, or said something this build does not
// know. A notification in the wrong language still tells somebody the thing
// they were waiting to hear; no notification tells them nothing.
const copyFor = (language: string | null): (typeof COPY)[Lang] =>
  COPY[(language ?? 'en') as Lang] ?? COPY.en;

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

/** The caller, verified against Supabase rather than read off the token. */
async function callerId(req: Request): Promise<string | null> {
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const { data, error } = await adminClient().auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

interface JoinRow {
  id: string;
  household_id: string;
  household_name: string;
  user_id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'declined';
  asked_notified_at: string | null;
  decided_notified_at: string | null;
}

/**
 * Send to every device these users have registered.
 *
 * Tokens that Expo rejects are DELETED rather than retried. A token goes bad
 * when the app is uninstalled or reinstalled, and that is permanent — keeping
 * it means every future notification carries a failure that will never clear,
 * and the table grows a tail of addresses for devices that no longer exist.
 */
async function push(
  userIds: readonly string[],
  compose: (copy: (typeof COPY)[Lang]) => { title: string; body: string },
  title: string,
  data: Record<string, string>,
): Promise<void> {
  if (userIds.length === 0) return;

  const db = adminClient();
  const { data: rows, error } = await db
    .from('device_tokens')
    .select('user_id, token, language')
    .in('user_id', userIds);

  if (error || !rows || rows.length === 0) return;

  const devices = rows as { user_id: string; token: string; language: string | null }[];

  const messages = devices.map((d) => {
    const { body } = compose(copyFor(d.language));
    return { to: d.token, title, body, data, sound: 'default' };
  });

  const res = await fetch(EXPO_PUSH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!res.ok) return;

  const payload = (await res.json().catch(() => null)) as
    | { data?: { status: string; details?: { error?: string } }[] }
    | null;
  const tickets = payload?.data ?? [];

  const dead = tickets
    .map((t, i) =>
      t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
        ? devices[i]?.token ?? null
        : null,
    )
    .filter((t): t is string => t != null);

  if (dead.length > 0) {
    await db.from('device_tokens').delete().in('token', dead);
  }
}

Deno.serve(async (req) => {
  const done = () => new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (req.method !== 'POST') return done();

  const uid = await callerId(req);
  if (!uid) return done();

  const body = (await req.json().catch(() => null)) as { requestId?: string } | null;
  const requestId = body?.requestId;
  if (!requestId) return done();

  const db = adminClient();
  const { data, error } = await db
    .from('household_join_requests')
    .select(
      'id, household_id, household_name, user_id, display_name, status, asked_notified_at, decided_notified_at',
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error || !data) return done();
  const row = data as JoinRow;

  /* ------------------------------------------------- somebody is asking --- */

  if (row.status === 'pending') {
    // Only the person who made it, and only once.
    if (row.user_id !== uid || row.asked_notified_at != null) return done();

    const { data: owners } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', row.household_id)
      .eq('role', 'owner');

    // Stamped BEFORE the send. A crash between the two loses one notification;
    // the other order loses the idempotency and can send the same thing twice
    // on every retry, which is the failure people actually notice.
    await db
      .from('household_join_requests')
      .update({ asked_notified_at: new Date().toISOString() })
      .eq('id', row.id);

    await push(
      ((owners as { user_id: string }[] | null) ?? []).map((o) => o.user_id),
      (copy) => ({ title: row.household_name, body: copy.asked(row.display_name) }),
      // The household's own name, which is not translated and should not be.
      row.household_name,
      { kind: 'join_request', householdId: row.household_id },
    );
    return done();
  }

  /* -------------------------------------------------- somebody decided ---- */

  // Only an owner of the household this request is about.
  const { data: mine } = await db
    .from('household_members')
    .select('role')
    .eq('household_id', row.household_id)
    .eq('user_id', uid)
    .maybeSingle();

  if ((mine as { role?: string } | null)?.role !== 'owner') return done();
  if (row.decided_notified_at != null) return done();

  await db
    .from('household_join_requests')
    .update({ decided_notified_at: new Date().toISOString() })
    .eq('id', row.id);

  /*
   * A decline is told plainly and without a reason, because there is no reason
   * to give — the owner did not type one and inventing warmth here ("maybe try
   * again later") would be the app editorialising about somebody else's
   * decision. Silence would be worse: the requester is waiting either way, and
   * not knowing is the state this whole migration exists to end.
   */
  await push(
    [row.user_id],
    (copy) => ({
      title: row.household_name,
      body: row.status === 'approved' ? copy.approved : copy.declined,
    }),
    row.household_name,
    { kind: 'join_decision', householdId: row.household_id, status: row.status },
  );

  return done();
});
