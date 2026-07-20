import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FAB_HEIGHT } from '@/components/fab';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/components/floating-tab-bar';
import { MeshBackground } from '@/components/mesh-background';
import { spacing, type, useTheme } from '@/theme';

interface ScreenProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  /** Set on screens that render a <Fab>, so scroll content clears its full
   * height (not just its offset above the tab bar) on short screens. */
  hasFab?: boolean;
}

/** Standard page shell: mesh background, safe area, big display title. */
export function Screen({ title, subtitle, hasFab, children }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Clear the floating tab bar (and the Fab, when present) so the last card
  // is never hidden behind either.
  const fabClearance = hasFab ? FAB_HEIGHT + spacing.md : 0;
  const bottomClearance = insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + spacing.lg + fabClearance;

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomClearance }]}
          showsVerticalScrollIndicator={false}
        >
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
    gap: spacing.md,
    flexGrow: 1,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
