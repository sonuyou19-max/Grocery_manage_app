import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ParsedItem } from '@korb/shared';

import { Frosted } from '@/components/frosted';
import { categoryLabel } from '@/lib/categorize';
import { rubberBand, SPRING, springTo } from '@/lib/motion';
import { parseQuickAdd } from '@/lib/quick-add';
import { useGroceries, useList } from '@/store/groceries';
import { useT } from '@/store/locale';
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
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { addParsedItem } = useGroceries();
  const list = useList(listId);
  const { height: screenH } = useWindowDimensions();

  // Names already on this list, normalised, so quick-add doesn't silently add a
  // second "Milk" — matches the duplicate guard on the manual add bar.
  const existingNames = useMemo(
    () => new Set((list?.items ?? []).map((it) => it.name.trim().toLowerCase())),
    [list],
  );

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | 'loading' | 'review'>('input');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<TextInput>(null);
  const sheetY = useSharedValue(screenH);
  // Native keyboard height, driven per-frame by the platform (not JS `Keyboard`
  // events, which are unreliable inside a Modal's own window on Android — the
  // bug this replaced). `height` runs negative as the keyboard rises, so the
  // spacer style below flips the sign; it floors at the safe-area inset when
  // the keyboard is hidden.
  const { height: kbHeight } = useReanimatedKeyboardAnimation();

  const focusInput = () => inputRef.current?.focus();

  useEffect(() => {
    if (visible) {
      setText('');
      setPhase('input');
      setItems([]);
      setSelected([]);
      setError(null);
      cancelAnimation(sheetY);
      sheetY.value = screenH;
      // Slide the sheet fully up first, THEN raise the keyboard — decoupling the
      // two motions is what makes the entrance read as smooth.
      sheetY.value = withSpring(0, SPRING.sheet, (finished) => {
        if (finished) runOnJS(focusInput)();
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = (velocity = 0) => {
    Keyboard.dismiss();
    cancelAnimation(sheetY);
    sheetY.value = withSpring(screenH, { ...SPRING.sheet, velocity }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  /**
   * Pull down on the grab handle to dismiss — the same gesture the item sheet
   * has, so every sheet in the app answers to the same movement.
   *
   * Scoped to the handle and header rather than the whole sheet on purpose:
   * this one holds a TextInput and a scrolling review list, and a pan over
   * those would fight text selection and scrolling.
   */
  const dragGesture = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      sheetY.value = e.translationY >= 0 ? e.translationY : -rubberBand(-e.translationY, 0, 44);
    })
    .onEnd((e) => {
      if (sheetY.value > 110 || e.velocityY > 800) runOnJS(requestClose)(e.velocityY);
      else sheetY.value = springTo(0, e.velocityY, SPRING.sheet);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetY.value, [0, screenH * 0.7], [1, 0], Extrapolation.CLAMP),
  }));
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(-kbHeight.value, insets.bottom),
  }));

  const runParse = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase('loading');
    setError(null);
    const { items: parsed, error: err } = await parseQuickAdd(trimmed);
    if (err || !parsed) {
      setError(err ? t(`quickAdd.err.${err}`) : t('quickAdd.somethingWrong'));
      setPhase('input');
      return;
    }
    setItems(parsed);
    // Pre-tick everything except items already on the list — those default to
    // skipped so you don't add duplicates without meaning to.
    setSelected(parsed.map((p) => !existingNames.has(p.name.trim().toLowerCase())));
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => requestClose()}>
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fillPlain} onPress={() => requestClose()} />
        </Animated.View>

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <Frosted
            over="content"
            intensity={scheme === 'dark' ? 40 : 60}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Drag zone: grab handle + header — pull down to dismiss */}
          <GestureDetector gesture={dragGesture}>
            <View>
              <View style={[styles.grab, { backgroundColor: colors.line }]} />

              <View style={styles.header}>
                <Ionicons name="sparkles" size={20} color={colors.accent} />
                <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>{t('quickAdd.title')}</Text>
                <Pressable onPress={() => requestClose()} hitSlop={10}>
                  <Ionicons name="close" size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>

          {phase === 'review' ? (
            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={[type.sub, { color: colors.muted }]}>{t('quickAdd.tapToInclude')}</Text>
              {items.map((item, i) => {
                const on = selected[i];
                const dup = existingNames.has(item.name.trim().toLowerCase());
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
                        {categoryLabel(item.category, t)}
                        {item.quantity != null ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                      </Text>
                    </View>
                    {dup && (
                      <View style={[styles.dupTag, { backgroundColor: colors.bg, borderColor: colors.line }]}>
                        <Text style={[type.sub, { color: colors.muted }]}>{t('quickAdd.alreadyOnList')}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            /* Scrollable so that on small screens — where the 88%-height cap
               minus the keyboard leaves less room than the content needs — the
               button and mic hint can still be scrolled into view. */
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={t('quickAdd.placeholder')}
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  // Compact screens: a shorter field so the button and mic hint
                  // still fit above the keyboard without scrolling.
                  screenH < 700 && styles.inputCompact,
                  { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.line },
                ]}
                multiline
                editable={phase !== 'loading'}
              />
              {/* Button sits directly under the field so the keyboard never hides it. */}
              <Pressable
                onPress={runParse}
                disabled={!canParse}
                style={[styles.primaryBlock, { backgroundColor: colors.accent }]}
              >
                {phase === 'loading' ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text style={[type.body, { color: colors.accentInk }]}>{t('quickAdd.addWithAi')}</Text>
                )}
              </Pressable>
              {error ? <Text style={[type.sub, { color: colors.crit }]}>{error}</Text> : null}
              <View style={styles.hint}>
                <Ionicons name="mic-outline" size={15} color={colors.muted} />
                <Text style={[type.sub, { color: colors.muted, flex: 1 }]}>
                  {t('quickAdd.micHint')}
                </Text>
              </View>
            </ScrollView>
          )}

          {phase === 'review' && (
            <View style={[styles.footer, { borderTopColor: colors.line }]}>
              <View style={styles.footerRow}>
                <Pressable
                  onPress={() => {
                    setPhase('input');
                    setTimeout(focusInput, 60);
                  }}
                  style={styles.back}
                >
                  <Text style={[type.body, { color: colors.muted }]}>{t('common.back')}</Text>
                </Pressable>
                <Pressable
                  onPress={confirmAdd}
                  disabled={selectedCount === 0}
                  style={[styles.primary, { backgroundColor: colors.accent, opacity: selectedCount ? 1 : 0.45 }]}
                >
                  <Text style={[type.body, { color: colors.accentInk }]}>
                    {t('common.addCount', { count: selectedCount })}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Fills the space in front of the keyboard (or the safe area at rest),
              lifting the content while the blurred background stays anchored to
              the screen bottom — so no gap ever shows at the sheet's corners. */}
          <Animated.View style={keyboardSpacerStyle} />
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
  inputCompact: { minHeight: 64 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  dupTag: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
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
