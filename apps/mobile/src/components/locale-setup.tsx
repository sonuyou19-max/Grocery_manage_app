import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { i18n, LANGUAGES, REGIONS, regionByCode } from '@/i18n';
import { radii, spacing, type, useTheme } from '@/theme';

interface LocaleSetupProps {
  /** Called with the confirmed region + language codes. */
  onDone: (region: string, language: string) => void;
  /** When true, shows a back/close affordance (used from Settings). */
  onCancel?: () => void;
}

/**
 * First-launch (and Settings) locale chooser: pick a region, then a language.
 * Region chrome is English (nothing's chosen yet); the language step previews
 * itself in the selected language. Rendered outside the LocaleProvider context,
 * so it reads strings straight from i18n with an explicit locale.
 */
export function LocaleSetup({ onDone, onCancel }: LocaleSetupProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<'region' | 'language'>('region');
  const [region, setRegion] = useState<string | null>(null);
  const [language, setLanguage] = useState('en');

  // Language step previews in the chosen language; region step is English.
  const t = (key: string, locale: string) => i18n.t(key, { locale });

  const pickRegion = (code: string) => {
    setRegion(code);
    setLanguage(regionByCode(code)?.suggestedLanguage ?? 'en');
    setStep('language');
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.header}>
          {step === 'language' ? (
            <Pressable onPress={() => setStep('region')} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
          ) : onCancel ? (
            <Pressable onPress={onCancel} hitSlop={12}>
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          ) : (
            <View style={styles.spacer} />
          )}
        </View>

        {step === 'region' ? (
          <>
            <View style={styles.titleBlock}>
              <Text style={[type.h1, { color: colors.ink }]}>{t('setup.regionTitle', 'en')}</Text>
              <Text style={[type.bodyRegular, { color: colors.muted }]}>
                {t('setup.regionSubtitle', 'en')}
              </Text>
            </View>
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {REGIONS.map((r) => (
                <Pressable
                  key={r.code}
                  onPress={() => pickRegion(r.code)}
                  style={[styles.row, { borderColor: colors.line, backgroundColor: colors.surface }]}
                >
                  <Text style={[type.body, styles.grow, { color: colors.ink }]}>{r.name}</Text>
                  <Text style={[type.sub, { color: colors.muted }]}>{r.currency}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : (
          <>
            <View style={styles.titleBlock}>
              <Text style={[type.h1, { color: colors.ink }]}>{t('setup.languageTitle', language)}</Text>
              <Text style={[type.bodyRegular, { color: colors.muted }]}>
                {t('setup.languageSubtitle', language)}
              </Text>
            </View>
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {LANGUAGES.map((l) => {
                const active = l.code === language;
                return (
                  <Pressable
                    key={l.code}
                    onPress={() => setLanguage(l.code)}
                    style={[
                      styles.row,
                      { borderColor: active ? colors.accent : colors.line, backgroundColor: colors.surface },
                      active && { borderWidth: 2 },
                    ]}
                  >
                    <Text style={[type.body, styles.grow, { color: colors.ink }]}>{l.endonym}</Text>
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={active ? colors.accent : colors.muted}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.footer}>
              <Pressable
                onPress={() => region && onDone(region, language)}
                style={[styles.cta, { backgroundColor: colors.accent }]}
              >
                <Text style={[type.body, { color: colors.accentInk }]}>{t('common.continue', language)}</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 34 },
  spacer: { height: 26 },
  titleBlock: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  grow: { flex: 1, minWidth: 0 },
  footer: { padding: spacing.lg },
  cta: { height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
