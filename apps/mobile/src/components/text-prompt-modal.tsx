import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Sheet, useSheetDismiss } from "@/components/sheet";
import { useT } from "@/store/locale";
import { radii, spacing, type, useTheme } from "@/theme";

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
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) setValue("");
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      align="center"
      scrim
      gutter={spacing.xl}
      avoidKeyboard
    >
      <Body
        value={value}
        setValue={setValue}
        title={title}
        placeholder={placeholder}
        confirmLabel={confirmLabel}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </Sheet>
  );
}

/**
 * Inside the <Sheet>, so it can call useSheetDismiss().
 *
 * `onSubmit` almost always navigates — creating a list and opening it is the
 * main use — and navigating out of a Modal before its window is gone is the
 * blank-screen bug in lib/modal-nav.ts. Deferring here rather than at each call
 * site means every caller gets it, including ones written later that would
 * otherwise have to know.
 */
function Body({
  value,
  setValue,
  title,
  placeholder,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  value: string;
  setValue: (v: string) => void;
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const { colors } = useTheme();
  const t = useT();
  const dismiss = useSheetDismiss();

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) dismiss(() => onSubmit(trimmed));
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text style={[type.h2, { color: colors.ink }]}>{title}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoFocus
        style={[
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.bg,
            borderColor: colors.line,
          },
        ]}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={styles.actions}>
        <Pressable onPress={() => dismiss(onCancel)} style={styles.btn}>
          <Text style={[type.body, { color: colors.muted }]}>
            {t("common.cancel")}
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          style={[
            styles.btn,
            styles.confirm,
            { backgroundColor: colors.accent },
          ]}
        >
          <Text style={[type.body, { color: colors.accentInk }]}>
            {confirmLabel ?? t("common.add")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, padding: spacing.xl, gap: spacing.lg },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  btn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  confirm: { alignItems: "center" },
});
