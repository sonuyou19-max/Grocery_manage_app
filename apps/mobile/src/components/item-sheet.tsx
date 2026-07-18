import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SupermarketBadge } from '@/components/supermarket-badge';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/categorize';
import { parsePriceToCents } from '@/lib/money';
import { orderedStoreOptions, recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { useGroceries, useItem } from '@/store/groceries';
import { radii, spacing, type, useTheme } from '@/theme';

const UNITS: (string | null)[] = [null, 'pcs', 'g', 'kg', 'ml', 'L'];

interface ItemSheetProps {
  listId: string;
  itemId: string | null;
  mode: 'added' | 'edit';
  onClose: () => void;
}

const parseQuantity = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isNaN(value) || value <= 0 ? null : value;
};

/**
 * Bottom sheet shown right after an item is added ("Added to <category>") and
 * again when tapping an item to edit it. Everything below the category is
 * optional — quantity, price and the supermarket to buy it from.
 */
export function ItemSheet({ listId, itemId, mode, onClose }: ItemSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { updateItem } = useGroceries();
  const liveItem = useItem(listId, itemId ?? undefined);
  const storePrefs = useStorePrefs();

  // Keep the last-open item rendered while the modal animates out, so the
  // sheet doesn't blank/flicker the moment itemId goes null on close.
  const lastItemRef = useRef(liveItem ?? null);
  if (liveItem) lastItemRef.current = liveItem;
  const itemObj = liveItem ?? lastItemRef.current;

  const [name, setName] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [customStore, setCustomStore] = useState(false);
  const dragY = useSharedValue(0);

  // Seed local fields whenever a different item opens (not on close, so the
  // outgoing sheet keeps its dragged position while animating away).
  useEffect(() => {
    if (!liveItem) return;
    setName(liveItem.name);
    setQtyText(liveItem.quantity != null ? String(liveItem.quantity) : '');
    setPriceText(liveItem.priceCents != null ? (liveItem.priceCents / 100).toFixed(2) : '');
    dragY.value = 0;
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull-down on the grab handle / header dismisses the sheet.
  const dragGesture = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (dragY.value > 110 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        dragY.value = withTiming(0, { duration: 160 });
      }
    });

  const sheetDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const visible = itemId != null;
  if (!itemObj) {
    // Never opened yet — nothing to render.
    return (
      <Modal visible={false} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} />
      </Modal>
    );
  }

  const patch = (p: Parameters<typeof updateItem>[2]) => {
    if (liveItem) updateItem(listId, liveItem.id, p);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.sheet, { backgroundColor: colors.surface }, sheetDragStyle]}>
          {/* Drag zone: grab handle + header — pull down to dismiss */}
          <GestureDetector gesture={dragGesture}>
            <View collapsable={false}>
              <View style={[styles.grab, { backgroundColor: colors.line }]} />
              <View style={[styles.header, styles.headerZone]}>
                {mode === 'added' ? (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                    <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
                      Added to {CATEGORY_LABELS[itemObj.category]}
                    </Text>
                  </>
                ) : (
                  <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>Edit item</Text>
                )}
                <Pressable onPress={onClose} hitSlop={10}>
                  <Ionicons name="close" size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            style={styles.scrollArea}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            {/* Name */}
            <Field label="Item">
              <TextInput
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (t.trim()) patch({ name: t.trim() });
                }}
                style={[styles.input, inputColors(colors)]}
              />
            </Field>

            {/* Category */}
            <Field label="Category">
              <View style={styles.chips}>
                {CATEGORY_ORDER.map((cat) => {
                  const active = itemObj.category === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => patch({ category: cat })}
                      style={[
                        styles.chip,
                        { borderColor: active ? colors.accent : colors.line },
                        active && { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <Text
                        style={[styles.chipText, { color: active ? colors.accent : colors.muted }]}
                      >
                        {CATEGORY_LABELS[cat]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            {/* Quantity (optional) */}
            <Field label="Quantity · optional">
              <View style={styles.qtyRow}>
                <TextInput
                  value={qtyText}
                  onChangeText={(t) => {
                    setQtyText(t);
                    patch({ quantity: parseQuantity(t) });
                  }}
                  placeholder="—"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.qtyInput, inputColors(colors)]}
                />
                <View style={styles.chips}>
                  {UNITS.map((u) => {
                    const active = (itemObj.unit ?? null) === u;
                    return (
                      <Pressable
                        key={u ?? 'none'}
                        onPress={() => patch({ unit: u })}
                        style={[
                          styles.chip,
                          { borderColor: active ? colors.accent : colors.line },
                          active && { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <Text
                          style={[styles.chipText, { color: active ? colors.accent : colors.muted }]}
                        >
                          {u ?? 'none'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </Field>

            {/* Price (optional) */}
            <Field label="Price · optional">
              <View style={[styles.input, styles.priceRow, inputColors(colors)]}>
                <Text style={[type.body, { color: colors.muted }]}>€</Text>
                <TextInput
                  value={priceText}
                  onChangeText={(t) => {
                    setPriceText(t);
                    patch({ priceCents: parsePriceToCents(t) });
                  }}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: colors.ink }]}
                />
              </View>
            </Field>

            {/* Supermarket (optional) */}
            <Field label="Buy at · optional">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.storeRow}
                keyboardShouldPersistTaps="handled"
              >
                <StoreOption
                  active={itemObj.store == null}
                  onPress={() => patch({ store: null })}
                  colors={colors}
                >
                  <Ionicons name="remove-circle-outline" size={22} color={colors.muted} />
                  <Text style={[styles.storeLabel, { color: colors.muted }]}>None</Text>
                </StoreOption>

                {orderedStoreOptions(storePrefs).map((entry) => (
                  <StoreOption
                    key={entry.id}
                    active={itemObj.store === entry.id}
                    onPress={() => {
                      patch({ store: entry.id });
                      recordStoreUse(entry.id);
                    }}
                    colors={colors}
                  >
                    <SupermarketBadge store={entry.id} />
                    <Text style={[styles.storeLabel, { color: colors.ink }]} numberOfLines={1}>
                      {entry.kind === 'chain' ? entry.chain.name : entry.id}
                    </Text>
                  </StoreOption>
                ))}

                <StoreOption active={false} onPress={() => setCustomStore(true)} colors={colors}>
                  <View style={[styles.customBadge, { borderColor: colors.accent }]}>
                    <Ionicons name="add" size={16} color={colors.accent} />
                  </View>
                  <Text style={[styles.storeLabel, { color: colors.accent }]} numberOfLines={1}>
                    Other
                  </Text>
                </StoreOption>
              </ScrollView>
            </Field>
          </ScrollView>

          {/* Pinned footer — always reachable, above the keyboard */}
          <View
            style={[
              styles.footer,
              { borderTopColor: colors.line, paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <Pressable onPress={onClose} style={[styles.done, { backgroundColor: colors.accent }]}>
              <Text style={[type.body, { color: colors.accentInk }]}>Done</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

      <TextPromptModal
        visible={customStore}
        title="Custom store"
        placeholder="e.g. Local farm shop"
        confirmLabel="Set"
        onCancel={() => setCustomStore(false)}
        onSubmit={(value) => {
          patch({ store: value });
          recordStoreUse(value);
          setCustomStore(false);
        }}
      />
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

function StoreOption({
  active,
  onPress,
  colors,
  children,
}: {
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.storeOption,
        { borderColor: active ? colors.accent : colors.line },
        active && { backgroundColor: colors.accentSoft },
      ]}
    >
      {children}
    </Pressable>
  );
}

const inputColors = (colors: ReturnType<typeof useTheme>['colors']) => ({
  color: colors.ink,
  backgroundColor: colors.bg,
  borderColor: colors.line,
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(12,18,10,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  grab: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.sm },
  scrollArea: { flexShrink: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.lg },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerZone: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  field: { gap: spacing.sm },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1.5,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  qtyRow: { gap: spacing.md },
  qtyInput: { width: 100 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priceInput: { flex: 1, fontSize: 16, paddingVertical: spacing.md },
  storeRow: { gap: spacing.sm, paddingRight: spacing.lg },
  storeOption: {
    width: 78,
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  storeLabel: { fontSize: 11, fontWeight: '600' },
  customBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
