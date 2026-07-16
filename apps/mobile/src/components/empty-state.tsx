import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, type, useTheme } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Centered placeholder for screens that are intentionally light on content. */
export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: IoniconName;
  title: string;
  body: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name={icon} size={30} color={colors.accent} />
      </View>
      <Text style={[type.h2, { color: colors.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.bodyRegular, { color: colors.muted, textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
