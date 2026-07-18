import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { useAuth } from '@/store/auth';
import { useHousehold, type Member } from '@/store/household';
import { radii, spacing, type, useTheme } from '@/theme';

const AVATAR_COLORS = ['#4C8A5C', '#B97F14', '#8A5A44', '#3B6EA5', '#8455A0'];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();
  const { household, members } = useHousehold();

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'Your local lists stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const shareInvite = () => {
    if (!household) return;
    void Share.share({
      message: `Join our "${household.name}" grocery list on Korb. Invite code: ${household.invite_code}`,
    });
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
              </View>

              <View style={[styles.divider, { backgroundColor: colors.line }]} />

              {members.map((m, i) => (
                <MemberRow key={m.user_id} member={m} index={i} isMe={m.user_id === user.id} />
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
    </Screen>
  );
}

function MemberRow({ member, index, isMe }: { member: Member; index: number; isMe: boolean }) {
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
      {member.role === 'owner' && (
        <Text style={[type.sub, { color: colors.muted }]}>Owner</Text>
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
});
