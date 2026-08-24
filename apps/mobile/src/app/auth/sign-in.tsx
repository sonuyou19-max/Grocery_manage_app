import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { Safe } from '@/components/safe';
import { readProfileName, useProfileName, writeProfileName } from '@/lib/profile-name';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { captureException } from '@/lib/monitoring';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Passwordless sign-in: enter an email, receive a 6-digit code, verify it,
 * and — the first time — say what you'd like to be called. The same flow
 * creates an account on first use, so there's no separate sign-up — and no
 * password to manage. Requires a working email sender configured in Supabase
 * (Auth → SMTP).
 *
 * The name step is here rather than on the household screen because it's a fact
 * about *you*: asked once at sign-up, it's reused for every household you go on
 * to create or join. Someone signing back in already has a name, so the step
 * skips itself entirely.
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const { sendCode, verifyCode } = useAuth();
  const { households, createHousehold, setDisplayName } = useHousehold();
  const { remember } = useProfileName();
  const t = useT();

  const [phase, setPhase] = useState<'email' | 'code' | 'name'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
    const { error: err, userId } = await verifyCode(email, code);
    if (err) {
      setBusy(false);
      setError(err);
      return;
    }
    // Do we already know this person? Two places to look, cheapest first: the
    // name they gave on this device, then the one their memberships carry (a
    // returning user on a new phone). Only ask when both come up empty.
    let known = userId ? await readProfileName(userId) : '';
    if (!known) {
      const { data } = await supabase
        .from('household_members')
        .select('display_name')
        .limit(1);
      known = (data?.[0]?.display_name ?? '').trim();
      if (known && userId) await writeProfileName(userId, known);
    }
    setBusy(false);
    if (known) {
      router.back(); // back to Settings, now signed in
      return;
    }
    setError(null);
    setPhase('name');
  };

  const submitName = async () => {
    const clean = name.trim();
    if (!clean) {
      setError(t('auth.addYourName'));
      return;
    }
    setBusy(true);
    setError(null);
    await remember(clean);
    // Push it to any memberships too. A brand-new account has none, in which
    // case this updates nothing and that's fine — the local copy is what the
    // household screen reads, and joining later carries the name along. A
    // failure here is not worth blocking sign-in over.
    await setDisplayName(clean);

    // Every account gets a household, immediately and without being asked.
    //
    // Nothing in the app is stored in the cloud except inside one, so signing
    // in without a household used to leave people in a state where the app
    // looked signed-in and quietly saved nothing. And "create a household" is
    // jargon to someone who just wants their shopping backed up — a solo
    // shopper should never have to name a thing they did not know they needed.
    // Sharing it with anyone comes later, from Settings, with an invite code.
    //
    // Only when they have none: a returning user signing in on a new phone
    // already has theirs, and a second empty one would be clutter.
    if (households.length === 0) {
      const { error: householdError } = await createHousehold(
        t('household.defaultName', { name: clean }),
        clean,
      );
      // Not fatal. They are signed in either way, and the household screen in
      // Settings can still create one by hand — blocking sign-in on a failed
      // follow-up write would be a worse outcome than a missing default.
      if (householdError) captureException(new Error(householdError), { at: 'signup.createHousehold' });
    }

    setBusy(false);
    router.back();
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
      <Safe style={styles.rootTransparent} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.fill}
        >
          <View style={styles.header}>
            {/* No way back from the name step: the session already exists, so
                "back" would land on a half-finished sign-up. It's one field. */}
            {phase !== 'name' && (
              <Pressable
                onPress={() => (phase === 'code' ? backToEmail() : router.back())}
                hitSlop={12}
              >
                <Ionicons name="chevron-back" size={26} color={colors.ink} />
              </Pressable>
            )}
          </View>

          {/* Scrollable so the button stays reachable on small screens with
              the keyboard up. */}
          <ScrollView {...scrollIndicator} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={[type.h1, { color: colors.ink }]}>
              {phase === 'email'
                ? t('auth.signInTitle')
                : phase === 'code'
                  ? t('auth.codeTitle')
                  : t('auth.nameTitle')}
            </Text>
            <Text style={[type.bodyRegular, { color: colors.muted }]}>
              {phase === 'email'
                ? t('auth.emailSubtitle')
                : phase === 'code'
                  ? notice
                  : t('auth.nameSubtitle')}
            </Text>

            {phase === 'email' && (
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
            )}
            {phase === 'code' && (
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
            {phase === 'name' && (
              <FormField
                label={t('auth.yourName')}
                value={name}
                onChangeText={setName}
                placeholder={t('auth.yourNamePlaceholder')}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="givenName"
                maxLength={40}
                onSubmitEditing={submitName}
                returnKeyType="done"
              />
            )}

            {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}

            {phase === 'email' && (
              <PrimaryButton label={t('auth.sendCode')} onPress={requestCode} loading={busy} />
            )}
            {phase === 'code' && (
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
            {phase === 'name' && (
              <PrimaryButton label={t('auth.nameContinue')} onPress={submitName} loading={busy} />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Safe>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootTransparent: { flex: 1, backgroundColor: 'transparent' },
  fill: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.lg, marginTop: spacing.md },
  // Both links are translated and sit at body size, so together they overrun a
  // phone width in several languages ("Code erneut senden" + "Andere
  // E-Mail-Adresse verwenden"). Wrapping lets them stack instead of clipping.
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
