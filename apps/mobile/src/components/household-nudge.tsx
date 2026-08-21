import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { useToast } from '@/components/toast';
import { haptics } from '@/lib/haptics';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * "You're signed in, but nothing is being backed up."
 *
 * ---------------------------------------------------------------------------
 * The state this exists for
 * ---------------------------------------------------------------------------
 *
 * Nothing in Korb is stored in the cloud except inside a household, so a
 * signed-in account with none is a real and quiet failure: the app looks
 * signed in, everything works, and every list goes to AsyncStorage.
 *
 * It is meant to be unreachable. Sign-up creates a household immediately and
 * without asking, precisely so a solo shopper never has to name a thing they
 * did not know they needed. But that write is deliberately non-fatal — being
 * signed in with no household beats being unable to finish signing in — so a
 * network blip at that exact moment lands here, and nothing said so. The person
 * would find out weeks later, on a new phone, with nothing on it.
 *
 * ---------------------------------------------------------------------------
 * Why the tap finishes the job rather than opening a form
 * ---------------------------------------------------------------------------
 *
 * The obvious wiring is to push /auth/household, and it is wrong for the same
 * reason sign-up does not: that screen asks you to name a household. "Create a
 * household" is jargon to someone who wanted their shopping backed up, and
 * being asked for it here is worse than at sign-up, because now it arrives as
 * the price of fixing a problem the app caused.
 *
 * So the tap does exactly what sign-up would have done — creates the same
 * default household, under the same name, from the name we already hold. The
 * form is only reached when we genuinely do not know what to call it, which
 * means the same interruption also lost the name.
 *
 * ---------------------------------------------------------------------------
 * Why a nudge and not a block
 * ---------------------------------------------------------------------------
 *
 * The app is not broken in this state. Lists work, the pantry learns, prices
 * are logged — on the device, exactly as for someone who has never signed in.
 * Blocking the screen would take a working app away over a problem the user did
 * not cause. And nothing is lost by waiting: sign-out reset the migration
 * flags, so whatever they build in the meantime is carried up when this
 * eventually runs.
 *
 * ---------------------------------------------------------------------------
 * Why it cannot be dismissed
 * ---------------------------------------------------------------------------
 *
 * A dismissed banner leaves the user where they were, minus the only thing that
 * would ever have told them. Nothing else in the app reports this. It goes away
 * when a household exists, which is the only honest way for it to go.
 */
export function HouseholdNudge() {
  const { colors } = useTheme();
  const { needsHousehold, createHousehold, myName } = useHousehold();
  const { showToast } = useToast();
  const t = useT();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only after the roster has been fetched for THIS user — see the field's note
  // in store/household. `households` is empty for a moment on every launch, and
  // the naive check tells people with a perfectly good household that their
  // shopping is not backed up.
  if (!needsHousehold) return null;

  const fix = async () => {
    haptics.tick();
    const name = myName?.trim();
    if (!name) {
      // No name on record, so there is nothing to build a household name from.
      // The form asks for both, which is the right place for a case where the
      // interruption cost us more than one answer.
      router.push('/auth/household');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createHousehold(t('household.defaultName', { name }), name);
    setBusy(false);
    if (result.error) {
      // Shown in place and the card stays: whatever stopped this the first time
      // is most likely still true, and the next tap is the retry.
      setError(result.error);
      return;
    }
    haptics.success();
    showToast(t('household.nudgeDone'));
  };

  return (
    <Pressable
      onPress={() => void fix()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={t('household.nudgeTitle')}
      accessibilityState={{ disabled: busy, busy }}
    >
      <Card accented>
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={26} color={colors.warn} />
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]}>{t('household.nudgeTitle')}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {error ?? t('household.nudgeBody')}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.accent} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});
