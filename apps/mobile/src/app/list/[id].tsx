import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView, KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClaimChip, ShoppersBadge } from '@/components/claim-chip';
import { FlyToCart, type FlyToCartHandle } from '@/components/fly-to-cart';
import { GlassView } from '@/components/glass';
import { EcoBar } from '@/components/eco-bar';
import { useRecipeGate } from '@/lib/recipe-gate';
import { ecoScoreFor } from '@/lib/item-carbon';
import { ItemEmoji } from '@/components/item-emoji';
import { ItemSheet } from '@/components/item-sheet';
import { ListPantryStrip } from '@/components/list-pantry-strip';
import { MeshBackground } from '@/components/mesh-background';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { categoryLabel, CATEGORY_ORDER } from '@/lib/categorize';
import { emojiFor } from '@/lib/item-emoji';
import { haptics } from '@/lib/haptics';
import { rubberBand, SPRING, springTo } from '@/lib/motion';
import { useAuth } from '@/store/auth';
import { useGroceries, useList, type Item } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useLocale } from '@/store/locale';
import { usePantryIntel, type PurchaseDetail } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

// Enable the collapse/expand animation on Android too (same guard as Pantry).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const { openOrRedirect } = useRecipeGate();
  const list = useList(id);
  const { addItem, toggleItem, deleteItem, setClaim, shoppersOnline } = useGroceries();
  const { user } = useAuth();
  const { household, members } = useHousehold();
  const { logPurchase, unlogRecent } = usePantryIntel();
  const [draft, setDraft] = useState('');
  /** The cart section is a footer, not the list — closed until asked for. */
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<'added' | 'edit'>('added');
  const [quickAdd, setQuickAdd] = useState(false);

  // Pending purchase logs, keyed by item id. Checking an item schedules a log a
  // few seconds out; unchecking cancels it — so a mistaken tick never reaches
  // the burn-rate engine. Anything still pending is flushed on leaving.
  /** Row views, so a check-off can measure where its item currently sits. */
  const rowRefs = useRef(new Map<string, View>());
  const flightRef = useRef<FlyToCartHandle>(null);
  /** The bag's centre in window coords — the destination every flight aims at. */
  const bagPoint = useRef<{ x: number; y: number } | null>(null);
  const bagRef = useRef<View>(null);
  /** Bumps when a glyph lands, so the bag acknowledges the arrival. */
  const bagScale = useSharedValue(1);
  // Declared here, with the other hooks, and NOT next to the bag markup that
  // uses it. Below this component's `if (!list)` return is a region where no
  // hook may be called: this screen renders once with the list still undefined
  // whenever it is opened before the household's lists have arrived, and a hook
  // that only runs on the render where the list exists changes the hook count
  // between renders — "Rendered more hooks than during the previous render",
  // which is fatal.
  const bagStyle = useAnimatedStyle(() => ({ transform: [{ scale: bagScale.value }] }));

  const purchaseTimers = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout>;
        name: string;
        category: Item['category'];
        detail: PurchaseDetail;
      }
    >
  >(new Map());
  useEffect(() => {
    const timers = purchaseTimers.current;
    return () => {
      for (const { timer, name, category, detail } of timers.values()) {
        clearTimeout(timer);
        logPurchase(name, category, detail); // flush: they left it checked
      }
      timers.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A claim stores a user id; the household roster is the only place a name for
  // it exists. Falls back to a generic label rather than showing a raw uuid when
  // the claimer has since left the household.
  const nameFor = (userId: string): string =>
    members.find((m) => m.user_id === userId)?.display_name?.trim() || t('claim.someone');

  // Names of other members with the app open right now, for the live badge.
  const shopperNames = useMemo(
    () => shoppersOnline.map((id) => members.find((m) => m.user_id === id)?.display_name?.trim() || t('claim.someone')),
    [shoppersOnline, members, t],
  );

  /**
   * Category groups hold ONLY what is still to buy.
   *
   * A checked item has left the list in the user's head the moment it goes in
   * the trolley, so it leaves the list on screen too — it lands in the cart
   * section below instead. Keeping it in place, struck through, meant the list
   * grew longer as you shopped, which is backwards.
   */
  const grouped = useMemo(() => {
    if (!list) return [];
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: list.items.filter((it) => it.category === cat && !it.checked),
    })).filter((g) => g.items.length > 0);
  }, [list]);

  /** What's in the cart, newest first, for the collapsed section at the end. */
  const inCartItems = useMemo(() => (list ? list.items.filter((it) => it.checked) : []), [list]);

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

  /**
   * Send the item's emoji arcing to the bag, then let the row collapse.
   *
   * Both endpoints are measured at the moment of the tap rather than cached:
   * the list scrolls, rows reflow as earlier items leave, and a stale origin
   * would launch the glyph from wherever the row used to be.
   *
   * Everything here is best-effort. If a measurement comes back null — the row
   * unmounted between the tap and the callback, which a fast double-tap can do
   * — the flight is skipped and the check-off proceeds exactly as before. The
   * animation is decoration; it must never be able to block the actual action.
   */
  const flyToCart = (item: Item) => {
    const row = rowRefs.current.get(item.id);
    const overlay = flightRef.current;
    if (!row || !overlay || !bagPoint.current) return;
    row.measureInWindow((x, y, w, h) => {
      if (w === 0 && h === 0) return;
      const from = overlay.toLocal(x + 34, y + h / 2);
      const to = overlay.toLocal(bagPoint.current!.x, bagPoint.current!.y);
      overlay.launch(emojiFor(item.name, item.category), from, to);
    });
  };

  /**
   * Remember where the bag is, in window coords.
   *
   * Re-measured on every layout rather than once: the header reflows when the
   * shoppers badge appears or a long list name wraps to two lines, and a
   * destination fixed at mount would then be a few points out for the rest of
   * the session.
   */
  const measureBag = () => {
    requestAnimationFrame(() => {
      bagRef.current?.measureInWindow((x, y, w, h) => {
        if (w === 0 && h === 0) return;
        bagPoint.current = { x: x + w / 2, y: y + h / 2 };
      });
    });
  };

  /** The bag acknowledging a landing — a short squash and settle. */
  const onGlyphArrive = () => {
    haptics.tick();
    bagScale.value = withSequence(
      withSpring(1.28, { damping: 12, stiffness: 320 }),
      withSpring(1, SPRING.settle),
    );
  };

  const handleToggle = (item: Item) => {
    const wasComplete = list.items.length > 0 && checkedCount === list.items.length;
    const completing = !item.checked && !wasComplete && checkedCount + 1 === list.items.length;
    if (completing) haptics.success();
    else haptics.tick();

    const willCheck = !item.checked;
    // Launch BEFORE the state change: the row still exists to be measured, and
    // the glyph leaves as the gap closes rather than after it.
    if (willCheck) flyToCart(item);
    // One configureNext covers the row leaving its category group and the cart
    // section growing, so the two halves of the move animate together instead
    // of as two separate jumps.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    toggleItem(list.id, item.id);

    // Checking an item = you bought it → feed the burn-rate model, but only if
    // it stays checked; a quick untick (mistap) cancels the log.
    const timers = purchaseTimers.current;
    const pending = timers.get(item.id);
    if (pending) clearTimeout(pending.timer);
    if (willCheck) {
      const { name, category } = item;
      // Snapshot the price/store/amount as they are at check-off. Read now
      // rather than when the timer fires, so editing the row in between can't
      // rewrite what the log says was paid — and the list's own store fills in
      // when the item doesn't carry one.
      const detail: PurchaseDetail = {
        priceCents: item.priceCents,
        store: item.store ?? list.store ?? null,
        quantity: item.quantity,
        unit: item.unit,
        bio: item.bio,
      };
      timers.set(item.id, {
        name,
        category,
        detail,
        timer: setTimeout(() => {
          logPurchase(name, category, detail);
          timers.delete(item.id);
        }, PURCHASE_DEBOUNCE),
      });
    } else {
      // Unticking. Two cases, and the debounce decides which:
      //  - the timer was still pending, so nothing was ever written and
      //    dropping it is the whole cleanup;
      //  - it had already fired, so a transaction exists. unlogRecent removes
      //    it only if it is younger than the mistake window; an older one is a
      //    real past purchase and stands, with the untick meaning "we need this
      //    again" rather than "that never happened".
      timers.delete(item.id);
      unlogRecent(item.name);
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
  /**
   * Import into the list already open.
   *
   * Routed rather than sheeted from here, so the import screen is the same
   * screen either way — one place that knows how to talk to the function, one
   * set of failure states. The `to` param is what makes it append instead of
   * creating.
   */
  const onImport = () => {
    haptics.tick();
    openOrRedirect(() => router.push({ pathname: '/recipe', params: { to: list.id } }));
  };

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
          {/* Renders nothing when you're the only one here. */}
          <ShoppersBadge names={shopperNames} />
        </View>
        {list.items.length > 0 && (
          <Animated.View ref={bagRef} onLayout={measureBag} style={bagStyle}>
            <Pressable
              onPress={() => router.push({ pathname: '/shop/[id]', params: { id: list.id } })}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('listDetail.inCartCount', {
                checked: checkedCount,
                total: list.items.length,
              })}
            >
              <Ionicons name="bag-check-outline" size={22} color={colors.accent} />
              {/* The count is what makes the destination legible: the glyph
                  arrives somewhere that visibly changes, rather than just
                  vanishing behind an icon. */}
              {checkedCount > 0 && (
                <View style={[styles.bagBadge, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.bagBadgeText, { color: colors.accentInk }]}>
                    {checkedCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </Animated.View>
        )}
        {/* Import straight into THIS list. Same flow as the create sheet's
            row, minus the naming step — the list already has a name. */}
        <Pressable onPress={onImport} hitSlop={12} accessibilityLabel={t('recipe.title')}>
          <Ionicons name="sparkles-outline" size={22} color={colors.plusInk} />
        </Pressable>
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

      {/* How light this basket is, while it is still a basket.
          Free, and deliberately so: the feedback is only worth anything before
          you have bought the thing, and a paywall on the one screen where it
          could change a decision would make the whole feature decorative. */}
      <BasketEcoStrip items={list.items} />

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
                rowRef={(v) => {
                  if (v) rowRefs.current.set(it.id, v);
                  else rowRefs.current.delete(it.id);
                }}
                onToggle={() => handleToggle(it)}
                onEdit={() => openEdit(it)}
                onDelete={() => deleteItem(list.id, it.id)}
                // Only offer claiming when it can matter: someone else is
                // online, or the item is already claimed. Solo shoppers see the
                // row exactly as before.
                claimable={shoppersOnline.length > 0 || it.claimedBy != null}
                claimedByName={it.claimedBy ? nameFor(it.claimedBy) : null}
                claimMine={it.claimedBy != null && it.claimedBy === user?.id}
                onToggleClaim={() => {
                  haptics.tick();
                  setClaim(list.id, it.id, it.claimedBy == null);
                }}
              />
            ))}
          </View>
        ))}
        {list.items.length === 0 && (
          <Text style={[type.sub, { color: colors.muted, textAlign: 'center', marginTop: spacing.xl }]}>
            {t('listDetail.emptyItems')}
          </Text>
        )}

        {/* In the cart.
            Collapsed by default and sitting after everything else, so the list
            proper is what's still to buy. It exists at all because unticking has
            to stay reachable: a mistap must be correctable here, not only from
            another screen. */}
        {inCartItems.length > 0 && (
          <View style={styles.cartSection}>
            <Pressable
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                haptics.tick();
                setCartOpen((v) => !v);
              }}
              style={styles.catRow}
              hitSlop={6}
            >
              <Ionicons name="bag-check" size={15} color={colors.muted} />
              <Text style={[type.label, { color: colors.muted }]}>
                {t('listDetail.inCartSection', { count: inCartItems.length })}
              </Text>
              <View style={[styles.catLine, { backgroundColor: colors.line }]} />
              <Ionicons
                name={cartOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.muted}
              />
            </Pressable>

            {cartOpen &&
              inCartItems.map((it) => (
                <SwipeableItemRow
                  key={it.id}
                  item={it}
                  onToggle={() => handleToggle(it)}
                  onEdit={() => openEdit(it)}
                  onDelete={() => deleteItem(list.id, it.id)}
                  claimable={false}
                  claimedByName={null}
                  claimMine={false}
                  onToggleClaim={() => {}}
                />
              ))}
          </View>
        )}
      </ScrollView>

      {/* Flight layer. Outside the ScrollView so an arc is never clipped by it,
          and last in the tree so it paints above the header it flies toward. */}
      <FlyToCart ref={flightRef} onArrive={onGlyphArrive} />

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
  rowRef,
  onToggle,
  claimable,
  claimedByName,
  claimMine,
  onToggleClaim,
  onEdit,
  onDelete,
}: {
  /** Registered so a check-off can measure where this row currently sits. */
  rowRef?: (v: View | null) => void;
  item: Item;
  onToggle: () => void;
  claimable: boolean;
  claimedByName: string | null;
  claimMine: boolean;
  onToggleClaim: () => void;
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

  const close = () => {
    'worklet';
    // No gesture behind this one (it's a tap elsewhere closing the row), so
    // there is no velocity to carry — spring from rest.
    tx.value = withSpring(0, SPRING.settle);
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
      // Elastic past the reveal width, and elastic past closed in the other
      // direction — dragging right on a closed row now pushes back instead of
      // sitting inert under the finger.
      tx.value = next > 0 ? rubberBand(next, 0, 22) : -rubberBand(-next, DELETE_WIDTH);
      // Rigid snap the instant the swipe crosses the open/close threshold.
      const beyond = tx.value < -DELETE_WIDTH / 2;
      if (beyond !== pastThreshold.value) {
        pastThreshold.value = beyond;
        runOnJS(haptics.snap)();
      }
    })
    .onEnd((e) => {
      // Decide on velocity as well as position: a quick flick should open the
      // row even if the finger never travelled past the halfway mark, which is
      // what "shouldOpen = position only" got wrong.
      const flung = Math.abs(e.velocityX) > 600;
      const shouldOpen = flung ? e.velocityX < 0 : tx.value < -DELETE_WIDTH / 2;
      tx.value = springTo(shouldOpen ? -DELETE_WIDTH : 0, e.velocityX, SPRING.settle);
      runOnJS(setOpen)(shouldOpen);
    })
    .onFinalize(() => {
      runOnJS(setSwiping)(false);
    });

  const guard = (fn: () => void) => () => {
    if (swipingRef.current) return;
    if (openRef.current) {
      tx.value = withSpring(0, SPRING.settle);
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
    <View ref={rowRef} style={styles.swipeWrap}>
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
            <View style={styles.nameRow}>
              <ItemEmoji name={it.name} category={it.category} dim={it.checked} />
              <Text
                style={[
                  type.body,
                  styles.grow,
                  { color: it.checked ? colors.muted : colors.ink },
                  it.checked && styles.struck,
                ]}
              >
                {it.name}
              </Text>
              {/* The impact dot was here and is gone deliberately. A coloured
                  band on every row turned writing a list into being marked,
                  and the one place the judgement is welcome is the summary
                  below, which you look at when you choose to. The leaf stays:
                  it is the user's own flag, not ours. */}
              {it.bio && !it.checked && (
                <Ionicons name="leaf" size={13} color={colors.accent} accessibilityLabel={t('eco.bioBadge')} />
              )}
            </View>
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

          {/* Claiming: only once a second person is around, and never on
              something already bought. */}
          {claimable && !it.checked && (
            <ClaimChip claimedByName={claimedByName} mine={claimMine} onPress={onToggleClaim} />
          )}

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
            tx.value = withSpring(0, SPRING.settle);
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

/**
 * "Most of this basket is light" — the live read on the open list.
 *
 * Hidden below four food items rather than shown as a near-empty bar: two
 * items is not a basket, and a bar that swings from 100 to 15 as you add the
 * second thing teaches people the number is noise. The same floor the weekly
 * history uses, for the same reason.
 */
function BasketEcoStrip({ items }: { items: Item[] }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const [explained, setExplained] = useState(false);
  const eco = useMemo(
    () => ecoScoreFor(items.map((it) => ({ name: it.name, category: it.category, bio: it.bio }))),
    [items],
  );
  if (eco.total < 4 || eco.score == null) return null;

  return (
    <GlassView radius={radii.md} style={styles.eco}>
      <View style={styles.ecoHead}>
        <Ionicons name="leaf-outline" size={16} color={colors.accent} />
        <Text style={[type.label, styles.grow, { color: colors.ink }]}>
          {t('eco.basketTitle')}
        </Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          {t('eco.lowShare', { percent: Math.round(eco.shares.low * 100) })}
        </Text>
        {/* A three-colour bar with no words is a rebus. The explanation is one
            tap away rather than always on, because it is worth reading once and
            then never again — and a permanent paragraph under a strip this
            small would be more explanation than thing explained. */}
        <Pressable
          onPress={() => {
            haptics.tick();
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExplained((v) => !v);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('eco.whatIsThis')}
        >
          <Ionicons
            name={explained ? 'information-circle' : 'information-circle-outline'}
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </View>
      <EcoBar shares={eco.shares} counts={eco.counts} compact />
      {explained && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('eco.basketExplainer')}</Text>
      )}
    </GlassView>
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
  bagBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bagBadgeText: { fontSize: 10, fontWeight: '800' },
  cartSection: { marginTop: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eco: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, gap: spacing.sm },
  ecoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
