import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { billingAvailable } from '@/lib/billing';
import { haptics } from '@/lib/haptics';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * What a free account is not seeing, and why it would be worth having.
 *
 * Stands in for the three cards Plus unlocks rather than sitting alongside
 * them, so it occupies the same place in the feed they would have — the reader
 * finds it where the missing thing was, not bolted to the top of a tab they
 * came to for something else.
 *
 * ---------------------------------------------------------------------------
 * No blur, no fake data
 * ---------------------------------------------------------------------------
 *
 * Deliberately not the Teaser treatment used for signed-out guests. That one
 * blurs invented figures, which works when the person has no data at all and
 * the question is "what is this tab even for". A signed-in free user has
 * already answered that: they are looking at their own real numbers directly
 * above this card. Smearing a fabricated version of the same thing underneath
 * would be noise at best and, at worst, read as their own history being held
 * back from them.
 *
 * ---------------------------------------------------------------------------
 * It says nothing is lost, because nothing is
 * ---------------------------------------------------------------------------
 *
 * The single most important line here is that the history still exists.
 * Migration 0025 never deletes a row for non-payment; lapsing narrows a query
 * and nothing else, and resubscribing brings the whole year straight back. If
 * this card left that ambiguous, the reasonable assumption would be that Korb
 * throws your data away when you stop paying — which would be a good reason
 * never to start.
 *
 * ---------------------------------------------------------------------------
 * The button appears only when it can be honoured
 * ---------------------------------------------------------------------------
 *
 * `billingAvailable()` is false in Expo Go and in any build without a
 * RevenueCat key, and in those the card explains Plus and stops there. A call
 * to action that opens a paywall which cannot take money is worse than no call
 * to action at all — the reader concludes the app is broken rather than that
 * the feature is unfinished.
 */
export function PlusCard({ freeWeeks }: { freeWeeks: number }) {
  const { colors } = useTheme();
  const t = useT();

  const perks: Array<{ icon: keyof typeof Ionicons.glyphMap; text: string }> = [
    { icon: 'time-outline', text: t('plus.perkHistory') },
    { icon: 'swap-vertical-outline', text: t('plus.perkMoves') },
    { icon: 'trending-down-outline', text: t('plus.perkCheaper') },
    { icon: 'sparkles-outline', text: t('plus.perkRecap') },
  ];

  return (
    <Card>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        </View>
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>{t('plus.title')}</Text>
      </View>

      <Text style={[type.sub, { color: colors.muted }]}>
        {t('plus.showingWeeks', { count: freeWeeks })}
      </Text>

      <View style={styles.perks}>
        {perks.map((p) => (
          <View key={p.icon} style={styles.perkRow}>
            <Ionicons name={p.icon} size={16} color={colors.accent} />
            <Text style={[type.sub, styles.grow, { color: colors.ink }]}>{p.text}</Text>
          </View>
        ))}
      </View>

      {/* The reassurance, held apart from the sales pitch above it so it reads
          as a statement of fact rather than as one more bullet. */}
      <Text style={[type.sub, { color: colors.muted }]}>{t('plus.nothingLost')}</Text>

      {billingAvailable() && (
        <Pressable
          onPress={() => {
            haptics.tick();
            router.push('/paywall');
          }}
          accessibilityRole="button"
          style={[styles.cta, { backgroundColor: colors.accent }]}
        >
          <Text style={[type.body, { color: colors.accentInk }]}>{t('plus.see')}</Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perks: { gap: spacing.xs, marginVertical: spacing.sm },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cta: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
});
