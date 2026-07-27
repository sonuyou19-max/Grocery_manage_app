import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { flagFor, i18n, LANGUAGES, REGIONS, regionByCode } from '@/i18n';
import { radii, spacing, type, useTheme } from '@/theme';

interface LocaleSetupProps {
  /** Called with the confirmed region + language codes. */
  onDone: (region: string, language: string) => void;
  /** When true, shows a back/close affordance (used from Settings). */
  onCancel?: () => void;
  /**
   * What's already set, when reopened from Settings. Without these the screen
   * would come up blank and in English for someone who chose Poland/Polish
   * months ago — a change screen has to start from the current answer.
   */
  initialRegion?: string | null;
  initialLanguage?: string;
}

/**
 * Where do you shop, and in which language — on one screen.
 *
 * This was two full-page steps, which made a thirty-second decision feel like a
 * form. The two choices are related (a country suggests a language) and both are
 * short, so they belong together: pick a country and the language list appears
 * beneath it, already set to the sensible default, needing a tap only to
 * override.
 *
 * Countries lead with their flag. It's the fastest thing to scan in a list of
 * twenty — you find 🇧🇪 before you read "Belgium" — and it works identically in
 * every UI language, which matters on the one screen shown before a language
 * exists.
 *
 * Rendered outside the LocaleProvider (nothing is chosen yet), so it reads
 * strings straight from i18n with an explicit locale.
 */
export function LocaleSetup({
  onDone,
  onCancel,
  initialRegion = null,
  initialLanguage = 'en',
}: LocaleSetupProps) {
  const { colors } = useTheme();
  const [region, setRegion] = useState<string | null>(initialRegion);
  const [language, setLanguage] = useState(initialLanguage);

  // Chrome follows the current best guess: English until a country is picked,
  // then the language being previewed. Choosing a country changes the words on
  // screen, which is itself the confirmation that the choice registered.
  const t = (key: string) => i18n.t(key, { locale: region ? language : 'en' });

  const pickRegion = (code: string) => {
    setRegion(code);
    setLanguage(regionByCode(code)?.suggestedLanguage ?? 'en');
  };

  const chosenRegion = region ? regionByCode(region) : null;

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.header}>
          {onCancel ? (
            <Pressable onPress={onCancel} hitSlop={12}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          ) : (
            <View style={styles.spacer} />
          )}
        </View>

        <View style={styles.titleBlock}>
          <Text style={[type.h1, { color: colors.ink }]}>{t('setup.regionTitle')}</Text>
          <Text style={[type.bodyRegular, { color: colors.muted }]}>{t('setup.regionSubtitle')}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[type.label, { color: colors.muted }]}>{t('setup.countryLabel')}</Text>
            <View style={styles.chips}>
              {REGIONS.map((r) => {
                const active = r.code === region;
                return (
                  <Pressable
                    key={r.code}
                    onPress={() => pickRegion(r.code)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? colors.accent : colors.line,
                        backgroundColor: active ? colors.accentSoft : colors.surface,
                      },
                    ]}
                  >
                    <Text style={styles.flag}>{flagFor(r.code)}</Text>
                    <Text
                      style={[type.sub, { color: active ? colors.accent : colors.ink }]}
                      numberOfLines={1}
                    >
                      {r.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Only once a country is chosen: before that a language list is noise,
              and afterwards it arrives pre-answered. */}
          {region && (
            <Animated.View entering={FadeIn.duration(220)} style={styles.section}>
              <Text style={[type.label, { color: colors.muted }]}>{t('setup.languageLabel')}</Text>
              <View style={styles.chips}>
                {LANGUAGES.map((l) => {
                  const active = l.code === language;
                  return (
                    <Pressable
                      key={l.code}
                      onPress={() => setLanguage(l.code)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? colors.accent : colors.line,
                          backgroundColor: active ? colors.accentSoft : colors.surface,
                        },
                      ]}
                    >
                      {/* The endonym, so you recognise your own language without
                          already reading the interface language. */}
                      <Text
                        style={[type.sub, { color: active ? colors.accent : colors.ink }]}
                        numberOfLines={1}
                      >
                        {l.endonym}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('setup.currencyNote').replace('%{currency}', chosenRegion?.currency ?? '')}
              </Text>
            </Animated.View>
          )}
        </ScrollView>

        {region && (
          <Animated.View entering={FadeIn.duration(220)} style={styles.footer}>
            <Pressable
              onPress={() => onDone(region, language)}
              style={[styles.cta, { backgroundColor: colors.accent }]}
            >
              <Text style={[type.body, { color: colors.accentInk }]}>{t('common.continue')}</Text>
            </Pressable>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}

/**
 * A held beat between choosing a language and the app appearing: the first
 * words Korb says, in the language just picked.
 *
 * It exists because the choice otherwise vanishes into a loading gap with no
 * acknowledgement. A greeting in the chosen language is the shortest possible
 * proof that the setting took effect — and it covers the moment the onboarding
 * tour is preparing, turning dead time into the app introducing itself.
 */
export function LocaleGreeting({ language, onDone }: { language: string; onDone: () => void }) {
  const { colors } = useTheme();

  useEffect(() => {
    const timer = setTimeout(onDone, 1400);
    return () => clearTimeout(timer);
  }, [onDone]);

  // The greeting the dashboard would use at this hour, so the first words match
  // the ones they'll see every morning after.
  const hello = useMemo(() => {
    const h = new Date().getHours();
    const key = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    return i18n.t(`greeting.${key}`, { locale: language });
  }, [language]);

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Animated.View
        entering={FadeIn.duration(400)}
        exiting={FadeOut.duration(200)}
        style={styles.greetWrap}
      >
        <Text style={[type.display, { color: colors.ink, textAlign: 'center' }]}>{hello}</Text>
        <Text style={[type.bodyRegular, { color: colors.muted, textAlign: 'center' }]}>
          {i18n.t('setup.greetingSub', { locale: language })}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 34 },
  spacer: { height: 26 },
  titleBlock: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  list: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: '100%',
  },
  // Emoji flags need a nudge up in size to read at chip scale.
  flag: { fontSize: 18 },
  footer: { padding: spacing.lg },
  cta: { height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  greetWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
});
