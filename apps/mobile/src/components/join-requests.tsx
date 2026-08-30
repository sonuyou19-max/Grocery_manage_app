import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { useToast } from '@/components/toast';
import { haptics } from '@/lib/haptics';
import { useHousehold, type JoinRequest } from '@/store/household';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "Sam is asking to join Smith Family."
 *
 * ---------------------------------------------------------------------------
 * Why this is a card on the first screen and not a settings row
 * ---------------------------------------------------------------------------
 *
 * Somebody is waiting. Every hour this is not seen is an hour a person who was
 * told to enter a code sits looking at "waiting for approval", with no way to
 * tell whether the code was wrong, the app is broken, or they are simply being
 * ignored. A queue nobody visits is worse than no approval step at all: the old
 * behaviour let people in without asking, which was too permissive but at least
 * never left them stranded.
 *
 * So it goes where the app already puts the one other thing it must not let you
 * miss — the top of the lists tab, beside HouseholdNudge — and it cannot be
 * dismissed. Dismissing would leave the request pending and remove the only
 * thing in the app that mentions it.
 *
 * ---------------------------------------------------------------------------
 * What it does NOT do
 * ---------------------------------------------------------------------------
 *
 * It does not send a push notification, and that is a real limit rather than an
 * oversight: this app has no notification infrastructure at all — no tokens, no
 * permission prompt, no server to send from. Until it does, "the owner gets a
 * nudge" means the next time they open Korb, which for a household app is
 * usually the same day and is emphatically not the same as immediately.
 *
 * ---------------------------------------------------------------------------
 * Members see it; only owners can answer it
 * ---------------------------------------------------------------------------
 *
 * The read policy is deliberately the whole household (migration 0042), so a
 * household where one person quietly admits people is not possible. A member
 * who is not the owner sees the request and is told whose decision it is, which
 * is more use than an empty screen and a housemate wondering why nothing
 * happens.
 */
export function JoinRequests() {
  const { colors } = useTheme();
  const { incomingRequests, isOwnerOf, decideRequest } = useHousehold();
  const { showToast } = useToast();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  if (incomingRequests.length === 0) return null;

  return (
    <Card>
      <View style={styles.head}>
        <Ionicons name="person-add-outline" size={20} color={colors.accent} />
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>
          {t('join.queueTitle', { count: incomingRequests.length })}
        </Text>
      </View>
      <Text style={[type.sub, { color: colors.muted }]}>{t('join.queueHint')}</Text>

      {incomingRequests.map((r) => (
        <Row
          key={r.id}
          request={r}
          /*
           * Whether THIS user owns THIS household, asked per request rather
           * than once: an owner of one household is an ordinary member of
           * another, and the queue mixes them. Asked of the roster the app
           * already holds — the server checks it again on the way in, and this
           * is only deciding which buttons to draw.
           */
          canDecide={isOwnerOf(r.household_id)}
          busy={busy === r.id}
          onDecide={async (approve) => {
            setBusy(r.id);
            haptics.tick();
            const { error } = await decideRequest(r.id, approve);
            setBusy(null);
            if (error) {
              showToast(error);
              return;
            }
            haptics.success();
            showToast(
              approve
                ? t('join.approved', { name: r.display_name })
                : t('join.declined', { name: r.display_name }),
            );
          }}
        />
      ))}
    </Card>
  );
}

function Row({
  request,
  canDecide,
  busy,
  onDecide,
}: {
  request: JoinRequest;
  canDecide: boolean;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const { colors } = useTheme();
  const t = useT();

  return (
    <View style={[styles.row, { borderColor: colors.line }]}>
      <View style={styles.grow}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {request.display_name}
        </Text>
        {/*
          The household is named on every row, not just when there are several.
          An owner of one household knows which one this is; an owner of three
          does not, and a row that only sometimes says would be a row you cannot
          learn to read.
        */}
        <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
          {t('join.wantsToJoin', { household: request.household_name })}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : canDecide ? (
        <View style={styles.actions}>
          {/*
            Decline first, approve second, and approve is the filled one.
            Reading order puts the destructive answer where a thumb is least
            likely to be, and the affirmative one is what this card is for —
            somebody the owner invited is at the door.
          */}
          <Pressable
            onPress={() => onDecide(false)}
            accessibilityRole="button"
            accessibilityLabel={t('join.declineFor', { name: request.display_name })}
            style={[styles.btn, { borderColor: colors.line }]}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
          <Pressable
            onPress={() => onDecide(true)}
            accessibilityRole="button"
            accessibilityLabel={t('join.approveFor', { name: request.display_name })}
            style={[styles.btn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
          >
            <Ionicons name="checkmark" size={18} color={colors.accentInk} />
          </Pressable>
        </View>
      ) : (
        // Not yours to answer. Said rather than left blank: a member staring at
        // a request with no buttons would reasonably think the app was broken.
        <Text style={[type.label, styles.ownerOnly, { color: colors.muted }]}>
          {t('join.ownerDecides')}
        </Text>
      )}
    </View>
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
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerOnly: { maxWidth: 96, textAlign: 'right' },
});
