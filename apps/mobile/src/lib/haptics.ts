import * as Haptics from 'expo-haptics';

/**
 * System-level haptics tied to physical-feeling actions. Every call is
 * fire-and-forget and safe on platforms without a taptic engine (it no-ops).
 *
 *  - tick    → light: checking off an item, picking up a card to drag.
 *  - snap    → rigid: crossing a swipe threshold, moving between slots/categories.
 *  - success → notification: finishing a shopping trip (everything ticked off).
 */
export const haptics = {
  tick: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  snap: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
  },
  success: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
};
