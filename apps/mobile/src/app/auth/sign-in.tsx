import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField, GhostButton, PrimaryButton } from '@/components/form';
import { useAuth } from '@/store/auth';
import { spacing, type, useTheme } from '@/theme';

/** Passwordless sign-in: email → 6-digit code → session. */
export default function SignInScreen() {
  const { colors } = useTheme();
  const { sendCode, verifyCode } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSend = async () => {
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await sendCode(email);
    setBusy(false);
    if (err) setError(err);
    else setStep('code');
  };

  const onVerify = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await verifyCode(email, code);
    setBusy(false);
    if (err) setError(err);
    else router.back(); // back to Settings, now signed in
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
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
            {step === 'email' ? 'Sign in' : 'Enter your code'}
          </Text>
          <Text style={[type.bodyRegular, { color: colors.muted }]}>
            {step === 'email'
              ? 'We’ll email you a 6-digit code — no password to remember.'
              : `We sent a code to ${email}. Enter it below.`}
          </Text>

          {step === 'email' ? (
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoFocus
              onSubmitEditing={onSend}
              returnKeyType="send"
            />
          ) : (
            <FormField
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              onSubmitEditing={onVerify}
              returnKeyType="done"
            />
          )}

          {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}

          {step === 'email' ? (
            <PrimaryButton label="Send code" onPress={onSend} loading={busy} />
          ) : (
            <>
              <PrimaryButton label="Verify & sign in" onPress={onVerify} loading={busy} />
              <GhostButton
                label="Use a different email"
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.lg, marginTop: spacing.md },
});
