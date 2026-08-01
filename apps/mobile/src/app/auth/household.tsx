import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { useToast } from '@/components/toast';
import { useProfileName } from '@/lib/profile-name';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Create a new household or join an existing one with an invite code.
 *
 * Your own name is *not* asked here. It's captured once at sign-up and reused,
 * because it's the same answer every time — creating five households used to
 * mean typing it five times. The field only reappears for an account that
 * predates that flow and has no name on record yet.
 */
export default function HouseholdSetupScreen() {
  const { colors } = useTheme();
  const { createHousehold, joinHousehold, myName } = useHousehold();
  const { name: savedName, ready: nameReady, remember } = useProfileName();
  const { showToast } = useToast();
  const t = useT();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On device first, then whatever the user's memberships already call them.
  const knownName = (savedName || myName || '').trim();
  // Only ask once storage has answered — otherwise the field flashes in and
  // out for the common case where we do know the name.
  const askName = nameReady && !knownName;

  const submit = async () => {
    const finalName = knownName || displayName.trim();
    if (!finalName) {
      setError(t('auth.addYourName'));
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === 'create'
        ? await createHousehold(householdName, finalName)
        : await joinHousehold(code, finalName);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // A name typed here is still worth remembering, so the next household
    // doesn't ask again either.
    if (!knownName) await remember(finalName);

    /**
     * Say that the switch happened.
     *
     * Creating or joining makes the new household active — which is right,
     * you almost always want to use the thing you just made — but this screen
     * closes straight onto the dashboard, so the lists you were looking at a
     * second ago are simply gone, replaced by an empty household you have not
     * been told you are now in. The switch was never the problem; doing it in
     * silence was, and it reads as the app losing your data rather than
     * showing you somewhere else.
     *
     * Fired BEFORE router.back(): the toast host lives at the root of the
     * tree, above every screen, so the message survives this modal closing
     * and lands over the dashboard it is describing.
     *
     * The name comes from what the user typed rather than from the created
     * row, because the provider has been asked to refresh but this component
     * is about to unmount and cannot wait to read the result back. For a join
     * there is nothing typed to use — you enter a code, not a name — so that
     * case gets the generic wording.
     */
    const created = mode === 'create' ? householdName.trim() : '';
    showToast(
      created ? t('household.nowShoppingIn', { name: created }) : t('household.nowShoppingJoined'),
    );
    router.back();
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.rootTransparent} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        </View>

        {/* Scrollable so the submit button stays reachable on small screens
            once the keyboard has taken its share of the height. */}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[type.h1, { color: colors.ink }]}>{t('auth.householdTitle')}</Text>
          <Text style={[type.bodyRegular, { color: colors.muted }]}>
            {t('auth.householdIntro')}
          </Text>

          {/* Mode toggle */}
          <View style={[styles.toggle, { borderColor: colors.line }]}>
            {(['create', 'join'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    setMode(m);
                    setError(null);
                  }}
                  style={[styles.toggleBtn, active && { backgroundColor: colors.accentSoft }]}
                >
                  <Text style={[type.body, { color: active ? colors.accent : colors.muted }]}>
                    {m === 'create' ? t('auth.create') : t('auth.join')}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {askName && (
            <FormField
              label={t('auth.yourName')}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('auth.yourNamePlaceholder')}
              autoCapitalize="words"
            />
          )}
          {knownName ? (
            <Text style={[type.sub, { color: colors.muted }]}>
              {t('auth.joiningAs', { name: knownName })}
            </Text>
          ) : null}

          {mode === 'create' ? (
            <FormField
              label={t('auth.householdName')}
              value={householdName}
              onChangeText={setHouseholdName}
              placeholder={t('auth.householdNamePlaceholder')}
              autoCapitalize="words"
            />
          ) : (
            <FormField
              label={t('auth.inviteCode')}
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder={t('auth.inviteCodePlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
          )}

          {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}

          <PrimaryButton
            label={mode === 'create' ? t('auth.createHousehold') : t('auth.joinHousehold')}
            onPress={submit}
            loading={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootTransparent: { flex: 1, backgroundColor: 'transparent' },
  fill: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.lg, marginTop: spacing.md },
  toggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 3,
    gap: 3,
  },
  toggleBtn: {
    flex: 1,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
