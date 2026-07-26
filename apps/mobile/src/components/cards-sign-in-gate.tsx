import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { PrimaryButton } from '@/components/form';
import { useT } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * Shown in place of the wallet when nobody is signed in.
 *
 * Cards are the one feature that *requires* an account, unlike lists, which
 * work fully logged-out. The reason is ownership: with no user there is only a
 * single "this device" bucket, and on a shared phone that is precisely the leak
 * the per-user rule exists to prevent — the next person to pick it up would
 * find someone else's cards. So the prompt explains the privacy reason rather
 * than just demanding a sign-in.
 */
export function CardsSignInGate() {
  const { colors } = useTheme();
  const t = useT();

  return (
    <Card>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="lock-closed-outline" size={26} color={colors.accent} />
        </View>
        <View style={styles.grow}>
          <Text style={[type.body, { color: colors.ink }]}>{t('cards.signInTitle')}</Text>
          <Text style={[type.sub, { color: colors.muted }]}>{t('cards.signInBody')}</Text>
        </View>
      </View>
      <View style={styles.cta}>
        <PrimaryButton
          label={t('cards.signInCta')}
          onPress={() => router.push('/auth/sign-in')}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  badge: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cta: { paddingTop: spacing.sm },
});
