import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useEntitlement } from '@/store/entitlement';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * One quiet word, near the end of the free month.
 *
 * ---------------------------------------------------------------------------
 * Why say anything at all
 * ---------------------------------------------------------------------------
 *
 * Korb's trial takes no card and turns into nothing — it simply stops. That is
 * the honest design, and it has one cost: somebody can lose access to their
 * spending history without ever being told it was going to happen. Being
 * surprised by a downgrade feels worse than being asked, even though nobody was
 * charged. So: told once, in advance, with a way to act on it.
 *
 * ---------------------------------------------------------------------------
 * The rules that keep it from being a nag
 * ---------------------------------------------------------------------------
 *
 *  - Only in the last few days. Earlier than that and it is an advert.
 *  - Only when the gate is actually on. Before launch nothing is withheld when
 *    a trial ends, so warning about it would be a lie.
 *  - Only when there is something to buy. No key, no store, no banner.
 *  - Dismissible, and the dismissal sticks forever. Not "until tomorrow" —
 *    someone who closes this has answered the question.
 *
 * The dismissal flag is deliberately not cleared on sign-out (unlike the
 * shopping data in lib/local-data.ts). It records a decision this person made,
 * not anything about their groceries, and re-asking on the next sign-in would
 * defeat the point of a one-time prompt.
 */

const DISMISSED_KEY = 'korb.trialNudgeDismissed.v1';

/** How close to the end before it is worth mentioning. */
const WARN_WITHIN_DAYS = 5;

export function TrialNudge() {
  const { colors } = useTheme();
  const t = useT();
  const { trialEndsAt, subscribedUntil } = useEntitlement();
  // From the shared hook, not rebuilt here — see lib/plus-gate.ts. This banner
  // warns about LOSING Plus, so it needs both halves: the person must currently
  // have it, and the tier must be switched on, or the warning is about nothing.
  const { entitled, tierLive, requirePlus } = usePlusGate();
  // `null` while we are still asking storage. Rendering nothing until then
  // stops the banner appearing for a frame and vanishing for someone who
  // already dismissed it.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(true));
  }, []);

  const daysLeft =
    trialEndsAt && trialEndsAt > Date.now()
      ? Math.ceil((trialEndsAt - Date.now()) / 86_400_000)
      : null;

  const show =
    dismissed === false &&
    // `tierLive`, not `locked`. Locked is false for exactly the people this
    // warns — they still have Plus. The question is whether the tier is on at
    // all, so that losing it will mean something.
    tierLive &&
    entitled &&
    // A paying subscriber is not in a trial, even though their account still
    // has a trial-end date somewhere in the past or future. Without this they
    // would be told their free month is ending after they had already bought.
    !subscribedUntil &&
    daysLeft != null &&
    daysLeft <= WARN_WITHIN_DAYS;

  if (!show) return null;

  const close = () => {
    haptics.tick();
    setDismissed(true);
    AsyncStorage.setItem(DISMISSED_KEY, '1').catch(() => {});
  };

  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="time-outline" size={22} color={colors.accent} />
        <View style={styles.grow}>
          <Text style={[type.body, { color: colors.ink }]}>
            {t('plus.trialEndingTitle', { count: daysLeft })}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>{t('plus.trialEndingBody')}</Text>
        </View>
        <Pressable onPress={close} hitSlop={12} accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => {
          haptics.tick();
          requirePlus();
        }}
        style={[styles.cta, { backgroundColor: colors.accent }]}
      >
        <Text style={[type.body, { color: colors.accentInk }]}>{t('plus.see')}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cta: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
});
