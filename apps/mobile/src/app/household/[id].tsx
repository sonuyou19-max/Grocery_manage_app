import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { MemberAvatars } from '@/components/member-avatars';
import { MeshBackground } from '@/components/mesh-background';
import { Safe } from '@/components/safe';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { useAuth } from '@/store/auth';
import { useHousehold, type Member } from '@/store/household';
import { useT } from '@/store/locale';
import { spacing, type, useScrollIndicator, useTheme } from '@/theme';

const AVATAR_COLORS = ['#4C8A5C', '#B97F14', '#8A5A44', '#3B6EA5', '#8455A0'];

/**
 * One household: rename it, see who's in it, invite someone, leave.
 *
 * Lifted out of Settings when a user could hold several households — repeating
 * all of this inline per household made that screen unscannable.
 */
export default function HouseholdScreen() {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const t = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const {
    households,
    household: active,
    setActiveHousehold,
    membersOf,
    renameHousehold,
    leaveHousehold,
    removeMember,
  } = useHousehold();

  const household = households.find((h) => h.id === id);
  const [renaming, setRenaming] = useState(false);

  // The household can vanish while this screen is open — someone removed you, or
  // you just left it. Bail out rather than rendering an empty shell.
  if (!household) {
    return (
      <View style={styles.root}>
        <MeshBackground />
        <Safe style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={[type.sub, styles.gone, { color: colors.muted }]}>
            {t('settings.householdGone')}
          </Text>
        </Safe>
      </View>
    );
  }

  const members = membersOf(household.id);
  const iAmOwner = members.find((m) => m.user_id === user?.id)?.role === 'owner';
  const isActive = active?.id === household.id;

  const submitRename = async (next: string) => {
    setRenaming(false);
    const { error } = await renameHousehold(household.id, next);
    if (error) Alert.alert(t('settings.renameFailTitle'), error);
  };

  const shareInvite = () =>
    void Share.share({
      message: t('settings.shareInvite', {
        name: household.name,
        code: household.invite_code,
      }),
    });

  const confirmRemove = (member: Member) =>
    Alert.alert(
      t('settings.removeMemberTitle'),
      t('settings.removeMemberMessage', { name: member.display_name, household: household.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.remove'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await removeMember(household.id, member.user_id);
            if (error) Alert.alert(t('settings.removeFailTitle'), error);
          },
        },
      ],
    );

  const confirmLeave = () => {
    const soleOwner = iAmOwner && members.filter((m) => m.role === 'owner').length === 1;
    const others = members.length > 1;
    const message = !others
      ? t('settings.leaveSolo')
      : soleOwner
        ? t('settings.leaveOwner')
        : t('settings.leaveMember');
    Alert.alert(t('settings.leaveHousehold'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.leave'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await leaveHousehold(household.id);
          if (error) {
            Alert.alert(t('settings.leaveFailTitle'), error);
            return;
          }
          // This household is gone; the provider promotes another (or falls back
          // to local lists), so there's nothing left to show here.
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Safe style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} {...scrollIndicator}>
          <View style={styles.titleRow}>
            <View style={styles.grow}>
              <Text style={[type.display, { color: colors.ink }]}>{household.name}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('settings.codeLabel', { code: household.invite_code })}
              </Text>
            </View>
            {iAmOwner && (
              <Pressable onPress={() => setRenaming(true)} hitSlop={10}>
                <Ionicons name="pencil-outline" size={22} color={colors.accent} />
              </Pressable>
            )}
          </View>

          {/* Switching normally happens from the dashboard, but offering it here
              stops a household reached from Settings being a dead end. */}
          {isActive ? (
            <View style={styles.activeRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={[type.sub, { color: colors.accent }]}>
                {t('settings.activeHousehold')}
              </Text>
            </View>
          ) : (
            <Pressable onPress={() => setActiveHousehold(household.id)}>
              <Card accented>
                <View style={styles.row}>
                  <Ionicons name="swap-horizontal-outline" size={22} color={colors.accent} />
                  <Text style={[type.body, styles.grow, { color: colors.ink }]}>
                    {t('settings.makeActive')}
                  </Text>
                </View>
              </Card>
            </Pressable>
          )}

          <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
            {t('settings.membersSection')}
          </Text>
          <Card>
            {members.map((m, i) => (
              <View key={m.user_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: colors.line }]} />}
                <View style={styles.row}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] },
                    ]}
                  >
                    <Text style={styles.avatarText}>
                      {m.display_name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                    {m.display_name}
                    {m.user_id === user?.id ? ` ${t('settings.you')}` : ''}
                  </Text>
                  {m.role === 'owner' && (
                    <Text style={[type.sub, { color: colors.muted }]}>{t('settings.owner')}</Text>
                  )}
                  {iAmOwner && m.user_id !== user?.id && m.role !== 'owner' && (
                    <Pressable onPress={() => confirmRemove(m)} hitSlop={8}>
                      <Ionicons name="remove-circle-outline" size={22} color={colors.crit} />
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </Card>

          <Card>
            <Pressable onPress={shareInvite} style={styles.row}>
              <Ionicons name="share-outline" size={20} color={colors.accent} />
              <Text style={[type.body, styles.grow, { color: colors.ink }]}>
                {t('settings.inviteSomeone')}
              </Text>
              <MemberAvatars members={members.map((m) => ({ id: m.user_id, displayName: m.display_name }))} size={22} />
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
            <View style={[styles.divider, { backgroundColor: colors.line }]} />
            <Pressable onPress={confirmLeave} style={styles.row}>
              <Ionicons name="exit-outline" size={20} color={colors.crit} />
              <Text style={[type.body, styles.grow, { color: colors.crit }]}>
                {t('settings.leaveHousehold')}
              </Text>
            </Pressable>
          </Card>
        </ScrollView>
      </Safe>

      <TextPromptModal
        visible={renaming}
        title={t('settings.renameTitle')}
        placeholder={t('settings.householdNamePlaceholder')}
        confirmLabel={t('common.save')}
        onCancel={() => setRenaming(false)}
        onSubmit={submitRename}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  divider: { height: 1, marginVertical: spacing.xs },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  gone: { textAlign: 'center', marginTop: spacing.xl },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
