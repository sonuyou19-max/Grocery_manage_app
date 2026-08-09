import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-run flag. The feature tour shows once per install: we set this the first
 * time the user finishes or skips it, and never show it again. Bump the version
 * suffix if we ever want everyone to see a refreshed tour.
 */
const KEY = 'korb.onboarded.v1';

/**
 * Cached answer, so the dashboard can decide on its first render.
 *
 * Reading this from storage *after* mounting is what made the tour appear a beat
 * late — the dashboard painted, the promise resolved, and only then did the tour
 * slide over the top of it. Hydrated at app start alongside the other on-device
 * caches; `null` means we haven't found out yet.
 */
let seenCache: boolean | null = null;

export async function hydrateOnboarding(): Promise<void> {
  try {
    seenCache = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // Fail closed — if storage is unreadable, don't nag with the tour.
    seenCache = true;
  }
}

/**
 * Whether the tour is still owed, decided synchronously. `null` while the
 * hydration above is in flight; callers should do nothing until it resolves
 * rather than guessing, since guessing wrong shows the tour twice.
 */
export function onboardingSeen(): boolean | null {
  return seenCache;
}

export async function hasSeenOnboarding(): Promise<boolean> {
  if (seenCache !== null) return seenCache;
  await hydrateOnboarding();
  return seenCache ?? true;
}

export async function markOnboardingSeen(): Promise<void> {
  // Update the cache FIRST, and synchronously.
  //
  // Without this the tour showed twice: storage was written, but `seenCache`
  // stayed false for the rest of the session, so the very next component that
  // asked `onboardingSeen()` was told the tour was still owed. The await below
  // is far too late — the dashboard re-reads the answer within the same frame
  // the tour dismisses.
  seenCache = true;
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort: the in-memory answer is right for this session either way,
    // and a failed write only means the tour returns on the next cold start.
  }
}

/**
 * The "get started" prompt shown once, straight after the tour.
 *
 * A separate flag from the tour's, not a second meaning bolted onto it: the two
 * can be dismissed independently, and someone who skips the tour still deserves
 * to be told once that an account exists. Same cache-first shape as above so the
 * decision is available on the first render.
 */
const START_KEY = 'korb.getStarted.v1';

let startCache: boolean | null = null;

export async function hydrateGetStarted(): Promise<void> {
  try {
    startCache = (await AsyncStorage.getItem(START_KEY)) === '1';
  } catch {
    // Fail closed — never nag on a device whose storage is unreadable.
    startCache = true;
  }
}

/** Whether the prompt is still owed. `null` while hydration is in flight. */
export function getStartedSeen(): boolean | null {
  return startCache;
}

export async function markGetStartedSeen(): Promise<void> {
  // Synchronously first, for the same reason as markOnboardingSeen.
  startCache = true;
  try {
    await AsyncStorage.setItem(START_KEY, '1');
  } catch {
    // best-effort
  }
}

/**
 * Both first-run flags, read together.
 *
 * components/boot-gate holds the loading screen until this resolves, so the
 * dashboard's FIRST render already knows whether the tour is owed. Reading them
 * after the dashboard mounts is what made the tour slide in over an
 * already-painted empty screen.
 *
 * Neither call below can reject — each catches its own storage failure and
 * fails closed — so this settles unconditionally, which is what makes it safe
 * to wait on.
 */
export async function hydrateFirstRunFlags(): Promise<void> {
  await Promise.all([hydrateOnboarding(), hydrateGetStarted()]);
}
