import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { useT } from '@/store/locale';
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
  confirmLabel,
  onCancel,
  onSubmit,
}: TextPromptModalProps) {
  const { colors } = useTheme();
  const t = useT();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue('');
  }, [visible]);

  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Modals live in their own window, which Android does not resize for the
          keyboard, and RN's built-in KeyboardAvoidingView is unreliable inside
          that window (its keyboard events don't consistently fire there). The
          keyboard-controller library reads native keyboard insets directly, so
          it tracks correctly even inside a Modal. */}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
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
              <Text style={[type.body, { color: colors.muted }]}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.btn, styles.confirm, { backgroundColor: colors.accent }]}>
              <Text style={[type.body, { color: colors.accentInk }]}>
                {confirmLabel ?? t('common.add')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
