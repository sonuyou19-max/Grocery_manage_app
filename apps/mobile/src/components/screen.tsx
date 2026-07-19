import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { spacing, type, useTheme } from '@/theme';

interface ScreenProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

/** Standard page shell: mesh background, safe area, big display title. */
export function Screen({ title, subtitle, children }: ScreenProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={[type.display, { color: colors.ink }]}>{title}</Text>
            {subtitle ? (
              <Text style={[type.sub, { color: colors.muted }]}>{subtitle}</Text>
            ) : null}
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2, // clearance for the floating action button
    gap: spacing.md,
    flexGrow: 1,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
