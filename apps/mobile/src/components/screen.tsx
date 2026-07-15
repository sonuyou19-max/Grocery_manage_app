import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, type, useTheme } from '@/theme';

interface ScreenProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

/** Standard page shell: safe area, themed background, h1 + subtitle header. */
export function Screen({ title, subtitle, children }: ScreenProps) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[type.h1, { color: colors.ink }]}>{title}</Text>
          {subtitle ? (
            <Text style={[type.sub, { color: colors.muted }]}>{subtitle}</Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
