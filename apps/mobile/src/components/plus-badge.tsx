import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useEntitlement } from '@/store/entitlement';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The tier, on the dashboard's status line beside the household name.
 *
 * Two states, one slot. A subscriber or trial user gets the gradient pill; an
 * account without Plus gets an outlined "Unlock Plus" that goes to the same
 * place. One thing lives here and it always says where you stand.
 *
 * ---------------------------------------------------------------------------
 * Why the ask is outlined and the reward is filled
 * ---------------------------------------------------------------------------
 *
 * The gradient earns its brightness by being something you have. Reusing it to
 * advertise costs both: the badge stops reading as status and starts reading as
 * an ad, and it would then be the brightest thing on the main screen at every
 * single launch, forever, for somebody who has already decided not to pay. An
 * outlined pill in the accent colour is unmistakably a button and unmistakably
 * secondary, which is the correct volume for a standing offer.
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
 * Tapping either state opens the paywall — where a subscriber sees when it
 * renews and everybody else sees what it costs.
 *
 * Renders nothing at all when the tier is not live. Before billing goes live
 * nothing is withheld from anyone, so an "Unlock Plus" button would be selling
 * something that is not for sale; `tierLive` is the same switch the rest of the
 * gate reads, so this disappears and reappears with it.
 */
export function PlusBadge() {
  const { entitled, trialEndsAt, subscribedUntil } = useEntitlement();
  const { requirePlus, tierLive } = usePlusGate();
  const t = useT();
  const { colors } = useTheme();

  if (!entitled && !tierLive) return null;

  // Days are only shown for a real trial. A paying subscriber has a
  // trialEndsAt in the past or future depending on when they signed up, and
  // counting THAT down would tell them their subscription is about to end.
  const onTrial = !subscribedUntil && trialEndsAt != null && trialEndsAt > Date.now();
  const days = onTrial ? Math.ceil((trialEndsAt - Date.now()) / 86_400_000) : null;
  const label = entitled
    ? days != null
      ? t('plus.badgeTrial', { count: days })
      : t('plus.badge')
    : t('plus.unlock');

  return (
    <Pressable
      onPress={() => {
        haptics.tick();
        requirePlus();
      }}
      accessibilityRole="button"
      accessibilityLabel={entitled ? t('plus.title') : t('plus.unlock')}
      hitSlop={8}
    >
      {entitled ? (
        <LinearGradient
          colors={[colors.plusFrom, colors.plusTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pill}
        >
          <Ionicons name="sparkles" size={12} color="#FFFFFF" />
          <Text style={[type.label, styles.onGradient]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.pill, styles.outlined, { borderColor: colors.accent }]}>
          <Ionicons name="sparkles-outline" size={12} color={colors.accent} />
          <Text style={[type.label, { color: colors.accent }]}>{label}</Text>
        </View>
      )}
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
  // The border is inside the same padding as the filled pill, so the two states
  // are the same height and the status line does not jog when the trial ends.
  outlined: { borderWidth: 1, backgroundColor: 'transparent' },
  onGradient: { color: '#FFFFFF' },
});
