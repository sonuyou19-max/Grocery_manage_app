import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { radii, spacing, type, useTheme } from '@/theme';

export function FormField({
  label,
  ...inputProps
}: { label: string } & TextInputProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
        {...inputProps}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={[styles.button, { backgroundColor: off ? colors.line : colors.accent }]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentInk} />
      ) : (
        <Text style={[type.body, { color: off ? colors.muted : colors.accentInk }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.ghost}>
      <Text style={[type.body, { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  button: {
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center' },
});
