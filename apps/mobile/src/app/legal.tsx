import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { PRIVACY_MD, TERMS_MD } from '@/lib/legal';
import { spacing, type, useTheme } from '@/theme';

/** Render a line's inline **bold** spans. */
function Inline({ text, color }: { text: string; color: string }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((p, i) => (
        <Text key={i} style={i % 2 === 1 ? { fontWeight: '700', color } : { color }}>
          {p}
        </Text>
      ))}
    </>
  );
}

/**
 * In-app Privacy Policy / Terms viewer. Renders the bundled markdown with a
 * tiny renderer (headings, paragraphs, bullets, bold) so the documents are
 * always reachable without a network — a store-review requirement.
 */
export default function LegalScreen() {
  const { colors } = useTheme();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const md = doc === 'terms' ? TERMS_MD : PRIVACY_MD;
  const lines = md.split('\n');

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {lines.map((line, i) => {
            if (line.startsWith('# ')) {
              return (
                <Text key={i} style={[type.h1, styles.h1, { color: colors.ink }]}>
                  {line.slice(2)}
                </Text>
              );
            }
            if (line.startsWith('## ')) {
              return (
                <Text key={i} style={[type.h2, styles.h2, { color: colors.ink }]}>
                  {line.slice(3)}
                </Text>
              );
            }
            if (line.startsWith('- ')) {
              return (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[type.bodyRegular, { color: colors.muted }]}>•</Text>
                  <Text style={[type.bodyRegular, styles.bulletText, { color: colors.muted, lineHeight: 22 }]}>
                    <Inline text={line.slice(2)} color={colors.muted} />
                  </Text>
                </View>
              );
            }
            if (line.trim() === '') return <View key={i} style={styles.gap} />;
            return (
              <Text key={i} style={[type.bodyRegular, styles.para, { color: colors.muted, lineHeight: 22 }]}>
                <Inline text={line} color={colors.muted} />
              </Text>
            );
          })}
          <View style={styles.footer} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  h1: { marginBottom: spacing.sm },
  h2: { marginTop: spacing.lg, marginBottom: spacing.xs },
  para: { marginBottom: spacing.xs },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs, paddingRight: spacing.md },
  bulletText: { flex: 1 },
  gap: { height: spacing.sm },
  footer: { height: spacing.xxl },
});
