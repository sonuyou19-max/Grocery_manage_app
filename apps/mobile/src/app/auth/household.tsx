import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { FormField, PrimaryButton } from '@/components/form';
import { MeshBackground } from '@/components/mesh-background';
import { Safe } from '@/components/safe';
import { useToast } from '@/components/toast';
import { useProfileName } from '@/lib/profile-name';
import { useHousehold } from '@/store/household';
import { useT } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

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
  const scrollIndicator = useScrollIndicator();
  const { createHousehold, requestJoin, myName } = useHousehold();
  const { name: savedName, ready: nameReady, remember } = useProfileName();
  const { showToast } = useToast();
  const t = useT();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The household a request has just been sent to, or null.
   *
   * A screen state rather than a toast-and-close, because the outcome of a
   * request is not immediate and the reader has to be told to expect that. A
   * toast over the dashboard would be gone in three seconds and would leave
   * somebody staring at a household they did not join, wondering whether it
   * worked.
   */
  const [sent, setSent] = useState<string | null>(null);

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
        : await requestJoin(code, finalName);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // A name typed here is still worth remembering, so the next household
    // doesn't ask again either.
    if (!knownName) await remember(finalName);

    /*
     * A REQUEST IS NOT A JOIN, and this screen must not pretend otherwise.
     *
     * Entering a code used to walk you straight in. It now asks, and until the
     * owner answers there is nothing to go to: RLS gives a pending requester no
     * household row, no lists and no members, so closing onto the dashboard
     * would show an empty app and read as everything having been lost.
     *
     * So the screen stays put and says what happened. The one exception is a
     * code for a household you are ALREADY in — nothing was asked of anybody
     * and the only sensible reading is "take me there".
     */
    if ('status' in result && result.status === 'pending') {
      setSent(result.household?.name ?? '');
      return;
    }
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
     * The name comes from THE ROW THE SERVER RETURNED, not from what was
     * typed. It used to come from the field, which made the message a claim
     * about a write rather than a report of one — and while the switch was
     * quietly being undone underneath it (see adoptHousehold), that claim was
     * simply false: the toast named a household the app was not in.
     *
     * It also fixes a join. There is nothing typed there — you enter a code,
     * not a name — so the only wording available was "you're now in your new
     * household", which is the app telling somebody where they are without
     * saying where that is. The RPC knew the name the whole time.
     *
     * The generic line survives for the case where the row came back without
     * one, which should not happen and is not worth an empty quotation mark on
     * screen if it does.
     */
    const name = result.household?.name?.trim();
    showToast(
      name ? t('household.nowShoppingIn', { name }) : t('household.nowShoppingJoined'),
    );
    router.back();
  };

  /*
   * SENT, AND NOW YOU WAIT.
   *
   * A whole screen rather than a line under the form, because the form has
   * stopped being the point: there is nothing more to type and the next thing
   * that happens is somebody else's decision. Leaving the fields on screen
   * would invite a second attempt at a code that worked perfectly well.
   *
   * It says who has to act and roughly when — "when they approve it" rather
   * than a promise about how quickly — and it does not offer a cancel. Nothing
   * has been created that the person is stuck with: they close this and the
   * request sits there, and the place to withdraw it is beside the request
   * itself, on the screen that shows their pending asks.
   */
  if (sent != null) {
    return (
      <View style={styles.root}>
        <MeshBackground />
        <Safe style={styles.rootTransparent} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.body}>
            <View style={[styles.sentBadge, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="paper-plane-outline" size={30} color={colors.accent} />
            </View>
            <Text style={[type.h1, { color: colors.ink }]}>{t('join.sentTitle')}</Text>
            <Text style={[type.bodyRegular, { color: colors.muted }]}>
              {sent ? t('join.sentBody', { name: sent }) : t('join.sentBodyGeneric')}
            </Text>
            <PrimaryButton label={t('common.done')} onPress={() => router.back()} />
          </View>
        </Safe>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Safe style={styles.rootTransparent} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        </View>

        {/* Scrollable so the submit button stays reachable on small screens
            once the keyboard has taken its share of the height. */}
        <ScrollView {...scrollIndicator} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
            label={mode === 'create' ? t('auth.createHousehold') : t('join.ask')}
            onPress={submit}
            loading={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      </Safe>
    </View>
  );
}

const styles = StyleSheet.create({
  sentBadge: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
