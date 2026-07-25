import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView, KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { ItemSheet } from '@/components/item-sheet';
import { ListPantryStrip } from '@/components/list-pantry-strip';
import { MeshBackground } from '@/components/mesh-background';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { categoryLabel, CATEGORY_ORDER } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/store/auth';
import { useGroceries, useList, type Item } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useLocale } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

// Set this to the store/app link at launch. While empty, the invite tells the
// recipient how to join by code inside the app.
const APP_DOWNLOAD_URL = '';

// Opening the item sheet (a Modal — its own native window on Android) while
// the add-bar's TextInput is still closing the keyboard races two windows'
// keyboard transitions against each other, which can leave the sheet's
// keyboard-avoiding padding stuck open (see item-sheet.tsx). Dismissing first
// and awaiting the real native "hidden" event (not just firing-and-forgetting
// the dismiss call) closes that race. KeyboardController.dismiss() resolves
// immediately if the keyboard was already closed, and the timeout is a safety
// net in case some OEM keyboard never fires the hide event.
const KEYBOARD_DISMISS_TIMEOUT_MS = 400;

const dismissKeyboardAndWait = async () => {
  await Promise.race([
    KeyboardController.dismiss(),
    new Promise<void>((resolve) => setTimeout(resolve, KEYBOARD_DISMISS_TIMEOUT_MS)),
  ]);
};

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, scheme } = useTheme();
  const { t, money } = useLocale();
  const list = useList(id);
  const { addItem, toggleItem, deleteItem } = useGroceries();
  const { user } = useAuth();
  const { household } = useHousehold();
  const { logPurchase } = usePantryIntel();
  const [draft, setDraft] = useState('');
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<'added' | 'edit'>('added');
  const [quickAdd, setQuickAdd] = useState(false);

  // Pending purchase logs, keyed by item id. Checking an item schedules a log a
  // few seconds out; unchecking cancels it — so a mistaken tick never reaches
  // the burn-rate engine. Anything still pending is flushed on leaving.
  const purchaseTimers = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; name: string; category: Item['category'] }>>(
    new Map(),
  );
  useEffect(() => {
    const timers = purchaseTimers.current;
    return () => {
      for (const { timer, name, category } of timers.values()) {
        clearTimeout(timer);
        logPurchase(name, category); // flush: they left it checked
      }
      timers.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    if (!list) return [];
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: list.items.filter((it) => it.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [list]);

  const budget = useMemo(() => {
    const items = list?.items ?? [];
    const priced = items.filter((it) => it.priceCents != null);
    const total = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
    const inCart = priced
      .filter((it) => it.checked)
      .reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
    return {
      hasPrices: priced.length > 0,
      pricedCount: priced.length,
      totalCount: items.length,
      toBuy: total - inCart,
      inCart,
    };
  }, [list]);

  if (!list) {
    return (
      <View style={styles.root}>
        <MeshBackground />
        <SafeAreaView style={styles.fillTransparent}>
          <Text style={[type.body, { color: colors.ink, padding: spacing.xl }]}>
            {t('listDetail.gone')}
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  const checkedCount = list.items.filter((it) => it.checked).length;
  const progress = list.items.length ? checkedCount / list.items.length : 0;

  // Light tick on every check; a success chime the moment the last item goes
  // in the cart — the shopping trip is done.
  const PURCHASE_DEBOUNCE = 3500;

  const handleToggle = (item: Item) => {
    const wasComplete = list.items.length > 0 && checkedCount === list.items.length;
    const completing = !item.checked && !wasComplete && checkedCount + 1 === list.items.length;
    if (completing) haptics.success();
    else haptics.tick();

    const willCheck = !item.checked;
    toggleItem(list.id, item.id);

    // Checking an item = you bought it → feed the burn-rate model, but only if
    // it stays checked; a quick untick (mistap) cancels the log.
    const timers = purchaseTimers.current;
    const pending = timers.get(item.id);
    if (pending) clearTimeout(pending.timer);
    if (willCheck) {
      const { name, category } = item;
      timers.set(item.id, {
        name,
        category,
        timer: setTimeout(() => {
          logPurchase(name, category);
          timers.delete(item.id);
        }, PURCHASE_DEBOUNCE),
      });
    } else {
      timers.delete(item.id);
    }
  };

  // Adds/updates the store right away (instant feedback), then waits for the
  // keyboard to actually finish closing before opening the sheet — see
  // dismissKeyboardAndWait above for why the wait matters.
  const openSheet = async (id: string, mode: 'added' | 'edit') => {
    await dismissKeyboardAndWait();
    setSheetMode(mode);
    setSheetItemId(id);
  };

  const doAdd = (name: string) => {
    const newId = addItem(list.id, name);
    setDraft('');
    void openSheet(newId, 'added');
  };

  const submit = () => {
    const name = draft.trim();
    if (!name) return;

    const duplicate = list.items.find(
      (it) => it.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      Alert.alert(
        t('listDetail.dupTitle'),
        duplicate.checked
          ? t('listDetail.dupHereCart', { name: duplicate.name })
          : t('listDetail.dupHere', { name: duplicate.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('listDetail.addAnyway'), onPress: () => doAdd(name) },
        ],
      );
      return;
    }
    doAdd(name);
  };

  const openEdit = (item: Item) => {
    void openSheet(item.id, 'edit');
  };

  // Invite a family member: open WhatsApp pre-filled with the household join
  // code (falls back to the system share sheet if WhatsApp isn't available).
  const inviteFamily = async () => {
    if (!user) {
      Alert.alert(t('listDetail.signInShareTitle'), t('listDetail.signInShareBody'), [
        { text: t('common.notNow'), style: 'cancel' },
        { text: t('listDetail.signIn'), onPress: () => router.push('/auth/sign-in') },
      ]);
      return;
    }
    if (!household) {
      Alert.alert(t('listDetail.shareTitle'), t('listDetail.shareBody'), [
        { text: t('common.notNow'), style: 'cancel' },
        { text: t('listDetail.setUpHousehold'), onPress: () => router.push('/auth/household') },
      ]);
      return;
    }

    const lines = [
      t('listDetail.inviteIntro', { name: household.name }),
      '',
      t('listDetail.inviteCode', { code: household.invite_code }),
      '',
      APP_DOWNLOAD_URL
        ? t('listDetail.inviteGetApp', { url: APP_DOWNLOAD_URL })
        : t('listDetail.inviteInApp'),
    ];
    const message = lines.join('\n');

    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(whatsappUrl)) {
        await Linking.openURL(whatsappUrl);
        return;
      }
    } catch {
      // fall through to the system share sheet
    }
    try {
      await Share.share({ message });
    } catch {
      // dismissed — nothing to do
    }
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <KeyboardAvoidingView style={styles.fillTransparent} behavior="padding">
      <SafeAreaView style={styles.fillTransparent} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={styles.grow}>
          <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
            {list.name}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]}>
            {list.store ?? t('listDetail.anyStore')} ·{' '}
            {t('listDetail.inCartCount', { checked: checkedCount, total: list.items.length })}
          </Text>
        </View>
        {list.items.length > 0 && (
          <Pressable
            onPress={() => router.push({ pathname: '/shop/[id]', params: { id: list.id } })}
            hitSlop={12}
          >
            <Ionicons name="bag-check-outline" size={22} color={colors.accent} />
          </Pressable>
        )}
        <Pressable onPress={inviteFamily} hitSlop={12}>
          <Ionicons name="person-add-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      {/* Progress */}
      <View style={[styles.progressTrack, { backgroundColor: colors.line }]}>
        <View
          style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]}
        />
      </View>

      {/* Budget strip — only shows money once prices are logged */}
      <GlassView radius={radii.md} style={styles.budget}>
        {budget.hasPrices ? (
          <>
            <Stat label={t('listDetail.toBuy')} value={money(budget.toBuy)} colors={colors} />
            <Stat label={t('listDetail.inCartLabel')} value={money(budget.inCart)} colors={colors} />
            <Stat
              label={t('listDetail.priced')}
              value={t('listDetail.pricedOf', { count: budget.pricedCount, total: budget.totalCount })}
              colors={colors}
            />
          </>
        ) : (
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center', flex: 1 }]}>
            {t('listDetail.addPriceHint')}
          </Text>
        )}
      </GlassView>

      {/* Pantry, surfaced where you'd act on it: things you usually buy on this
          list that are due. A view over the one pantry, not a per-list copy. */}
      <ListPantryStrip list={list} />

      {/* Items */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {grouped.map((group) => (
          <View key={group.category}>
            <View style={styles.catRow}>
              <Text style={[type.label, { color: colors.accent }]}>
                {categoryLabel(group.category, t)}
              </Text>
              <View style={[styles.catLine, { backgroundColor: colors.line }]} />
            </View>
            {group.items.map((it) => (
              <SwipeableItemRow
                key={it.id}
                item={it}
                onToggle={() => handleToggle(it)}
                onEdit={() => openEdit(it)}
                onDelete={() => deleteItem(list.id, it.id)}
              />
            ))}
          </View>
        ))}
        {list.items.length === 0 && (
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center', marginTop: spacing.xl }]}>
            {t('listDetail.emptyItems')}
          </Text>
        )}
      </ScrollView>

      {/* Add bar — pinned above the keyboard by the screen-level
          KeyboardAvoidingView (padding on iOS, height on Android). */}
      <BlurView
        intensity={scheme === 'dark' ? 40 : 60}
        tint={colors.blurTint}
        experimentalBlurMethod="dimezisBlurView"
        style={[styles.addBarGlass, { borderTopColor: colors.glassBorder }]}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={styles.addBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('listDetail.addItem')}
              placeholderTextColor={colors.muted}
              style={[styles.input, { color: colors.ink, backgroundColor: colors.glassFill, borderColor: colors.glassBorder }]}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            <Pressable onPress={() => setQuickAdd(true)} hitSlop={8} style={styles.mic}>
              <Ionicons name="sparkles-outline" size={22} color={colors.accent} />
            </Pressable>
            <Pressable
              onPress={submit}
              style={[styles.addBtn, { backgroundColor: colors.accent, opacity: draft.trim() ? 1 : 0.45 }]}
            >
              <Ionicons name="add" size={24} color={colors.accentInk} />
            </Pressable>
          </View>
        </SafeAreaView>
      </BlurView>
      </SafeAreaView>
      </KeyboardAvoidingView>

      <ItemSheet
        listId={list.id}
        itemId={sheetItemId}
        mode={sheetMode}
        onClose={() => setSheetItemId(null)}
      />
      <QuickAddSheet visible={quickAdd} listId={list.id} onClose={() => setQuickAdd(false)} />
    </View>
  );
}

/** How far the row opens to reveal the Delete button (px). */
const DELETE_WIDTH = 92;

/**
 * One list item row with left-swipe-to-delete. Unlike a stock swipeable, the
 * row content barely moves — the Delete button slides in from the right *over*
 * the price area, so the item name always stays fully visible. The gesture only
 * engages on a clear horizontal drag (activeOffsetX) and yields to the vertical
 * ScrollView (failOffsetY). Taps are guarded so a swipe never opens the edit
 * sheet, and a tap while open simply closes the row.
 */
function SwipeableItemRow({
  item: it,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: Item;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const { t, money } = useLocale();
  const tx = useSharedValue(0); // 0 = closed, -DELETE_WIDTH = open
  const startX = useSharedValue(0);
  const pastThreshold = useSharedValue(false);
  const openRef = useRef(false);
  const swipingRef = useRef(false);

  const setOpen = (v: boolean) => {
    openRef.current = v;
  };
  const setSwiping = (v: boolean) => {
    swipingRef.current = v;
  };

  // Gentle, unhurried settle — the "small and slow" the design calls for.
  const settle = { duration: 300, easing: Easing.out(Easing.cubic) };

  const close = () => {
    'worklet';
    tx.value = withTiming(0, settle);
    runOnJS(setOpen)(false);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => {
      startX.value = tx.value;
      runOnJS(setSwiping)(true);
    })
    .onUpdate((e) => {
      const next = startX.value + e.translationX;
      tx.value = Math.min(0, Math.max(-DELETE_WIDTH, next));
      // Rigid snap the instant the swipe crosses the open/close threshold.
      const beyond = tx.value < -DELETE_WIDTH / 2;
      if (beyond !== pastThreshold.value) {
        pastThreshold.value = beyond;
        runOnJS(haptics.snap)();
      }
    })
    .onEnd(() => {
      const shouldOpen = tx.value < -DELETE_WIDTH / 2;
      tx.value = withTiming(shouldOpen ? -DELETE_WIDTH : 0, settle);
      runOnJS(setOpen)(shouldOpen);
    })
    .onFinalize(() => {
      runOnJS(setSwiping)(false);
    });

  const guard = (fn: () => void) => () => {
    if (swipingRef.current) return;
    if (openRef.current) {
      tx.value = withTiming(0, settle);
      openRef.current = false;
      return;
    }
    fn();
  };

  // Content only nudges a hair so the name never leaves the screen.
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value * 0.12 }],
  }));
  // Delete slides in from the right edge and fades up as it arrives.
  const deleteStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: DELETE_WIDTH + tx.value }],
    opacity: interpolate(tx.value, [-DELETE_WIDTH, -DELETE_WIDTH * 0.15, 0], [1, 0.25, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.swipeWrap}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.itemRow, { borderBottomColor: colors.glassBorder }, rowStyle]}
        >
          <Pressable onPress={guard(onToggle)} hitSlop={8}>
            <View
              style={[
                styles.tick,
                { borderColor: it.checked ? colors.accent : colors.muted },
                it.checked && { backgroundColor: colors.accent },
              ]}
            >
              {it.checked && <Ionicons name="checkmark" size={14} color={colors.accentInk} />}
            </View>
          </Pressable>

          <Pressable style={styles.grow} onPress={guard(onEdit)}>
            <Text
              style={[
                type.body,
                { color: it.checked ? colors.muted : colors.ink },
                it.checked && styles.struck,
              ]}
            >
              {it.name}
            </Text>
            {(it.quantity != null || it.store != null) && (
              <View style={styles.meta}>
                {it.store != null && <SupermarketBadge store={it.store} size={16} />}
                {it.quantity != null && (
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {it.quantity}
                    {it.unit ? ` ${it.unit}` : ''}
                  </Text>
                )}
              </View>
            )}
          </Pressable>

          <Pressable onPress={guard(onEdit)} hitSlop={8}>
            {it.priceCents != null ? (
              <Text style={[type.price, { color: colors.ink }]}>{money(it.priceCents)}</Text>
            ) : (
              <Text style={[type.price, { color: colors.muted, opacity: 0.5 }]}>＋ €</Text>
            )}
          </Pressable>
        </Animated.View>
      </GestureDetector>

      {/* Sits on top of the row's right edge; revealed as you swipe. */}
      <Animated.View style={[styles.deleteLayer, deleteStyle]} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            tx.value = withTiming(0, settle);
            openRef.current = false;
            onDelete();
          }}
          style={[styles.deleteAction, { backgroundColor: colors.crit }]}
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <Text style={styles.deleteText}>{t('listDetail.delete')}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Stat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.stat}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fillTransparent: { flex: 1, backgroundColor: 'transparent' },
  grow: { flex: 1, minWidth: 0 },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  progressTrack: { height: 6, borderRadius: 3, marginHorizontal: spacing.lg, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  budget: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.xs },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  catLine: { flex: 1, height: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  struck: { textDecorationLine: 'line-through' },
  swipeWrap: { overflow: 'hidden' },
  deleteLayer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_WIDTH,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  deleteAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginVertical: spacing.xs,
    borderRadius: radii.md,
  },
  deleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  addBarGlass: { borderTopWidth: StyleSheet.hairlineWidth },
  addBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  mic: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
