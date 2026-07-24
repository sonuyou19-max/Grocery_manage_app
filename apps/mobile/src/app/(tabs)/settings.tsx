import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Card } from '@/components/card';
import { LocaleSetup } from '@/components/locale-setup';
import { Screen } from '@/components/screen';
import { languageByCode, regionByCode } from '@/i18n';
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { normalizeKey } from '@/lib/pantry-intel';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useHousehold, type Member } from '@/store/household';
import { useLocale, useT } from '@/store/locale';
import { DEMO_KEYS, usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

const AVATAR_COLORS = ['#4C8A5C', '#B97F14', '#8A5A44', '#3B6EA5', '#8455A0'];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { user, signOut, deleteAccount } = useAuth();
  const { household, members, renameHousehold, leaveHousehold, removeMember } = useHousehold();
  const { seedDemo } = usePantryIntel();
  const { lists, deleteItem } = useGroceries();
  const { region, language, setLocale, t } = useLocale();
  const [localeOpen, setLocaleOpen] = useState(false);

  // Dev preview: clear any prior sample items off lists so the deck refills,
  // then reseed and open the Vibe Check. (No-op cost in production — hidden.)
  const previewVibeCheck = () => {
    for (const list of lists) {
      for (const it of list.items) {
        if (DEMO_KEYS.includes(normalizeKey(it.name))) deleteItem(list.id, it.id);
      }
    }
    seedDemo();
    router.push('/vibe-check');
  };

  const iAmOwner = members.find((m) => m.user_id === user?.id)?.role === 'owner';

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const openRename = () => {
    setNameDraft(household?.name ?? '');
    setRenaming(true);
  };

  const submitRename = async () => {
    const next = nameDraft.trim();
    if (!next) return;
    setSavingName(true);
    const { error } = await renameHousehold(next);
    setSavingName(false);
    setRenaming(false);
    if (error) Alert.alert(t('settings.renameFailTitle'), error);
  };

  const confirmSignOut = () =>
    Alert.alert(t('settings.signOut'), t('settings.signOutMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const [deleting, setDeleting] = useState(false);

  // Permanent account + data deletion (GDPR erasure / App Store requirement).
  // Two-step confirm since it can't be undone and may delete a shared household.
  const confirmDeleteAccount = () => {
    const others = members.length > 1;
    const detail = others
      ? t('settings.deleteDetailOwner')
      : t('settings.deleteDetailSolo');
    Alert.alert(t('settings.deleteAccountTitle'), t('settings.deleteCantUndo', { detail }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('settings.areYouSure'), t('settings.deleteFinal'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('settings.deleteAccount'),
              style: 'destructive',
              onPress: async () => {
                setDeleting(true);
                const { error } = await deleteAccount();
                setDeleting(false);
                if (error) Alert.alert(t('settings.deleteFailTitle'), error);
              },
            },
          ]),
      },
    ]);
  };

  const openLegal = (doc: 'privacy' | 'terms') => {
    const url = doc === 'privacy' ? PRIVACY_URL : TERMS_URL;
    if (url) void Linking.openURL(url);
    else router.push({ pathname: '/legal', params: { doc } });
  };

  const shareInvite = () => {
    if (!household) return;
    void Share.share({
      message: t('settings.shareInvite', {
        name: household.name,
        code: household.invite_code,
      }),
    });
  };

  const confirmRemove = (member: Member) =>
    Alert.alert(
      t('settings.removeMemberTitle'),
      t('settings.removeMemberMessage', {
        name: member.display_name,
        household: household?.name ?? '',
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.remove'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await removeMember(member.user_id);
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
          const { error } = await leaveHousehold();
          if (error) Alert.alert(t('settings.leaveFailTitle'), error);
        },
      },
    ]);
  };

  return (
    <Screen title={t('settings.screenTitle')} subtitle={t('settings.screenSubtitle')}>
      {/* Account */}
      <Text style={[type.label, { color: colors.muted }]}>{t('settings.account')}</Text>
      {user ? (
        <Card>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={26} color={colors.accent} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {user.email}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>{t('settings.signedIn')}</Text>
            </View>
            <Pressable onPress={confirmSignOut} hitSlop={8}>
              <Text style={[type.body, { color: colors.crit }]}>{t('settings.signOut')}</Text>
            </Pressable>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.line }]} />
          <Pressable
            onPress={confirmDeleteAccount}
            disabled={deleting}
            style={styles.row}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={22} color={colors.crit} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.crit }]}>
                {deleting ? t('settings.deleting') : t('settings.deleteAccount')}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('settings.deleteAccountHint')}
              </Text>
            </View>
          </Pressable>
        </Card>
      ) : (
        <Pressable onPress={() => router.push('/auth/sign-in')}>
          <Card accented>
            <View style={styles.row}>
              <Ionicons name="log-in-outline" size={24} color={colors.accent} />
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]}>{t('settings.signInCta')}</Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('settings.signInHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </View>
          </Card>
        </Pressable>
      )}

      {/* Household */}
      {user && (
        <>
          <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
            {t('settings.household')}
          </Text>
          {household ? (
            <Card>
              <View style={styles.row}>
                <Ionicons name="home-outline" size={22} color={colors.accent} />
                <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                  {household.name}
                </Text>
                {iAmOwner && (
                  <Pressable onPress={openRename} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={20} color={colors.accent} />
                  </Pressable>
                )}
              </View>

              <View style={[styles.divider, { backgroundColor: colors.line }]} />

              {members.map((m, i) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  index={i}
                  isMe={m.user_id === user.id}
                  canRemove={iAmOwner && m.user_id !== user.id && m.role !== 'owner'}
                  onRemove={() => confirmRemove(m)}
                />
              ))}

              <View style={[styles.divider, { backgroundColor: colors.line }]} />

              <Pressable onPress={shareInvite} style={styles.row}>
                <Ionicons name="share-outline" size={20} color={colors.accent} />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]}>{t('settings.inviteSomeone')}</Text>
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {t('settings.codeLabel', { code: household.invite_code })}
                  </Text>
                </View>
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
          ) : (
            <Pressable onPress={() => router.push('/auth/household')}>
              <Card accented>
                <View style={styles.row}>
                  <Ionicons name="home-outline" size={22} color={colors.accent} />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>{t('settings.setUpHousehold')}</Text>
                    <Text style={[type.sub, { color: colors.muted }]}>{t('settings.setUpHouseholdHint')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </View>
              </Card>
            </Pressable>
          )}
        </>
      )}

      {/* Appearance */}
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
        {t('settings.appearance')}
      </Text>
      <Card>
        <Text style={[type.body, { color: colors.ink }]}>{t('settings.appearanceTitle')}</Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          {t('settings.appearanceHint')}
        </Text>
      </Card>

      {/* Region & language — changeable anytime; reuses the first-launch chooser. */}
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
        {t('settings.localeSection')}
      </Text>
      <Card>
        <Pressable onPress={() => setLocaleOpen(true)} style={styles.row} hitSlop={6}>
          <Ionicons name="globe-outline" size={22} color={colors.accent} />
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]}>{t('settings.language')}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {(languageByCode(language)?.endonym ?? language) +
                ' · ' +
                (regionByCode(region)?.name ?? region)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </Card>

      {/* Legal — reachable in-app (store-review requirement); opens the hosted
          URL when one is configured, otherwise the bundled screen. */}
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
        {t('settings.legal')}
      </Text>
      <Card>
        <Pressable onPress={() => openLegal('privacy')} style={styles.row} hitSlop={6}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
          <Text style={[type.body, styles.grow, { color: colors.ink }]}>{t('settings.privacy')}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Pressable onPress={() => openLegal('terms')} style={styles.row} hitSlop={6}>
          <Ionicons name="document-text-outline" size={22} color={colors.accent} />
          <Text style={[type.body, styles.grow, { color: colors.ink }]}>{t('settings.terms')}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </Card>

      {/* Dev-only: load sample data to preview the Vibe Check without waiting days. */}
      {__DEV__ && (
        <>
          <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>Developer</Text>
          <Pressable onPress={previewVibeCheck}>
            <Card>
              <View style={styles.row}>
                <Ionicons name="flask-outline" size={22} color={colors.accent} />
                <Text style={[type.body, styles.grow, { color: colors.ink }]}>Preview Vibe Check</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </View>
            </Card>
          </Pressable>
          <Pressable onPress={() => router.push('/onboarding')}>
            <Card>
              <View style={styles.row}>
                <Ionicons name="book-outline" size={22} color={colors.accent} />
                <Text style={[type.body, styles.grow, { color: colors.ink }]}>Preview tutorial</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </View>
            </Card>
          </Pressable>
        </>
      )}

      {/* Rename household — cross-platform (Alert.prompt is iOS-only). */}
      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        {/* "padding" on Android too: modal windows don't auto-resize for the
            keyboard, so undefined left the card behind it on small screens. */}
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropFill} onPress={() => setRenaming(false)} />
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[type.h2, { color: colors.ink }]}>{t('settings.renameTitle')}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              {t('settings.renameHint')}
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={t('settings.householdNamePlaceholder')}
              placeholderTextColor={colors.muted}
              style={[styles.modalInput, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line }]}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={submitRename}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenaming(false)} style={styles.modalBtn}>
                <Text style={[type.body, { color: colors.muted }]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={submitRename}
                disabled={!nameDraft.trim() || savingName}
                style={[
                  styles.modalBtn,
                  styles.modalSave,
                  { backgroundColor: colors.accent, opacity: nameDraft.trim() && !savingName ? 1 : 0.45 },
                ]}
              >
                <Text style={[type.body, { color: colors.accentInk }]}>
                  {savingName ? t('settings.saving') : t('common.save')}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change region + language — reuses the first-launch chooser full-screen. */}
      <Modal
        visible={localeOpen}
        animationType="slide"
        onRequestClose={() => setLocaleOpen(false)}
      >
        <LocaleSetup
          onCancel={() => setLocaleOpen(false)}
          onDone={(r, l) => {
            setLocale(r, l);
            setLocaleOpen(false);
          }}
        />
      </Modal>
    </Screen>
  );
}

function MemberRow({
  member,
  index,
  isMe,
  canRemove,
  onRemove,
}: {
  member: Member;
  index: number;
  isMe: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const t = useT();
  const initials = member.display_name.slice(0, 2).toUpperCase();
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
        {member.display_name}
        {isMe ? ` ${t('settings.you')}` : ''}
      </Text>
      {member.role === 'owner' && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('settings.owner')}</Text>
      )}
      {canRemove && (
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="remove-circle-outline" size={22} color={colors.crit} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  divider: { height: 1, marginVertical: spacing.xs },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(12,18,10,0.45)',
  },
  modalBackdropFill: { ...StyleSheet.absoluteFillObject },
  modalCard: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  modalBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSave: { minWidth: 96 },
});
