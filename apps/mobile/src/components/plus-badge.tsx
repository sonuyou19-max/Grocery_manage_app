import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useEntitlement } from '@/store/entitlement';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "You have Plus" — in the dashboard header, next to the wallet.
 *
 * ---------------------------------------------------------------------------
 * Why the header and not the greeting line
 * ---------------------------------------------------------------------------
 *
 * The header is chrome the user passes every single launch, and it does not
 * reflow: the greeting already carries a name and the subtitle already carries
 * a household switcher, both of which grow with translation and with whatever
 * the user typed. A badge wedged in there would sometimes wrap onto its own
 * line and sometimes not. Beside the wallet button it is always in the same
 * place, at the same size, next to the app's other bit of status.
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
