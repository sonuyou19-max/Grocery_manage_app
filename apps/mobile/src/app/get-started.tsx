import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { haptics } from '@/lib/haptics';
import { markGetStartedSeen } from '@/lib/onboarding';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Shown once, straight after the tour: what an account is for, and an easy way
 * to say not now.
 *
 * The app works completely without one — lists, pantry, insights and loyalty
 * cards are all local — so this is an offer, not a gate. That shapes every
 * decision here:
 *
 *  - **"Maybe later" is a real button**, the same size as the other, not a grey
 *    link hidden in a corner. Someone who wants to try the app before handing
 *    over an email should not have to hunt for the way past.
 *  - **The reasons come before the ask.** Two concrete things an account
 *    unlocks, rather than "sign up to continue" with no argument.
 *  - **It never comes back.** The flag is set on the way out whichever button
 *    was pressed, so declining once is respected. Settings still has sign-in
 *    for whenever they change their mind.
 *
 * Name and household aren't asked here. The name is captured inside sign-in
 * (it's a fact about the person, asked once), and a household needs an account
 * first — so this screen's whole job is the account decision, and the flows it
 * hands off to ask for exactly what they need.
 */
export default function GetStartedScreen() {
  const { colors } = useTheme();
  const t = useT();

  /**
   * Both buttons spend the prompt; only the destination differs.
   *
   * Sign-in is reached with `replace`, not `back()` followed by `push()` —
   * issuing two navigations in one tick races, and the loser leaves you either
   * still here or on a dashboard that immediately jumps. Replacing swaps this
   * screen for sign-in, so sign-in's own `back()` on success lands on the
   * dashboard exactly as it does from Settings.
   */
  const dismiss = () => {
    void markGetStartedSeen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const goToSignIn = () => {
    void markGetStartedSeen();
    router.replace('/auth/sign-in');
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="people-outline" size={30} color={colors.accent} />
          </View>

          <View style={styles.titleBlock}>
            <Text style={[type.h1, { color: colors.ink }]}>{t('getStarted.title')}</Text>
            <Text style={[type.bodyRegular, { color: colors.muted }]}>
              {t('getStarted.subtitle')}
            </Text>
          </View>

          <View style={styles.reasons}>
            <Reason icon="sync-outline" text={t('getStarted.reasonSync')} />
            <Reason icon="cart-outline" text={t('getStarted.reasonShare')} />
          </View>

          <Text style={[type.sub, { color: colors.muted }]}>{t('getStarted.noAccountNote')}</Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => {
              haptics.tick();
              goToSignIn();
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Text style={[type.body, { color: colors.accentInk }]}>
              {t('getStarted.createAccount')}
            </Text>
          </Pressable>

          {/* Deliberately a full-width button, not a muted link. Declining is a
              first-class choice here. */}
          <Pressable
            onPress={() => {
              haptics.tick();
              dismiss();
            }}
            style={[styles.cta, styles.ctaGhost, { borderColor: colors.line }]}
            accessibilityRole="button"
          >
            <Text style={[type.body, { color: colors.ink }]}>{t('getStarted.later')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Reason({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.reason}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={[type.body, styles.grow, { color: colors.ink }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  badge: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { gap: spacing.sm },
  reasons: { gap: spacing.md, paddingTop: spacing.xs },
  reason: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  footer: { padding: spacing.lg, gap: spacing.sm },
  cta: { height: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  ctaGhost: { backgroundColor: 'transparent', borderWidth: 1 },
});
