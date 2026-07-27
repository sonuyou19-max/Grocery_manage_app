import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { LocaleSetup } from '@/components/locale-setup';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { languageByCode, regionByCode } from '@/i18n';
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { normalizeKey } from '@/lib/pantry-intel';
import { useProfileName } from '@/lib/profile-name';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useLocale, useT } from '@/store/locale';
import { DEMO_KEYS, usePantryIntel } from '@/store/pantry-intel';
import { spacing, type, useTheme } from '@/theme';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { user, signOut, deleteAccount } = useAuth();
  const { households, household, membersOf, myName, setDisplayName } = useHousehold();
  const { seedDemo } = usePantryIntel();
  const { remember: rememberName } = useProfileName();
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

  // Your own name — one name, shown in every household, so this edits them all.
  const [renamingSelf, setRenamingSelf] = useState(false);

  const submitOwnName = async (next: string) => {
    setRenamingSelf(false);
    const { error } = await setDisplayName(next);
    if (error) {
      Alert.alert(t('settings.renameFailTitle'), error);
      return;
    }
    // Keep the on-device copy in step, or the next household you create would
    // be filed under the old name.
    await rememberName(next);
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
    // Warn about handover only if some household actually has other members.
    const others = households.some((h) => membersOf(h.id).length > 1);
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
          {/* One name, shown in every household — so it only appears once you're
              in one, which is where it's stored. */}
          {myName && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.line }]} />
              <Pressable onPress={() => setRenamingSelf(true)} style={styles.row} hitSlop={6}>
                <Ionicons name="pencil-outline" size={22} color={colors.accent} />
                <Text style={[type.body, styles.grow, { color: colors.ink }]}>
                  {t('settings.yourName')}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                  {myName}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>
            </>
          )}
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

      {/* Households — one row each, opening its own screen. Inlining every
          household's members + invite + leave made this screen unscannable. */}
      {user && (
        <>
          <Text style={[type.label, { color: colors.muted, marginTop: spacing.xs }]}>
            {t('settings.households')}
          </Text>
          <Card>
            {households.map((h, i) => (
              <View key={h.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: colors.line }]} />}
                <Pressable
                  onPress={() => router.push({ pathname: '/household/[id]', params: { id: h.id } })}
                  style={styles.row}
                >
                  <Ionicons name="home-outline" size={22} color={colors.accent} />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text style={[type.sub, { color: colors.muted }]}>
                      {t('settings.memberCount', { count: membersOf(h.id).length })}
                    </Text>
                  </View>
                  {h.id === household?.id && (
                    <Text style={[type.label, { color: colors.accent }]}>
                      {t('settings.active')}
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </Pressable>
              </View>
            ))}
            {households.length > 0 && (
              <View style={[styles.divider, { backgroundColor: colors.line }]} />
            )}
            <Pressable onPress={() => router.push('/auth/household')} style={styles.row}>
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.accent }]}>
                  {t('settings.addHousehold')}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('settings.setUpHouseholdHint')}
                </Text>
              </View>
            </Pressable>
          </Card>
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

      {/* Your own name. Household renaming moved to /household/[id]. */}
      <TextPromptModal
        visible={renamingSelf}
        title={t('settings.yourName')}
        placeholder={t('auth.yourNamePlaceholder')}
        confirmLabel={t('common.save')}
        onCancel={() => setRenamingSelf(false)}
        onSubmit={submitOwnName}
      />

      {/* Change region + language — reuses the first-launch chooser full-screen. */}
      <Modal
        visible={localeOpen}
        animationType="slide"
        onRequestClose={() => setLocaleOpen(false)}
      >
        <LocaleSetup
          initialRegion={region}
          initialLanguage={language}
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


const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  divider: { height: 1, marginVertical: spacing.xs },
});
