import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The shared "sign in to see this" treatment: sample content under a blur, with
 * one invitation on top and the whole area as a single tap target.
 *
 * Extracted because Pantry and Insights need the identical thing and the parts
 * that are easy to get subtly wrong — the Android blur method, the wash that
 * makes shapes stop reading as data, pointerEvents on every layer, the
 * sample-data disclaimer — are exactly the parts that would drift if written
 * twice.
 *
 * ---------------------------------------------------------------------------
 * The content behind the blur is ALWAYS invented
 * ---------------------------------------------------------------------------
 *
 * Never the user's own. A brand-new guest has none, so there would be nothing
 * back there but empty states — the least enticing possible teaser. And a guest
 * who does have data would be looking at their own numbers deliberately
 * smeared, which is not a teaser but the app withholding something that already
 * belongs to them. Callers pass a fixed, plausible sample and it carries a
 * visible disclaimer, because a blurred figure that happens to be legible would
 * otherwise read as a claim about them.
 */
export function Teaser({
  title,
  body,
  children,
}: PropsWithChildren<{ title: string; body: string }>) {
  const { colors, scheme } = useTheme();
  const t = useT();

  const open = () => {
    haptics.tick();
    router.push('/auth/sign-in');
  };

  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={title}>
      <View>
        {/* pointerEvents none throughout, so every touch anywhere in the stack
            reaches the Pressable above rather than a sample row. */}
        <View pointerEvents="none">{children}</View>

        {/* `dimezisBlurView` is the Android implementation — the default one is
            a no-op there, which would leave the invented figures perfectly
            readable and turn them into an apparent claim about the user's own
            spending. This is the single most important prop on this screen. */}
        <BlurView
          intensity={scheme === 'dark' ? 28 : 34}
          tint={colors.blurTint}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Blur alone still leaves shapes legible enough to read as data; the
            wash pushes it to "clearly something, clearly not for you yet". */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]}
        />

        <View style={styles.ctaWrap} pointerEvents="none">
          <View style={[styles.cta, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.lockRing, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="lock-closed-outline" size={22} color={colors.accent} />
            </View>
            <Text style={[type.h2, styles.centred, { color: colors.ink }]}>{title}</Text>
            <Text style={[type.sub, styles.centred, { color: colors.muted }]}>{body}</Text>
            <View style={[styles.button, { backgroundColor: colors.accent }]}>
              <Text style={[type.body, { color: colors.accentInk }]}>{t('teaser.cta')}</Text>
            </View>
            {/* Never let invented numbers pass as theirs. */}
            <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
              {t('teaser.sampleNote')}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Centred over the sample rather than pinned, so it sits in the optical
  // middle whatever the sample cards happen to measure at.
  ctaWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cta: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 340,
  },
  centred: { textAlign: 'center' },
  lockRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    marginTop: spacing.xs,
  },
});
