import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useEntitlement } from '@/store/entitlement';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "You have Plus" — on the dashboard's status line, beside the household name.
 *
 * ---------------------------------------------------------------------------
 * Why the status line and not beside the wallet
 * ---------------------------------------------------------------------------
 *
 * It was beside the wallet first, on the reasoning that the top-right corner is
 * fixed furniture and would not reflow. That was wrong, and visibly so: the
 * header row gives the title whatever width the actions leave it, so adding a
 * pill up there narrowed the greeting column until "Good afternoon, Sonu" broke
 * into three lines. The badge did not move; it pushed everything else.
 *
 * Here it sits on the line that already reports context — which household you
 * are in — and takes its width from a row that is free to wrap, so it cannot
 * squeeze the display title at any width or in any language. It also reads
 * better: household and tier are both answers to "what account am I in right
 * now", and the wallet goes back to being the header's single action.
 *
 * ---------------------------------------------------------------------------
 * It counts the trial down out loud
 * ---------------------------------------------------------------------------
 *
 * During the free month it reads "Plus · 12", not just "Plus". Korb's trial
 * takes no card and converts to nothing, so the only way somebody learns it
 * has ended is by noticing something missing. A number they walk past daily
 * turns that from a surprise into an expectation — and it costs nothing to
 * show, because it is information they are entitled to either way.
 *
 * Tapping opens the paywall, which is also where you go to see when it renews.
 * Nothing here is a gate; this component renders only for people who already
 * have Plus.
 */
export function PlusBadge() {
  const { entitled, trialEndsAt, subscribedUntil } = useEntitlement();
  const { requirePlus } = usePlusGate();
  const t = useT();
  const { colors } = useTheme();

  if (!entitled) return null;

  // Days are only shown for a real trial. A paying subscriber has a
  // trialEndsAt in the past or future depending on when they signed up, and
  // counting THAT down would tell them their subscription is about to end.
  const onTrial = !subscribedUntil && trialEndsAt != null && trialEndsAt > Date.now();
  const days = onTrial ? Math.ceil((trialEndsAt - Date.now()) / 86_400_000) : null;

  return (
    <Pressable
      onPress={() => {
        haptics.tick();
        requirePlus();
      }}
      accessibilityRole="button"
      accessibilityLabel={t('plus.title')}
      hitSlop={8}
    >
      <LinearGradient
        colors={[colors.plusFrom, colors.plusTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.pill}
      >
        <Ionicons name="sparkles" size={12} color="#FFFFFF" />
        <Text style={[type.label, styles.text]}>
          {days != null ? t('plus.badgeTrial', { count: days }) : t('plus.badge')}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  text: { color: '#FFFFFF' },
});
