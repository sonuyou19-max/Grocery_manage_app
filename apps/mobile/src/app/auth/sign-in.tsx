import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { useAuth } from '@/store/auth';
import { useT } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * Passwordless sign-in: enter an email, receive a 6-digit code, verify it.
 * The same flow creates an account on first use, so there's no separate
 * sign-up — and no password to manage. Requires a working email sender
 * configured in Supabase (Auth → SMTP).
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const { sendCode, verifyCode } = useAuth();
  const t = useT();

  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async () => {
    if (!email.includes('@')) {
      setError(t('auth.invalidEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await sendCode(email);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setNotice(t('auth.codeSent', { email: email.trim() }));
    setCode('');
    setPhase('code');
  };

  const verify = async () => {
    if (code.trim().length < 6) {
      setError(t('auth.enterCode'));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await verifyCode(email, code);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.back(); // back to Settings, now signed in
  };

  const backToEmail = () => {
    setPhase('email');
    setError(null);
    setNotice(null);
    setCode('');
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.rootTransparent} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.fill}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => (phase === 'code' ? backToEmail() : router.back())}
              hitSlop={12}
            >
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
          </View>

          {/* Scrollable so the button stays reachable on small screens with
              the keyboard up. */}
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={[type.h1, { color: colors.ink }]}>
              {phase === 'email' ? t('auth.signInTitle') : t('auth.codeTitle')}
            </Text>
            <Text style={[type.bodyRegular, { color: colors.muted }]}>
              {phase === 'email' ? t('auth.emailSubtitle') : notice}
            </Text>

            {phase === 'email' ? (
              <FormField
                label={t('auth.emailLabel')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.emailPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                onSubmitEditing={requestCode}
                returnKeyType="send"
              />
            ) : (
              <FormField
                label={t('auth.codeLabel')}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 10))}
                placeholder={t('auth.codePlaceholder')}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={10}
                onSubmitEditing={verify}
                returnKeyType="done"
              />
            )}

            {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}

            {phase === 'email' ? (
              <PrimaryButton label={t('auth.sendCode')} onPress={requestCode} loading={busy} />
            ) : (
              <>
                <PrimaryButton label={t('auth.verify')} onPress={verify} loading={busy} />
                <View style={styles.actions}>
                  <Pressable onPress={requestCode} disabled={busy} hitSlop={8}>
                    <Text style={[type.body, { color: colors.accent }]}>{t('auth.resend')}</Text>
                  </Pressable>
                  <Pressable onPress={backToEmail} hitSlop={8}>
                    <Text style={[type.body, { color: colors.muted }]}>
                      {t('auth.differentEmail')}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
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
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
