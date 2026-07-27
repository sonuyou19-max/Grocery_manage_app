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
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort
  }
}
