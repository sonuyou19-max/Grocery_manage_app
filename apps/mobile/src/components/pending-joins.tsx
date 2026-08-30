import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { useToast } from '@/components/toast';
import { haptics } from '@/lib/haptics';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * "You've asked to join Smith Family. Waiting for them to say yes."
 *
 * ---------------------------------------------------------------------------
 * The state this exists for
 * ---------------------------------------------------------------------------
 *
 * A pending requester is invisible to themselves. RLS gives them nothing about
 * the household they asked about — not the row, not the lists, not the members
 * — so without this card the app is exactly as it was before they entered the
 * code, and the only record that anything happened was a screen they have since
 * closed.
 *
 * That is the specific way an approval gate goes wrong. The old behaviour let
 * anyone in with a code, which was too permissive; a gate that leaves people
 * unable to tell whether they are queued, rejected or mistaken is worse,
 * because now they have no route at all and no reason to think one exists.
 *
 * ---------------------------------------------------------------------------
 * Why the way out is here
 * ---------------------------------------------------------------------------
 *
 * Withdrawing belongs beside the thing being withdrawn, not on the screen that
 * created it — that screen is a form somebody filled in once and closed. The
 * case is ordinary and worth one tap: a mistyped code names a real household
 * belonging to strangers, and there is no other way to take it back.
 */
export function PendingJoins() {
  const { colors } = useTheme();
  const { outgoingRequests, cancelRequest } = useHousehold();
  const { showToast } = useToast();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  if (outgoingRequests.length === 0) return null;

  return (
    <Card>
      <View style={styles.head}>
        <Ionicons name="hourglass-outline" size={20} color={colors.muted} />
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>
          {t('join.waitingTitle')}
        </Text>
      </View>

      {outgoingRequests.map((r) => (
        <View key={r.id} style={[styles.row, { borderColor: colors.line }]}>
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
              {r.household_name}
            </Text>
            {/*
              THREE SENTENCES WHERE THERE WAS ONE.

              "Waiting to be let in" was true of four completely different
              situations — the code was wrong, the app is broken, nobody who can
              answer has opened Korb, or somebody has seen it and not decided —
              and a person stuck in any of them could not tell which. That is
              the specific way an approval gate is worse than no gate: the old
              behaviour was too permissive, but it never stranded anybody.

              LAPSED is said plainly and without blame. Nobody did anything
              wrong; the request simply stood for a fortnight, and the only
              useful thing to say is that asking again will work.
            */}
            <Text
              style={[type.sub, { color: r.lapsed ? colors.warn : colors.muted }]}
            >
              {r.lapsed
                ? t('join.lapsed')
                : r.seen_at
                  ? t('join.waitingSeen')
                  : t('join.waitingUnseen')}
            </Text>
          </View>
          {busy === r.id ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Pressable
              onPress={async () => {
                setBusy(r.id);
                haptics.tick();
                const { error } = await cancelRequest(r.id);
                setBusy(null);
                if (error) {
                  showToast(error);
                  return;
                }
                showToast(t('join.withdrawn', { household: r.household_name }));
              }}
              accessibilityRole="button"
              accessibilityLabel={t('join.withdrawFor', { household: r.household_name })}
              hitSlop={8}
              style={styles.withdraw}
            >
              <Text style={[type.sub, { color: colors.muted }]}>
                {r.lapsed ? t('common.close') : t('join.withdraw')}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  withdraw: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
});
