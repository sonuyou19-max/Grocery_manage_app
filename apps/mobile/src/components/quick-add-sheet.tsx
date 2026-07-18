import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ParsedItem } from '@korb/shared';

import { CATEGORY_LABELS } from '@/lib/categorize';
import { parseQuickAdd } from '@/lib/quick-add';
import { useGroceries } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

interface QuickAddSheetProps {
  visible: boolean;
  listId: string;
  onClose: () => void;
}

/**
 * AI quick-add: type or dictate a plain sentence ("we're out of milk, need 2kg
 * potatoes and coffee"), the model turns it into structured items, and you
 * confirm which to add. Voice works via the keyboard's own dictation mic.
 */
export function QuickAddSheet({ visible, listId, onClose }: QuickAddSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { addParsedItem } = useGroceries();

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | 'loading' | 'review'>('input');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText('');
      setPhase('input');
      setItems([]);
      setSelected([]);
      setError(null);
    }
  }, [visible]);

  const runParse = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase('loading');
    setError(null);
    const { items: parsed, error: err } = await parseQuickAdd(trimmed);
    if (err || !parsed) {
      setError(err ?? 'Something went wrong.');
      setPhase('input');
      return;
    }
    setItems(parsed);
    setSelected(parsed.map(() => true));
    setPhase('review');
  };

  const confirmAdd = () => {
    items.forEach((item, i) => {
      if (selected[i]) addParsedItem(listId, item);
    });
    onClose();
  };

  const selectedCount = selected.filter(Boolean).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.grab, { backgroundColor: colors.line }]} />

          <View style={styles.header}>
            <Ionicons name="sparkles" size={20} color={colors.accent} />
            <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>Quick add with AI</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>

          {phase === 'review' ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={[type.sub, { color: colors.muted }]}>
                Tap to include or skip, then add them.
              </Text>
              {items.map((item, i) => {
                const on = selected[i];
                return (
                  <Pressable
                    key={`${item.name}-${i}`}
                    onPress={() =>
                      setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
                    }
                    style={[styles.itemRow, { borderColor: on ? colors.accent : colors.line }]}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={on ? colors.accent : colors.muted}
                    />
                    <View style={styles.grow}>
                      <Text style={[type.body, { color: colors.ink }]}>{item.name}</Text>
                      <Text style={[type.sub, { color: colors.muted }]}>
                        {CATEGORY_LABELS[item.category]}
                        {item.quantity != null
                          ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
                          : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.body}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="e.g. we’re out of milk, need 2kg potatoes and coffee for the weekend"
                placeholderTextColor={colors.muted}
                style={[styles.input, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line }]}
                multiline
                autoFocus
                editable={phase !== 'loading'}
              />
              <View style={styles.hint}>
                <Ionicons name="mic-outline" size={15} color={colors.muted} />
                <Text style={[type.sub, { color: colors.muted, flex: 1 }]}>
                  Tip: tap the microphone on your keyboard to speak instead of typing.
                </Text>
              </View>
              {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}
            </View>
          )}

          <View style={[styles.footer, { borderTopColor: colors.line, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {phase === 'review' ? (
              <View style={styles.footerRow}>
                <Pressable onPress={() => setPhase('input')} style={styles.back}>
                  <Text style={[type.body, { color: colors.muted }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={confirmAdd}
                  disabled={selectedCount === 0}
                  style={[
                    styles.primary,
                    { backgroundColor: selectedCount ? colors.accent : colors.line },
                  ]}
                >
                  <Text style={[type.body, { color: selectedCount ? colors.accentInk : colors.muted }]}>
                    Add {selectedCount} item{selectedCount === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={runParse}
                disabled={phase === 'loading' || !text.trim()}
                style={[
                  styles.primary,
                  { backgroundColor: text.trim() && phase !== 'loading' ? colors.accent : colors.line },
                ]}
              >
                {phase === 'loading' ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text
                    style={[type.body, { color: text.trim() ? colors.accentInk : colors.muted }]}
                  >
                    Add with AI
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,18,10,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  grab: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  footer: { borderTopWidth: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  primary: { flex: 1, height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
