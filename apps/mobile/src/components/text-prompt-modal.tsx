import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { radii, spacing, type, useTheme } from '@/theme';

interface TextPromptModalProps {
  visible: boolean;
  title: string;
  placeholder: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). */
export function TextPromptModal({
  visible,
  title,
  placeholder,
  confirmLabel = 'Add',
  onCancel,
  onSubmit,
}: TextPromptModalProps) {
  const { colors } = useTheme();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue('');
  }, [visible]);

  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[type.h2, { color: colors.ink }]}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            autoFocus
            style={[styles.input, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line }]}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.btn}>
              <Text style={[type.body, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.btn, styles.confirm, { backgroundColor: colors.accent }]}>
              <Text style={[type.body, { color: colors.accentInk }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { borderRadius: radii.lg, padding: spacing.xl, gap: spacing.lg },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.md },
  confirm: { alignItems: 'center' },
});
