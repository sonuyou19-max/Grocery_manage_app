import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { setHomeListScope } from '@/lib/item-home-list';
import { useProfileName } from '@/lib/profile-name';
import { reportWriteFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import { useAuth } from '@/store/auth';
import { useT } from '@/store/locale';

/**
 * The households the signed-in user belongs to, and which one is active.
 *
 * A user can hold several — "Home" shared with a partner, "Office" with a
 * colleague — and everything else scopes to the active one: lists, pantry,
 * Vibe Check, Insights, recap. Households are fully isolated; see
 * docs/MULTI_HOUSEHOLD_DESIGN.md.
 *
 * The schema always allowed this (household_members is keyed
 * (household_id, user_id) and every table carries household_id); only the
 * client's `.limit(1)` enforced a single one.
 */

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

export interface Member {
  user_id: string;
  role: 'owner' | 'member';
  display_name: string;
}

/**
 * Somebody asking to be let into a household, or the ask you have made.
 *
 * One type for both directions, because it is one row read from two sides: an
 * owner sees the requests against their households, a requester sees their own.
 * `household_name` is copied onto the row rather than joined — until a request
 * is approved the requester is not a member and RLS gives them nothing about
 * the household, so this is the only way they can be told which one they asked
 * about. See migration 0042.
 */
export interface JoinRequest {
  id: string;
  household_id: string;
  household_name: string;
  user_id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
}

interface HouseholdContext {
  /** Every household the user belongs to, name-sorted. */
  households: Household[];
  /** The one everything else is scoped to — lists, pantry, insights, recap. */
  household: Household | null;
  /**
   * The remembered household id, straight off the device — available before
   * (and independently of) the network fetch that produces `household`.
   *
   * The grocery store picks its backend from this, not from `household`. See
   * the note on the provider selector in store/groceries.
   */
  activeId: string | null;
  /**
   * Whether the on-device read of `activeId` has finished. LOCAL and always
   * settles, unlike `loading` — components/boot-gate waits on this, and the
   * distinction is the whole reason it is a separate flag.
   *
   * `loading` is false both before the fetch starts and after it ends, so it
   * cannot answer "has this resolved yet"; waiting on it is what hung the app
   * twice (see scripts/check-splash.mjs).
   */
  restored: boolean;
  setActiveHousehold: (householdId: string) => void;
  /** Members of the active household. */
  members: Member[];
  /** Members of any household the user belongs to. */
  membersOf: (householdId: string) => Member[];
  /** The user's display name. One name, identical in every household. */
  myName: string | null;
  loading: boolean;
  /**
   * Signed in, the roster has been fetched for THIS user, and it is empty.
   *
   * Nothing in Korb is stored in the cloud except inside a household, so this
   * is the state where the app looks signed in and quietly syncs nothing. It is
   * meant to be unreachable — sign-up creates one immediately — but that write
   * is deliberately non-fatal, so a network blip at exactly the wrong moment
   * lands here and nothing says so.
   *
   * False while the fetch is in flight, and that is the whole reason it is
   * derived here rather than as `households.length === 0` at each call site:
   * `households` is empty for a moment on EVERY launch, so the naive version
   * flashes "your shopping isn't backed up" at people whose shopping is
   * perfectly well backed up.
   */
  needsHousehold: boolean;
  refresh: () => Promise<void>;
  /** Creates and switches to it. */
  /**
   * Make a household and switch to it. Returns the row on success.
   *
   * The row rather than a bare ok, because the caller has something to say
   * about it: the screen announces the switch, and announcing it from what the
   * user TYPED is a claim about a write rather than a report of one. For a join
   * there is nothing typed at all — you enter a code, not a name — so this is
   * the only way that message can name the household somebody has just joined.
   */
  createHousehold: (
    name: string,
    displayName: string,
  ) => Promise<{ error?: string; household?: Household }>;
  /**
   * Pending requests to join a household this user is IN — the owner's queue.
   *
   * Everyone in the household can see them; only the owner can answer. That is
   * deliberate: a household where one person is quietly admitting people is
   * worse than one where everybody can see who is at the door, and it means a
   * member who taps sees why the answer is not theirs to give rather than
   * nothing at all.
   */
  incomingRequests: JoinRequest[];
  /**
   * Whether this user owns a given household.
   *
   * Here rather than worked out by callers, because it needs two things the
   * provider already holds and a component should not have to assemble: who
   * this device is signed in as, and the roster of that household. A component
   * reaching for the auth context to answer it would be a second source of
   * truth for "who am I" inside a screen whose actual question is "may I do
   * this".
   *
   * It decides which buttons to draw and nothing else — decide_join_request
   * checks ownership again on the way in, where it cannot be talked out of it.
   */
  isOwnerOf: (householdId: string) => boolean;
  /** This user's own pending asks, waiting on somebody else's owner. */
  outgoingRequests: JoinRequest[];
  /**
   * Ask to join. Returns 'member' when the code names a household this user is
   * already in, which is a no-op rather than a request.
   */
  requestJoin: (
    code: string,
    displayName: string,
  ) => Promise<{ error?: string; status?: 'pending' | 'member'; household?: { id: string; name: string } }>;
  /** Owner only. Approving creates the membership. */
  decideRequest: (requestId: string, approve: boolean) => Promise<{ error?: string }>;
  /** Withdraw one of your own. */
  cancelRequest: (requestId: string) => Promise<{ error?: string }>;
  renameHousehold: (householdId: string, name: string) => Promise<{ error?: string }>;
  leaveHousehold: (householdId: string) => Promise<{ error?: string }>;
  removeMember: (householdId: string, userId: string) => Promise<{ error?: string }>;
  /** Rename yourself across every household at once. */
  setDisplayName: (name: string) => Promise<{ error?: string }>;
}

const Ctx = createContext<HouseholdContext | null>(null);

type TFn = (key: string, options?: Record<string, unknown>) => string;

const friendlyError = (message: string, t: TFn): string => {
  if (message.includes('invalid_code')) return t('householdError.invalidCode');
  // Postgres denies the create/join RPCs to the `anon` role, so a caller who
  // isn't signed in gets "permission denied for function …" — treat it, and the
  // in-function not_authenticated guard, as the same "sign in first" case.
  if (message.includes('not_authenticated') || message.includes('permission denied'))
    return t('householdError.signInFirst');
  if (message.includes('not_owner')) return t('householdError.notOwner');
  if (message.includes('use_leave')) return t('householdError.useLeave');
  if (message.includes('household_limit')) return t('householdError.limitReached');
  /*
   * The old join RPC, which now refuses rather than admitting anybody.
   *
   * A build that predates approval calls join_household and would otherwise
   * walk straight in without the owner ever seeing a request — so the function
   * raises, and this turns that into the one thing the user can act on. It
   * cannot be forwarded to the new path: forwarding would return the households
   * row, invite code and all, to somebody who is now only pending, and would
   * tell an old client it had joined a household it cannot read.
   */
  if (message.includes('use_request_join')) return t('householdError.updateApp');
  if (message.includes('no_request')) return t('householdError.requestGone');
  if (message.includes('name_required')) return t('householdError.nameRequired');
  return message;
};

/** Which household is selected. Persisted so a relaunch reopens the same one. */
const ACTIVE_KEY = 'korb.activeHousehold.v1';

/**
 * Which household the app should be looking at.
 *
 * ---------------------------------------------------------------------------
 * The bug this is extracted from
 * ---------------------------------------------------------------------------
 *
 * The selected id was restored from storage into React state once, at mount,
 * and after that only ever SET. Signing out removed the storage key but left
 * the state — and the provider does not remount on sign-out, so the id survived
 * into the next person's session.
 *
 * Everything downstream then behaved exactly as designed, which is what made it
 * hard to see. GroceriesProvider reads `activeId ?? household?.id`, deliberately
 * preferring the stored id so a returning user gets the cloud backend on the
 * first render instead of mounting the whole app twice. That preference assumes
 * a stale id is CORRECTABLE — "in which case `household` resolves to something
 * else and the key changes". It is, for a user who has a household of their own.
 * It is not for a brand-new account, where `households` is empty and there is
 * nothing to correct it with. So the new user got the cloud backend pointed at
 * the previous user's household, every read came back empty through RLS, and
 * every write was refused — including the one that creates a list, which
 * appeared optimistically and then vanished as "This list no longer exists".
 *
 * ---------------------------------------------------------------------------
 * Why `settled` is a parameter and not an assumption
 * ---------------------------------------------------------------------------
 *
 * "The id is not in the list" means two opposite things depending on whether
 * the list has been fetched yet. Before the first fetch it means nothing at all
 * — `households` is empty on every launch for a moment — and acting on it would
 * throw away the stored id every cold start, which is the entire optimisation
 * this id exists for. After the fetch it is conclusive: the user is not in that
 * household, whether because they left it, it was deleted, or they are somebody
 * else.
 */
export function resolveActiveId(
  stored: string | null,
  households: readonly { id: string }[],
  settled: boolean,
): string | null {
  if (!settled) return stored;
  if (stored && households.some((h) => h.id === stored)) return stored;
  return households[0]?.id ?? null;
}

export function HouseholdProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const t = useT();
  const appActive = useAppActive();
  const [households, setHouseholds] = useState<Household[]>([]);
  /** Members of every household the user belongs to, keyed by household id. */
  const [byHousehold, setByHousehold] = useState<Record<string, Member[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * Every join request this user can see, both directions in one list.
   *
   * One fetch, because it is one policy: RLS returns the rows where you are the
   * asker or a member of the household being asked about, and splitting that
   * into two queries would be two round trips to reassemble something the
   * server already answered in one.
   */
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * The user id the current `households` answer belongs to, or undefined before
   * any fetch has finished.
   *
   * Not a boolean, because "we have fetched" is the wrong question after a
   * sign-in: the households in state are the PREVIOUS user's until this says
   * otherwise, and acting on them is how the default household came to be
   * skipped for a brand-new account.
   */
  const [settledFor, setSettledFor] = useState<string | null | undefined>(undefined);
  // Signature of the last-applied data, so background polling only re-renders
  // when something actually changed.
  const sigRef = useRef<string>('');

  // Restore the previously selected household before the first fetch, so the
  // app reopens where it left off instead of flashing another household.
  //
  // Mirrored into state as well as the ref: the ref is read inside effects,
  // while `restored` has to re-render consumers — the boot gate is waiting on
  // it, and a ref would leave it waiting forever.
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_KEY)
      .then((id) => {
        if (id) setActiveId(id);
      })
      .catch(() => {})
      .finally(() => {
        restoredRef.current = true;
        setRestored(true);
      });
  }, []);

  const setActiveHousehold = useCallback((householdId: string) => {
    setActiveId(householdId);
    AsyncStorage.setItem(ACTIVE_KEY, householdId).catch(() => {});
  }, []);

  /**
   * Take up a household we have just been handed, and switch to it.
   *
   * ---------------------------------------------------------------------------
   * The bug this is
   * ---------------------------------------------------------------------------
   *
   * Creating a household said "you're now shopping in X" and left you in the
   * old one. Both halves were written correctly and they undid each other.
   *
   * `createHousehold` set the new id active and then awaited a refresh. But the
   * correcting effect below runs on every change to `activeId`, and at that
   * instant `households` was still the list from before — so it asked
   * resolveActiveId whether the new id was one of the user's households, was
   * told no, and did exactly what it is for: replaced it with the first one it
   * could find. The refresh then landed with the new household in the list, the
   * id was by then the old one, and the old one is perfectly valid, so nothing
   * ever corrected it back. Silent, and it looked like the toast lying.
   *
   * ---------------------------------------------------------------------------
   * Why the fix is here rather than in the reconciler
   * ---------------------------------------------------------------------------
   *
   * The reconciler cannot tell a STALE id from a BRAND-NEW one — both are "not
   * in the list" — and teaching it to would mean giving it a second, softer
   * mode where it declines to act, which is precisely the state that let the
   * previous user's household survive a sign-out (see resolveActiveId).
   *
   * It does not need to. `households` is this provider's belief about which
   * households exist, the RPC has just returned a row proving one more does,
   * and the actual mistake was throwing that away and asking the server again.
   * Recorded first, the id is no longer absent from the list, there is no
   * evidence of staleness, and the reconciler correctly leaves it alone.
   *
   * Sorted the way `refresh` sorts, so the household list does not visibly
   * reorder a moment later when the real answer arrives.
   */
  const adoptHousehold = useCallback(
    (row: Household) => {
      setHouseholds((prev) =>
        prev.some((h) => h.id === row.id)
          ? prev
          : [...prev, row].sort((a, b) => a.name.localeCompare(b.name)),
      );
      // The signature describes a list that no longer matches state, so the
      // next refresh must not decide nothing has changed and skip applying the
      // members of the household we have just joined.
      sigRef.current = '';
      setActiveHousehold(row.id);
    },
    [setActiveHousehold],
  );

  const refresh = useCallback(async () => {
    if (!user) {
      sigRef.current = '';
      setHouseholds([]);
      setByHousehold({});
      setRequests([]);
      setSettledFor(null);
      return;
    }
    setLoading(true);
    try {
      // Both queries lean on RLS rather than filtering client-side: a user can
      // only read households they belong to, and only membership rows of those
      // households. That also means one query covers every household at once.
      const [{ data: householdRows }, { data: memberRows }, { data: requestRows }] =
        await Promise.all([
          supabase.from('households').select('id, name, invite_code, created_at'),
          supabase.from('household_members').select('household_id, user_id, role, display_name'),
          /*
           * Pending only. A decided request is history — approved ones became
           * memberships and declined ones are a thing nobody needs shown back
           * to them — and fetching them would grow this query without bound as
           * a household turns people over.
           *
           * Unfiltered by household or user: the SELECT policy already answers
           * exactly "rows you are the asker on, or a member of the household
           * for", so one query covers both directions at once. Adding a filter
           * here would be the client restating a rule the server enforces, and
           * the two would eventually disagree.
           */
          supabase
            .from('household_join_requests')
            .select('id, household_id, household_name, user_id, display_name, status, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false }),
        ]);

      const list = ((householdRows as Household[] | null) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const grouped: Record<string, Member[]> = {};
      for (const row of (memberRows as (Member & { household_id: string })[] | null) ?? []) {
        (grouped[row.household_id] ??= []).push({
          user_id: row.user_id,
          role: row.role,
          display_name: row.display_name,
        });
      }

      const pending = (requestRows as JoinRequest[] | null) ?? [];

      const sig = JSON.stringify({
        h: list.map((h) => `${h.id}:${h.name}`),
        // In the signature, so a request arriving while nothing else changed
        // still re-renders. Left out, the nudge would appear on whichever poll
        // happened to coincide with a rename.
        r: pending.map((r) => `${r.id}:${r.status}`),
        m: Object.entries(grouped)
          .map(([id, rows]) =>
            `${id}:${rows.map((r) => `${r.user_id}:${r.role}:${r.display_name}`).sort().join(',')}`,
          )
          .sort(),
      });
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setHouseholds(list);
        setByHousehold(grouped);
        setRequests(pending);
      }
    } finally {
      setLoading(false);
      setSettledFor(user.id);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The active household: the stored choice when it still resolves, otherwise
   * the first one. Falling back matters — the stored id goes stale whenever the
   * user leaves that household, it is deleted, or they sign in as someone else.
   */
  /*
   * The same rows, split by who has to act on them.
   *
   * Derived rather than fetched twice: `requests` is what RLS returned, which
   * is precisely "mine, plus those aimed at a household I am in". Owning the
   * household is not checked here — every member sees the queue, and the ANSWER
   * is what is owner-only. See migration 0042.
   */
  const incomingRequests = useMemo(
    () => requests.filter((r) => r.user_id !== (user?.id ?? '')),
    [requests, user?.id],
  );
  const outgoingRequests = useMemo(
    () => requests.filter((r) => r.user_id === (user?.id ?? '')),
    [requests, user?.id],
  );

  const household = useMemo(
    () => households.find((h) => h.id === activeId) ?? households[0] ?? null,
    [households, activeId],
  );

  /*
   * Correct the selection once the fetch has answered for THIS user.
   *
   * The old version of this only wrote the fallback back to storage, and it was
   * gated on `household` being non-null — so it could tidy up a stale id when
   * there was another household to fall back to, and did nothing at all when
   * there was not. That gap is the whole bug: a new account has no households,
   * so nothing corrected the previous user's id and GroceriesProvider went on
   * preferring it. See resolveActiveId.
   *
   * Now the null case is handled too, and the storage key is removed rather
   * than left pointing somewhere the user cannot go.
   */
  useEffect(() => {
    if (!restoredRef.current) return;
    const settled = settledFor === (user?.id ?? null);
    const next = resolveActiveId(activeId, households, settled);
    if (next === activeId) return;
    setActiveId(next);
    if (next) AsyncStorage.setItem(ACTIVE_KEY, next).catch(() => {});
    else AsyncStorage.removeItem(ACTIVE_KEY).catch(() => {});
  }, [activeId, households, settledFor, user?.id]);

  // Point the per-item home-list cache at the active household, so routing an
  // item back to "its" list never reaches across into another household.
  useEffect(() => {
    setHomeListScope(household?.id ?? null);
  }, [household?.id]);

  const members = useMemo(
    () => (household ? byHousehold[household.id] ?? [] : []),
    [byHousehold, household],
  );

  // One name in every household, so any membership row answers this.
  const membershipName = useMemo(() => {
    if (!user) return null;
    for (const rows of Object.values(byHousehold)) {
      const mine = rows.find((r) => r.user_id === user.id)?.display_name?.trim();
      if (mine) return mine;
    }
    return null;
  }, [byHousehold, user]);

  /**
   * Your name belongs to you, not to a household.
   *
   * This used to read membership rows only, so the dashboard greeted you by
   * name only once you'd created or joined a household — despite the name being
   * asked for at sign-up, well before that. Signing up and landing on "Good
   * afternoon" made it look like the answer had been thrown away.
   *
   * Membership still wins when there is one: it's the server's copy and the one
   * other members see, so it's authoritative and it reaches a second device.
   * The on-device copy fills the gap before any household exists, and on a
   * fresh install with no household it is simply absent — same as before.
   */
  const { name: deviceName, remember: rememberName } = useProfileName();
  const myName = membershipName ?? (deviceName.trim() || null);

  // Keep the device copy current. Renaming yourself on another phone only
  // reaches this one through the membership rows, and without this the stale
  // local copy would resurface the old name the moment you left your last
  // household.
  useEffect(() => {
    if (membershipName && membershipName !== deviceName.trim()) void rememberName(membershipName);
  }, [membershipName, deviceName, rememberName]);

  // Membership changes (e.g. being removed by the owner) have no realtime
  // path that reaches the removed member, so keep it fresh by re-checking when
  // the app returns to the foreground and on a slow interval while open.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const interval = setInterval(() => void refresh(), 25000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [user, refresh]);

  // See the field's own note for why this is gated on `settledFor` rather than
  // written as `households.length === 0` wherever it is needed.
  const needsHousehold = user != null && settledFor === user.id && households.length === 0;

  const value = useMemo<HouseholdContext>(
    () => ({
      households,
      household,
      activeId,
      restored,
      setActiveHousehold,
      members,
      membersOf: (householdId) => byHousehold[householdId] ?? [],
      myName,
      loading,
      needsHousehold,
      refresh,
      createHousehold: async (name, displayName) => {
        if (!user) return { error: t('householdError.signInFirst') };
        // The RPC returns the new row, so we can switch straight to it —
        // you almost certainly want to use what you just made.
        const { data, error } = await supabase.rpc('create_household', {
          p_name: name,
          p_display_name: displayName,
        });
        if (error) return { error: friendlyError(error.message, t) };
        const created = data as Household | null;
        // Recorded BEFORE it is made active — see adoptHousehold. Setting the
        // id first is what the bug was.
        if (created?.id) adoptHousehold(created);
        await refresh();
        return { household: created ?? undefined };
      },
      incomingRequests,
      outgoingRequests,
      isOwnerOf: (householdId) =>
        (byHousehold[householdId] ?? []).some(
          (m) => m.user_id === user?.id && m.role === 'owner',
        ),
      requestJoin: async (code, displayName) => {
        if (!user) return { error: t('householdError.signInFirst') };
        const { data, error } = await supabase.rpc('request_join_household', {
          p_code: code,
          p_display_name: displayName,
        });
        if (error) return { error: friendlyError(error.message, t) };
        const row = data as {
          status: 'pending' | 'member';
          household_id: string;
          household_name: string;
        } | null;
        if (!row) return { error: t('householdError.invalidCode') };

        /*
         * Already a member is the one case that still switches. The code named
         * a household this user is in, nothing was asked of anybody, and the
         * only sensible reading of entering it is "take me there".
         *
         * A pending request switches NOTHING. There is nothing to switch to —
         * RLS returns no lists, no members and no household row until the owner
         * says yes — so moving there would empty the screen and look like the
         * app losing the shopping they were just looking at.
         */
        if (row.status === 'member') {
          const known = households.find((h) => h.id === row.household_id);
          if (known) setActiveHousehold(known.id);
        }
        await refresh();
        return {
          status: row.status,
          household: { id: row.household_id, name: row.household_name },
        };
      },
      decideRequest: async (requestId, approve) => {
        const { error } = await supabase.rpc('decide_join_request', {
          p_request: requestId,
          p_approve: approve,
        });
        if (error) return { error: friendlyError(error.message, t) };
        /*
         * The signature is cleared because approving CHANGES A MEMBERSHIP, and
         * the refresh must apply it rather than decide nothing moved. Without
         * this the owner approves somebody and the member list does not grow
         * until something unrelated happens to shift the signature.
         */
        sigRef.current = '';
        await refresh();
        return {};
      },
      cancelRequest: async (requestId) => {
        const { error } = await supabase.rpc('cancel_join_request', { p_request: requestId });
        if (error) return { error: friendlyError(error.message, t) };
        sigRef.current = '';
        await refresh();
        return {};
      },
      renameHousehold: async (householdId, name) => {
        const target = households.find((h) => h.id === householdId);
        if (!target) return {};
        const clean = name.trim();
        if (!clean || clean === target.name) return {};
        // Optimistic: reflect the new name immediately, then persist. RLS lets
        // only the owner update; a failure rolls back via refresh().
        setHouseholds((prev) =>
          prev.map((h) => (h.id === householdId ? { ...h, name: clean } : h)),
        );
        const { error } = await supabase
          .from('households')
          .update({ name: clean })
          .eq('id', householdId);
        // Surfaced to the user AND reported: a rename that fails for everyone —
        // an RLS change, say — looks like one person's bad luck from inside the
        // app and like nothing at all from outside it.
        reportWriteFailure('households.rename', error);
        if (error) {
          await refresh();
          return { error: friendlyError(error.message, t) };
        }
        // Keep the signature in step so the next poll/realtime tick doesn't
        // think nothing changed and skip re-applying the server truth.
        sigRef.current = '';
        return {};
      },
      leaveHousehold: async (householdId) => {
        const { error } = await supabase.rpc('leave_household', { p_household: householdId });
        if (error) return { error: friendlyError(error.message, t) };
        // Leaving the active one hands over to whatever remains; the derived
        // `household` above falls back to the first, and local lists take over
        // if that was the last household.
        await refresh();
        return {};
      },
      setDisplayName: async (name) => {
        if (!user) return { error: t('householdError.signInFirst') };
        const clean = name.trim();
        if (!clean) return { error: t('householdError.nameRequired') };
        // Applies to every membership at once — household_members has no UPDATE
        // policy, so this has to go through the definer RPC.
        const { error } = await supabase.rpc('set_display_name', { p_name: clean });
        if (error) return { error: friendlyError(error.message, t) };
        // ...and to the device copy, which is the *only* copy until you're in a
        // household: the RPC updates membership rows, so with none it succeeds
        // having changed nothing and the new name would vanish on the next
        // render.
        await rememberName(clean);
        sigRef.current = '';
        await refresh();
        return {};
      },
      removeMember: async (householdId, userId) => {
        const { error } = await supabase.rpc('remove_member', {
          p_household: householdId,
          p_user: userId,
        });
        if (error) return { error: friendlyError(error.message, t) };
        await refresh();
        return {};
      },
    }),
    [
      households,
      household,
      activeId,
      restored,
      setActiveHousehold,
      adoptHousehold,
      incomingRequests,
      outgoingRequests,
      members,
      byHousehold,
      myName,
      rememberName,
      loading,
      needsHousehold,
      refresh,
      user,
      t,
    ],
  );

  // Live household updates (e.g. a rename by another member) reach everyone via
  // the realtime channel; the membership poll/foreground refresh is the backstop.
  // While backgrounded we hold no socket — the foreground refresh above catches
  // any rename that landed while we were away, then this re-subscribes.
  // Unfiltered: RLS already limits the rows we can see to our own households, so
  // one subscription covers all of them — a rename in the household you're not
  // currently looking at still lands, and switching to it shows the new name.
  useEffect(() => {
    if (!user || !appActive) return;
    const channel = supabase
      .channel(`households-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households' }, () => {
        sigRef.current = '';
        void refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refresh, appActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider');
  return ctx;
}
