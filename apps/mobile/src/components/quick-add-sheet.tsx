import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
  const { height: screenH } = useWindowDimensions();

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | 'loading' | 'review'>('input');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kbHeight, setKbHeight] = useState(0);

  const sheetY = useSharedValue(screenH);

  // Measure the keyboard ourselves and lift the sheet by its height —
  // KeyboardAvoidingView doesn't reliably push content up inside a Modal.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setText('');
      setPhase('input');
      setItems([]);
      setSelected([]);
      setError(null);
      cancelAnimation(sheetY);
      sheetY.value = withTiming(0, { duration: 260 });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = () => {
    cancelAnimation(sheetY);
    sheetY.value = withTiming(screenH, { duration: 220 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetY.value, [0, screenH * 0.7], [1, 0], Extrapolation.CLAMP),
  }));

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
    requestClose();
  };

  const selectedCount = selected.filter(Boolean).length;
  const hasText = text.trim().length > 0;
  const canParse = hasText && phase !== 'loading';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={requestClose}>
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fillPlain} onPress={requestClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, marginBottom: kbHeight > 0 ? kbHeight : insets.bottom },
            sheetStyle,
          ]}
        >
          <View style={[styles.grab, { backgroundColor: colors.line }]} />

          <View style={styles.header}>
            <Ionicons name="sparkles" size={20} color={colors.accent} />
            <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>Quick add with AI</Text>
            <Pressable onPress={requestClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>

          {phase === 'review' ? (
            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={[type.sub, { color: colors.muted }]}>Tap to include or skip, then add.</Text>
              {items.map((item, i) => {
                const on = selected[i];
                return (
                  <Pressable
                    key={`${item.name}-${i}`}
                    onPress={() => setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
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
                        {item.quantity != null ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
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
              {/* Button sits directly under the field so the keyboard never hides it. */}
              <Pressable
                onPress={runParse}
                disabled={!canParse}
                style={[styles.primaryBlock, { backgroundColor: hasText ? colors.accent : colors.line }]}
              >
                {phase === 'loading' ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text style={[type.body, { color: hasText ? colors.accentInk : colors.muted }]}>
                    Add with AI
                  </Text>
                )}
              </Pressable>
              {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}
              <View style={styles.hint}>
                <Ionicons name="mic-outline" size={15} color={colors.muted} />
                <Text style={[type.sub, { color: colors.muted, flex: 1 }]}>
                  Prefer to speak? Tap the microphone key on your keyboard.
                </Text>
              </View>
            </View>
          )}

          {phase === 'review' && (
            <View style={[styles.footer, { borderTopColor: colors.line }]}>
              <View style={styles.footerRow}>
                <Pressable onPress={() => setPhase('input')} style={styles.back}>
                  <Text style={[type.body, { color: colors.muted }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={confirmAdd}
                  disabled={selectedCount === 0}
                  style={[styles.primary, { backgroundColor: selectedCount ? colors.accent : colors.line }]}
                >
                  <Text style={[type.body, { color: selectedCount ? colors.accentInk : colors.muted }]}>
                    Add {selectedCount} item{selectedCount === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  fillPlain: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,18,10,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    maxHeight: '88%',
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
  scrollArea: { flexShrink: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  input: {
    minHeight: 96,
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
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  primary: { flex: 1, height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  // Same as primary but for a vertical (column) context — no flex, so its
  // height isn't collapsed to zero. Stretches full width via the column's
  // default align-items: stretch.
  primaryBlock: { height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
