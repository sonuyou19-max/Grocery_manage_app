import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-run flag. The feature tour shows once per install: we set this the first
 * time the user finishes or skips it, and never show it again. Bump the version
 * suffix if we ever want everyone to see a refreshed tour.
 */
const KEY = 'korb.onboarded.v1';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // Fail closed — if storage is unreadable, don't nag with the tour.
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort
  }
}
