import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { radii, spacing, type, useTheme } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

interface FabProps {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
}

/** Floating primary action, bottom-right above the tab bar. */
export function Fab({ label, icon = 'add', onPress }: FabProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, { backgroundColor: colors.accent }]}
      android_ripple={{ color: colors.accentInk }}
    >
      <Ionicons name={icon} size={20} color={colors.accentInk} />
      <Text style={[type.body, { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    shadowColor: '#0A2A14',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
