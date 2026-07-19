import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { useAuth } from '@/store/auth';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Temporary email + password sign-in. (Passwordless email codes return once a
 * real sending domain is configured — see auth store.)
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const { signInPassword, signUpPassword } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } =
      mode === 'signup'
        ? await signUpPassword(email, password)
        : await signInPassword(email, password);
    setBusy(false);
    if (err) setError(err);
    else router.back(); // back to Settings, now signed in
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.rootTransparent} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={[type.h1, { color: colors.ink }]}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Text>
          <Text style={[type.bodyRegular, { color: colors.muted }]}>
            Sign in to sync your lists and share them with your household.
          </Text>

          {/* Mode toggle */}
          <View style={[styles.toggle, { borderColor: colors.line }]}>
            {(['signin', 'signup'] as const).map((m) => {
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
                    {m === 'signin' ? 'Sign in' : 'Create account'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
            returnKeyType="done"
          />

          {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}

          <PrimaryButton
            label={mode === 'signin' ? 'Sign in' : 'Create account'}
            onPress={submit}
            loading={busy}
          />
        </View>
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
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: radii.md, padding: 3, gap: 3 },
  toggleBtn: {
    flex: 1,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
