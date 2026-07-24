import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/** Create a new household or join an existing one with an invite code. */
export default function HouseholdSetupScreen() {
  const { colors } = useTheme();
  const { createHousehold, joinHousehold } = useHousehold();
  const t = useT();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!displayName.trim()) {
      setError(t('auth.addYourName'));
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === 'create'
        ? await createHousehold(householdName, displayName)
        : await joinHousehold(code, displayName);
    setBusy(false);
    if (result.error) setError(result.error);
    else router.back();
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

          <FormField
            label={t('auth.yourName')}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('auth.yourNamePlaceholder')}
            autoCapitalize="words"
          />

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
