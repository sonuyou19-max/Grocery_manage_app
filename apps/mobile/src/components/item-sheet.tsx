import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
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

import { UNITS } from '@korb/shared';

import { Frosted } from '@/components/frosted';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { currencySymbolFor } from '@/i18n';
import { categoryLabel, CATEGORY_ORDER } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { rubberBand, SPRING, springTo } from '@/lib/motion';
import { rememberItemDetails } from '@/lib/item-memory';
import { parsePriceToCents } from '@/lib/money';
import { totalCents } from '@/lib/purchase-log';
import { orderedStoreOptions, recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { useGroceries, useItem } from '@/store/groceries';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

// The real units only. "none" was a segment of its own and earned nothing: an
// item with no quantity shows no amount whatever the unit says, so the empty
// number field beside this already means "not measured". A unit suggested on add
// (lib/item-unit.ts) is only ever a prefill — this strip is the override, and
// whatever is chosen here is remembered per item and wins on every later add.
const UNIT_OPTIONS: string[] = [...UNITS];



interface ItemSheetProps {
  listId: string;
  itemId: string | null;
  onClose: () => void;
}

/**
 * The total, from what is typed in the unit-price field and the pack count.
 *
 * The single direction the sheet's arithmetic runs in. Everything that can
 * change the total — editing the price, stepping the count — goes through here,
 * so there is one expression to be right rather than three that must agree.
 */
const totalFor = (priceText: string, packs: number): number | null => {
  const each = parsePriceToCents(priceText);
  return each == null ? null : totalCents(each, packs);
};

const parseQuantity = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isNaN(value) || value <= 0 ? null : value;
};

/**
 * Bottom sheet shown right after an item is added ("Added to <category>") and
 * again when tapping an item to edit it. Everything below the category is
 * optional — quantity, price and the supermarket to buy it from.
 */
export function ItemSheet({ listId, itemId, onClose }: ItemSheetProps) {
  const { colors, scheme } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { t, currency, money } = useLocale();
  const { updateItem, renameItem } = useGroceries();
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

  // We drive enter/exit ourselves (Modal animationType="none"): sheetY is the
  // sheet's offset from its resting place — screen height when hidden, 0 when
  // open. The full-screen backdrop fades in lockstep, so dragging never
  // reveals an undimmed strip and closing is one continuous motion.
  const { height: screenH } = useWindowDimensions();
  const sheetY = useSharedValue(screenH);

  // Seed local fields and play the enter animation when an item opens.
  useEffect(() => {
    if (!liveItem) return;
    setName(liveItem.name);
    setQtyText(liveItem.quantity != null ? String(liveItem.quantity) : '');
    /*
     * The field shows the PER-PACK price, so what is stored (the total) has to
     * be divided back out by the count to seed it. Round to cents on the way in
     * or 999c across 3 packs redisplays as 3.3299999999999996.
     */
    const packs = liveItem.packs > 0 ? liveItem.packs : 1;
    setPriceText(
      liveItem.priceCents != null
        ? (Math.round(liveItem.priceCents / packs) / 100).toFixed(2)
        : '',
    );
    cancelAnimation(sheetY);
    // Entrance has no gesture behind it, but a spring still reads better than a
    // curve here because the sheet is heavy — it arrives and settles rather
    // than gliding to a stop. Clamped, so it never overshoots past its edge.
    sheetY.value = withSpring(0, SPRING.sheet);
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Commit a rename — once, when the field is done, and only if it can succeed.
   *
   * This used to write on every keystroke (`onChangeText` → `patch({ name })`),
   * which is wrong twice over. It sends one UPDATE per character, and worse, it
   * has no moment at which the name is finished and can be checked: renaming
   * "Oilve OLI" to "Olive Oil" on a list that already has an "Olive Oil" is a
   * write the unique index (migration 0018) refuses, so it came back 409, the
   * store resynced, and the rename simply undid itself with a Sentry issue as
   * the only trace. The user's report was exactly that: no warning, no
   * duplicate message, an error notification.
   *
   * So the name settles on blur and on close, and the store's `renameItem`
   * decides — it holds the check, so no caller can forget it. A refusal puts
   * the field back to the real name and says which item is in the way, because
   * "nothing happened" is the failure mode this is here to end.
   */
  const commitName = () => {
    if (!liveItem) return;
    const next = name.trim();
    // Blank is not a delete — restore rather than clearing the item's name.
    if (!next) {
      setName(liveItem.name);
      return;
    }
    if (next === liveItem.name) return;
    const result = renameItem(listId, liveItem.id, next);
    if (result.ok) return;
    setName(liveItem.name);
    Alert.alert(
      t('listDetail.dupTitle'),
      result.conflict.checked
        ? t('itemSheet.renameDupCart', { name: result.conflict.name })
        : t('itemSheet.renameDup', { name: result.conflict.name }),
    );
  };

  // On close, snapshot the item's final quantity/unit/store into per-item
  // memory (#3) so the next add of the same item prefills them. One capture
  // point covers every close path — the X, the backdrop, and pull-to-dismiss.
  const rememberUsuals = () => {
    if (!itemObj) return;
    rememberItemDetails(itemObj.name, {
      quantity: itemObj.quantity,
      unit: itemObj.unit,
      store: itemObj.store,
    });
  };

  /**
   * Animate the sheet off-screen, then tell the parent to unmount.
   *
   * `velocity` is the speed the finger was travelling when it let go, so a hard
   * flick throws the sheet off screen fast and a lazy drag past the threshold
   * eases it out. Defaulted to 0 for the close paths with no gesture (the X
   * button, the backdrop tap).
   */
  const requestClose = (velocity = 0) => {
    // Before rememberUsuals, so a rename that lands is the name remembered
    // against — and so closing the sheet counts as finishing the field, for the
    // user who types a new name and drags the sheet away without blurring it.
    commitName();
    rememberUsuals();
    cancelAnimation(sheetY);
    sheetY.value = withSpring(
      screenH,
      { ...SPRING.sheet, velocity },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  };

  // Pull-down on the grab handle / header dismisses the sheet. Routing the
  // dismiss through requestClose keeps the remember-on-close behaviour in one
  // place for both the button and the gesture.
  const dragGesture = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      // Downward tracks the finger exactly; upward rubber-bands, so dragging a
      // sheet that is already fully open pushes back instead of doing nothing.
      sheetY.value = e.translationY >= 0 ? e.translationY : -rubberBand(-e.translationY, 0, 44);
    })
    .onEnd((e) => {
      if (sheetY.value > 110 || e.velocityY > 800) {
        runOnJS(requestClose)(e.velocityY);
      } else {
        // Spring back carrying the velocity, so releasing mid-drag continues
        // the motion rather than restarting it.
        sheetY.value = springTo(0, e.velocityY, SPRING.sheet);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetY.value, [0, screenH * 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  const visible = itemId != null;
  if (!itemObj) {
    // Never opened yet — nothing to render.
    return null;
  }

  const patch = (p: Parameters<typeof updateItem>[2]) => {
    if (liveItem) updateItem(listId, liveItem.id, p);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => requestClose()}>
      {/* A Modal is its own native window, and gesture-handler only sees
          touches that pass through one of ITS roots. The one in _layout.tsx is
          in the app's window, not this one, so the pull-to-dismiss below had
          never run in its life — the handle was decoration. See sheet.tsx for
          the full account. */}
      <GestureHandlerRootView style={styles.fill}>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.fill}
      >
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
            <View collapsable={false}>
              <View style={[styles.grab, { backgroundColor: colors.line }]} />
              <View style={[styles.header, styles.headerZone]}>
                {/* One title now. The sheet used to double as an
                    "Added to Dairy" confirmation because adding opened it
                    automatically; it no longer does, so every opening is an
                    edit and the header can say so plainly. */}
                <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>
                  {t('itemSheet.editItem')}
                </Text>
                <Pressable onPress={() => requestClose()} hitSlop={10}>
                  <Ionicons name="close" size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            {...scrollIndicator}
            style={styles.scrollArea}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            {/* Name */}
            <Field label={t('itemSheet.itemLabel')}>
              <TextInput
                value={name}
                onChangeText={setName}
                // The name is committed when the field is finished, not per
                // keystroke — see commitName. `submitBehavior` (which supersedes
                // blurOnSubmit) so the Done key really ends editing rather than
                // leaving the field focused with an uncommitted name in it.
                onBlur={commitName}
                onSubmitEditing={commitName}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                style={[styles.input, inputColors(colors)]}
              />
            </Field>

            {/* Category */}
            <Field label={t('itemSheet.categoryLabel')}>
              <View style={styles.chips}>
                {CATEGORY_ORDER.map((cat) => {
                  const active = itemObj.category === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => {
                        if (itemObj.category !== cat) haptics.snap(); // moved between categories
                        patch({ category: cat });
                      }}
                      style={[
                        styles.chip,
                        { borderColor: active ? colors.accent : colors.line },
                        active && { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <Text
                        style={[styles.chipText, { color: active ? colors.accent : colors.muted }]}
                      >
                        {categoryLabel(cat, t)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            {/* Quantity: how much is in one pack. */}
            <Field label={t('itemSheet.quantityLabel')}>
              <View style={styles.amountRow}>
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
                {/* A connected strip rather than loose chips: it reads as
                    "exactly one of these" and costs a single row. */}
                <View style={[styles.segment, { borderColor: colors.line }]}>
                  {UNIT_OPTIONS.map((u, i) => {
                    const active = itemObj.unit === u;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => patch({ unit: u })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={u}
                        style={[
                          styles.segmentCell,
                          i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.line },
                          active && { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.segmentText,
                            { color: active ? colors.accent : colors.muted },
                          ]}
                        >
                          {u}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </Field>

            {/* Price: the sum, written out as a sum.
                unit price × packs = total, left to right, with the total as the
                only thing that is not an input. That direction is the whole
                rule — the two boxes are causes and the total is their effect,
                so it can never disagree with them.

                It used to run the other way. The stored value is the TOTAL, the
                field showed total ÷ packs, and the line under it read
                "3 × €0.33 = €1.00" — which is not true, and was on screen. The
                total shown here is computed from what is IN the field, so the
                arithmetic on the row is always the arithmetic it displays. */}
            <Field label={t('itemSheet.priceLabel')}>
              <View style={styles.priceMathRow}>
                <View style={[styles.input, styles.priceRow, styles.priceCell, inputColors(colors)]}>
                  <Text style={[type.body, { color: colors.muted }]}>
                    {currencySymbolFor(currency)}
                  </Text>
                  <TextInput
                    value={priceText}
                    onChangeText={(t) => {
                      setPriceText(t);
                      const each = parsePriceToCents(t);
                      patch({
                        priceCents: each == null ? null : totalCents(each, itemObj.packs),
                      });
                    }}
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[styles.priceInput, { color: colors.ink }]}
                  />
                </View>

                <Text style={[styles.mathOp, { color: colors.muted }]}>×</Text>

                <View style={[styles.stepper, { borderColor: colors.line }]}>
                  <Pressable
                    onPress={() => {
                      haptics.tick();
                      const next = Math.max(1, itemObj.packs - 1);
                      // Recomputed from the FIELD, not from the stored total:
                      // changing the count must not change the unit price.
                      patch({ packs: next, priceCents: totalFor(priceText, next) });
                    }}
                    disabled={itemObj.packs <= 1}
                    accessibilityRole="button"
                    accessibilityLabel={t('itemSheet.packsFewer')}
                    style={[styles.stepBtn, itemObj.packs <= 1 && styles.stepOff]}
                  >
                    <Ionicons name="remove" size={16} color={colors.ink} />
                  </Pressable>
                  <Text style={[type.body, styles.stepValue, { color: colors.ink }]}>
                    {itemObj.packs}
                  </Text>
                  <Pressable
                    onPress={() => {
                      haptics.tick();
                      const next = Math.min(999, itemObj.packs + 1);
                      patch({ packs: next, priceCents: totalFor(priceText, next) });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('itemSheet.packsMore')}
                    style={styles.stepBtn}
                  >
                    <Ionicons name="add" size={16} color={colors.ink} />
                  </Pressable>
                </View>

                <Text style={[styles.mathOp, { color: colors.muted }]}>=</Text>

                {/* Derived, and deliberately not a field. Nothing here takes
                    focus or a keyboard, because a total you can type is a total
                    that can contradict the numbers beside it. */}
                <View style={[styles.totalCell, { borderColor: colors.line }]}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={[type.body, styles.totalText, { color: colors.ink }]}
                  >
                    {money(totalFor(priceText, itemObj.packs) ?? 0)}
                  </Text>
                </View>
              </View>
            </Field>

            {/* Organic / local (optional).
                A claim only the shopper can make: Korb cannot tell whether the
                milk in the trolley was organic, so it never guesses. It sits
                after the price because that is the order the packet is read in
                — what it is, how much, how much it cost, then what kind. */}
            <Pressable
              onPress={() => {
                haptics.tick();
                patch({ bio: !itemObj.bio });
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: itemObj.bio }}
              style={[
                styles.bioRow,
                {
                  borderColor: itemObj.bio ? colors.accent : colors.line,
                  backgroundColor: itemObj.bio ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={itemObj.bio ? 'leaf' : 'leaf-outline'}
                size={20}
                color={itemObj.bio ? colors.accent : colors.muted}
              />
              <View style={styles.bioGrow}>
                <Text style={[type.body, { color: colors.ink }]}>{t('eco.bioLabel')}</Text>
                <Text style={[type.sub, { color: colors.muted }]}>{t('eco.bioHint')}</Text>
              </View>
              <Ionicons
                name={itemObj.bio ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={itemObj.bio ? colors.accent : colors.line}
              />
            </Pressable>

            {/* Supermarket (optional) */}
            <Field label={t('itemSheet.buyAtLabel')}>
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
                  <Text style={[styles.storeLabel, { color: colors.muted }]}>
                    {t('itemSheet.storeNone')}
                  </Text>
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
                    {t('itemSheet.storeOther')}
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
            <Pressable
              onPress={() => requestClose()}
              style={[styles.done, { backgroundColor: colors.accent }]}
            >
              <Text style={[type.body, { color: colors.accentInk }]}>{t('common.done')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>

      <TextPromptModal
        visible={customStore}
        title={t('itemSheet.customStoreTitle')}
        placeholder={t('itemSheet.customStorePlaceholder')}
        confirmLabel={t('itemSheet.customStoreConfirm')}
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
  bioGrow: { flex: 1, minWidth: 0 },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  fill: { flex: 1, justifyContent: 'flex-end' },
  fillPlain: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,18,10,0.45)',
  },
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
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Fixed and narrow: it holds "250" or "1.5". Left to grow it would take the
  // width the six unit segments need.
  qtyInput: { width: 64, textAlign: 'center', paddingHorizontal: spacing.sm },
  // One connected strip. The cells divide what is left after the number field,
  // so all six are equal whatever they say.
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  segmentCell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  /*
   * The sum row, and every part of it shrinks.
   *
   * The last version put a fixed-width stepper next to a growing price field and
   * a total, which added up to more than the sheet on a 360pt phone — the price
   * box ran off the right edge. Nothing here has a hard width now: the two boxes
   * share what is left after the operators and the stepper, and the stepper
   * itself is built from the narrowest controls that still take a finger.
   */
  priceMathRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  priceCell: { flexBasis: 0, flexGrow: 1.2, flexShrink: 1, minWidth: 0 },
  mathOp: { fontSize: 15, fontWeight: '700' },
  totalCell: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 44,
    borderWidth: 1,
    // Dashed, so it reads as an output rather than something to tap. A solid box
    // identical to the two inputs beside it is an invitation to type in it.
    borderStyle: 'dashed',
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  totalText: { fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  stepBtn: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Dimmed rather than removed at one pack: a control that vanishes shifts the
  // ones beside it, and the row would jump every time the count crossed 1.
  stepOff: { opacity: 0.3 },
  stepValue: { minWidth: 18, textAlign: 'center' },
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
