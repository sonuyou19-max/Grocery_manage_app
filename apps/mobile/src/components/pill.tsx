import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, useTheme } from '@/theme';

type PillTone = 'accent' | 'warn' | 'crit';

/** Status chip. Status is always a color AND a word, never color alone. */
export function Pill({ label, tone = 'accent' }: { label: string; tone?: PillTone }) {
  const { colors } = useTheme();
  const toneColors = {
    accent: { bg: colors.accentSoft, fg: colors.accent },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    crit: { bg: colors.critSoft, fg: colors.crit },
  }[tone];

  return (
    <View style={[styles.pill, { backgroundColor: toneColors.bg }]}>
      <Text style={[styles.text, { color: toneColors.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { fontSize: 12, fontWeight: '700' },
});
