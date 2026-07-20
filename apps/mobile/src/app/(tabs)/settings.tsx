import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { normalizeKey } from '@/lib/pantry-intel';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useHousehold, type Member } from '@/store/household';
import { DEMO_KEYS, usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

const AVATAR_COLORS = ['#4C8A5C', '#B97F14', '#8A5A44', '#3B6EA5', '#8455A0'];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { user, signOut, deleteAccount } = useAuth();
  const { household, members, renameHousehold, leaveHousehold, removeMember } = useHousehold();
  const { seedDemo } = usePantryIntel();
  const { lists, deleteItem } = useGroceries();

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
    if (error) Alert.alert('Couldn’t rename', error);
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'Your local lists stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const [deleting, setDeleting] = useState(false);

  // Permanent account + data deletion (GDPR erasure / App Store requirement).
  // Two-step confirm since it can't be undone and may delete a shared household.
  const confirmDeleteAccount = () => {
    const others = members.length > 1;
    const detail = others
      ? 'If you own this household, ownership passes to another member and your shared lists stay with them.'
      : 'Your household — including all its lists and pantry history — is permanently deleted.';
    Alert.alert('Delete account?', `This can’t be undone. ${detail}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Are you sure?', 'This permanently deletes your account and all your data.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete account',
              style: 'destructive',
              onPress: async () => {
                setDeleting(true);
                const { error } = await deleteAccount();
                setDeleting(false);
                if (error) Alert.alert('Couldn’t delete', error);
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
      message: `Join our "${household.name}" grocery list on Korb. Invite code: ${household.invite_code}`,
    });
  };

  const confirmRemove = (member: Member) =>
    Alert.alert('Remove member', `Remove ${member.display_name} from ${household?.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await removeMember(member.user_id);
          if (error) Alert.alert('Couldn’t remove', error);
        },
      },
    ]);

  const confirmLeave = () => {
    const soleOwner = iAmOwner && members.filter((m) => m.role === 'owner').length === 1;
    const others = members.length > 1;
    const message = !others
      ? 'You’re the only member — the household and its shared lists will be deleted.'
      : soleOwner
        ? 'You’re the owner. Ownership will pass to another member. Your household lists stay with them.'
        : 'You’ll lose access to this household’s shared lists.';
    Alert.alert('Leave household', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          const { error } = await leaveHousehold();
          if (error) Alert.alert('Couldn’t leave', error);
        },
      },
    ]);
  };

  return (
    <Screen title="Settings" subtitle="Account · household · preferences">
      {/* Account */}
      <Text style={[type.label, { color: colors.muted }]}>Account</Text>
      {user ? (
        <Card>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={26} color={colors.accent} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {user.email}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>Signed in</Text>
            </View>
            <Pressable onPress={confirmSignOut} hitSlop={8}>
              <Text style={[type.body, { color: colors.crit }]}>Sign out</Text>
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
                {deleting ? 'Deleting…' : 'Delete account'}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                Permanently remove your account and data.
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
                <Text style={[type.body, { color: colors.ink }]}>Sign in to sync & share</Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  Share lists with your household across phones.
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
            Household
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
                  <Text style={[type.body, { color: colors.ink }]}>Invite someone</Text>
                  <Text style={[type.sub, { color: colors.muted }]}>
                    Code: {household.invite_code}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>

              <View style={[styles.divider, { backgroundColor: colors.line }]} />

              <Pressable onPress={confirmLeave} style={styles.row}>
                <Ionicons name="exit-outline" size={20} color={colors.crit} />
                <Text style={[type.body, styles.grow, { color: colors.crit }]}>Leave household</Text>
              </Pressable>
            </Card>
          ) : (
            <Pressable onPress={() => router.push('/auth/household')}>
              <Card accented>
                <View style={styles.row}>
                  <Ionicons name="home-outline" size={22} color={colors.accent} />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>Set up your household</Text>
                    <Text style={[type.sub, { color: colors.muted }]}>Create one or join with a code.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </View>
              </Card>
            </Pressable>
          )}
        </>
      )}

      {/* Appearance */}
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>Appearance</Text>
      <Card>
        <Text style={[type.body, { color: colors.ink }]}>Follows your system theme</Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          Switch your phone to dark mode to see the dark theme.
        </Text>
      </Card>

      {/* Legal — reachable in-app (store-review requirement); opens the hosted
          URL when one is configured, otherwise the bundled screen. */}
      <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>Legal</Text>
      <Card>
        <Pressable onPress={() => openLegal('privacy')} style={styles.row} hitSlop={6}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
          <Text style={[type.body, styles.grow, { color: colors.ink }]}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Pressable onPress={() => openLegal('terms')} style={styles.row} hitSlop={6}>
          <Ionicons name="document-text-outline" size={22} color={colors.accent} />
          <Text style={[type.body, styles.grow, { color: colors.ink }]}>Terms of Service</Text>
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable style={styles.modalBackdropFill} onPress={() => setRenaming(false)} />
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[type.h2, { color: colors.ink }]}>Rename household</Text>
            <Text style={[type.sub, { color: colors.muted }]}>
              Everyone in the household sees the new name.
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Household name"
              placeholderTextColor={colors.muted}
              style={[styles.modalInput, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line }]}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={submitRename}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenaming(false)} style={styles.modalBtn}>
                <Text style={[type.body, { color: colors.muted }]}>Cancel</Text>
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
                  {savingName ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  const initials = member.display_name.slice(0, 2).toUpperCase();
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
        {member.display_name}
        {isMe ? ' (you)' : ''}
      </Text>
      {member.role === 'owner' && <Text style={[type.sub, { color: colors.muted }]}>Owner</Text>}
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
