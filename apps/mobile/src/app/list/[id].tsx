import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  KeyboardAvoidingView,
  KeyboardController,
} from "react-native-keyboard-controller";
import Animated, {
  FadeInDown,
  SlideInDown,
  SlideOutDown,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnimatedMoney } from "@/components/animated-money";
import { Frosted } from "@/components/frosted";
import { PressScale } from "@/components/press-scale";
import { ClaimChip, ShoppersBadge } from "@/components/claim-chip";
import { CoachMark } from "@/components/coach-mark";
import { FlyToCart, type FlyToCartHandle } from "@/components/fly-to-cart";
import { GlassView } from "@/components/glass";
import { EcoBar } from "@/components/eco-bar";
import { useRecipeGate } from "@/lib/recipe-gate";
import { ecoScoreFor } from "@/lib/item-carbon";
import { ItemEmoji } from "@/components/item-emoji";
import { ItemSheet } from "@/components/item-sheet";
import { ListPantryStrip } from "@/components/list-pantry-strip";
import { MeshBackground } from "@/components/mesh-background";
import { QuickAddSheet } from "@/components/quick-add-sheet";
import { categoryLabel, CATEGORY_ORDER } from "@/lib/categorize";
import { useCoachMark } from "@/lib/coach-marks";
import { findEquivalent } from "@/lib/item-dup";
import { emojiFor } from "@/lib/item-emoji";
import { haptics } from "@/lib/haptics";
import { rubberBand, SPRING, springTo } from "@/lib/motion";
import { useAuth } from "@/store/auth";
import { useGroceries, useList, type Item } from "@/store/groceries";
import { useHousehold } from "@/store/household";
import { useLocale } from "@/store/locale";
import { usePantryIntel, type PurchaseDetail } from "@/store/pantry-intel";
import { radii, spacing, type, useScrollIndicator, useTheme } from "@/theme";

/*
 * No setLayoutAnimationEnabledExperimental call here, deliberately.
 *
 * Both files that use LayoutAnimation used to open with the usual
 * `Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental(true)`
 * incantation. On this app that was dead code AND dev-console noise:
 * BridgelessUIManager implements it as a no-op that warns
 * ("currently a no-op in the New Architecture") on every launch in dev.
 *
 * It is unnecessary because Reanimated 4 requires the New Architecture, so
 * Fabric is on — and per LayoutAnimation.js, "In Fabric, LayoutAnimations are
 * unconditionally enabled for Android". The animations below work; nothing has
 * to switch them on.
 */

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
    new Promise<void>((resolve) =>
      setTimeout(resolve, KEYBOARD_DISMISS_TIMEOUT_MS),
    ),
  ]);
};

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, scheme } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const { t, money } = useLocale();
  const { openOrRedirect } = useRecipeGate();
  const list = useList(id);
  const { addItem, toggleItem, deleteItem, setClaim, shoppersOnline } =
    useGroceries();
  const { user } = useAuth();
  const { household, members } = useHousehold();
  const { logPurchase, unlogRecent } = usePantryIntel();
  const [draft, setDraft] = useState("");
  /** The cart section is a footer, not the list — closed until asked for. */
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  /*
   * Whether the manual add field is showing. Closed by default, so the three
   * buttons read as three choices rather than as decoration around an input.
   */
  const [adding, setAdding] = useState(false);

  /** The row just added, tinted so the eye can find where it landed. */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

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
  const bagStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bagScale.value }],
  }));

  const purchaseTimers = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout>;
        name: string;
        category: Item["category"];
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
    members.find((m) => m.user_id === userId)?.display_name?.trim() ||
    t("claim.someone");

  // Names of other members with the app open right now, for the live badge.
  const shopperNames = useMemo(
    () =>
      shoppersOnline.map(
        (id) =>
          members.find((m) => m.user_id === id)?.display_name?.trim() ||
          t("claim.someone"),
      ),
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
  const inCartItems = useMemo(
    () => (list ? list.items.filter((it) => it.checked) : []),
    [list],
  );

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

  /*
   * Swipe-left-to-delete, taught on the first row that is actually there.
   *
   * Held back until the list has something on it — which on a new install is
   * moments away, not sessions, but the gate still matters: the row this points
   * at has to exist before it can be measured, and an empty list has none.
   *
   * Declared up here with the other hooks, ABOVE this screen's `if (!list)`
   * return — see the note on bagStyle. Below that guard is a region where no
   * hook may be called, because the screen renders once with the list still
   * undefined whenever it is opened before the household's lists arrive.
   * `grouped` is empty on that render, so the readiness gate is simply false.
   */
  const firstOpenId = grouped.find((g) => g.items.length > 0)?.items[0]?.id ?? null;
  const coachRef = useRef<View | null>(null);
  const deleteCoach = useCoachMark("listSwipeDelete", firstOpenId != null, coachRef);

  if (!list) {
    return (
      <View style={styles.root}>
        <MeshBackground />
        <SafeAreaView style={styles.fillTransparent}>
          <Text style={[type.body, { color: colors.ink, padding: spacing.xl }]}>
            {t("listDetail.gone")}
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
      withSpring(1.28, SPRING.punch),
      withSpring(1, SPRING.settle),
    );
  };

  const handleToggle = (item: Item) => {
    const wasComplete =
      list.items.length > 0 && checkedCount === list.items.length;
    const completing =
      !item.checked && !wasComplete && checkedCount + 1 === list.items.length;
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
        packs: item.packs,
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
  const openSheet = async (id: string) => {
    await dismissKeyboardAndWait();
    setSheetItemId(id);
  };

  /*
   * Add and get out of the way.
   *
   * This used to open the detail sheet on every add, so putting six things on a
   * list meant six sheets to dismiss — and the sheet asks for quantity, price,
   * store and organic, none of which anyone knows while typing "milk" at the
   * kitchen table. The information it wanted is the information you have at the
   * SHELF, which is a different moment.
   *
   * The item appearing in its category, plus the glyph that flies to the basket,
   * is the confirmation. Details are on demand now: tap the row.
   */
  const doAdd = (name: string, close = false) => {
    /*
     * One configureNext covers the whole insertion: the category's rows shift
     * down to make room and, when the item opens a category that was not on the
     * list before, the heading arrives with them. Without it the list simply
     * changes shape between frames and the eye has nothing to follow.
     */
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const id = addItem(list.id, name);
    setDraft("");

    /*
     * Which row is new, so it can say so.
     *
     * The list is grouped by category and sorted, so a typed item does not
     * appear where it was typed — "kheera" lands under Fruit & Veg, possibly
     * several sections up. The row fades in and holds a tint for a moment,
     * which is the only thing on screen that answers "where did that go".
     *
     * Cleared on a timer rather than on the next add, so adding six things in a
     * row highlights six rows rather than leaving a trail of them lit.
     */
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setJustAdded(id);
    highlightTimer.current = setTimeout(() => setJustAdded(null), 1400);

    /*
     * The + finishes; the return key does not.
     *
     * Two ways to submit, because they are two intentions. Return means "and the
     * next one" — the field keeps focus and six items stay six types and six
     * returns, which is the fastest path on this screen. The + button means
     * done: the bar slides away and the keyboard goes with it, so the list is
     * fully visible at the moment the row lands in it.
     *
     * Closed HERE rather than in the button's handler, so it happens only when
     * an item was really added. A duplicate that stops at an alert leaves the
     * bar open with the text still in it, rather than dismissing the keyboard
     * and throwing away what was typed.
     */
    if (close) {
      setAdding(false);
      KeyboardController.dismiss();
    }
  };

  const submit = (close = false) => {
    const name = draft.trim();
    if (!name) return;

    /*
     * A shared duplicate check, not a local trim-and-lowercase.
     *
     * The database decides this too — `item_key` is a generated column and a
     * unique index over the unticked rows (migration 0018) — and it collapses
     * runs of whitespace, which this check did not. "Olive  oil" with two
     * spaces therefore passed here, was rejected by Postgres, and the item
     * simply never appeared: the insert is optimistic, so the failure showed up
     * as the row quietly vanishing. One rule, one implementation, or the two
     * disagree exactly where nobody is looking. See lib/item-dup.
     *
     * findEquivalent rather than findDuplicate, because this check only ever
     * PREVENTS a write. "Potatoes" typed onto a list that already says
     * "Potato" is the same vegetable, and the two rows the screenshot showed
     * are what happens when only the database's opinion is consulted.
     */
    const duplicate = findEquivalent(list.items, name);
    if (!duplicate) {
      doAdd(name, close);
      return;
    }
    /*
     * A TICKED duplicate can be added again, and often should be: the index only
     * covers open rows, so a second unticked "Milk" alongside this morning's
     * bought one is a write Postgres accepts and a thing people really want.
     */
    if (duplicate.checked) {
      Alert.alert(
        t("listDetail.dupTitle"),
        t("listDetail.dupHereCart", { name: duplicate.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("listDetail.addAnyway"), onPress: () => doAdd(name, close) },
        ],
      );
      return;
    }
    /*
     * An UNTICKED one cannot, and offering "Add anyway" here was a promise the
     * database breaks: the insert comes back 23505 and the optimistic row
     * disappears a second later. There is no choice to offer, so this states
     * the fact and stops.
     */
    Alert.alert(t("listDetail.dupTitle"), t("listDetail.dupHere", { name: duplicate.name }));
  };

  const openEdit = (item: Item) => {
    void openSheet(item.id);
  };

  const onImport = () => {
    haptics.tick();
    openOrRedirect(() =>
      router.push({ pathname: "/recipe", params: { to: list.id } }),
    );
  };

  return (
    <View style={styles.root}>
      <MeshBackground />
      <KeyboardAvoidingView style={styles.fillTransparent} behavior="padding">
        <SafeAreaView style={styles.fillTransparent} edges={["top"]}>
          {/* Header. Back stays pinned while everything below it scrolls
              away — the spec has the title and buttons leaving the screen, and a
              page you can scroll into with no way back out is worse than one
              extra row of chrome. */}
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
            >
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
          </View>

          <Animated.ScrollView
            {...scrollIndicator}
            style={styles.scroll}
            contentContainerStyle={styles.list}
            /* The search bar is child index 1 and pins itself to the top; the
               title, actions and summary above it scroll away. stickyHeaderIndices
               keeps the pinned row inside the same scroll context, so it cannot
               drift out of step with the content the way a separately positioned
               bar does. */
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <View style={styles.titleBlock}>
                <Text style={[type.h1, { color: colors.ink }]} numberOfLines={2}>
                  {list.name}
                </Text>
                {/* "Any store" is not information — it is the absence of it,
                    dressed as a value and given the most prominent line under the
                    title. A named store is worth saying; the default is worth
                    nothing, so it says nothing. */}
                <Text style={[type.sub, { color: colors.muted }]}>
                  {list.store ? `${list.store} · ` : ""}
                  {t("listDetail.inCartCount", {
                    checked: checkedCount,
                    total: list.items.length,
                  })}
                </Text>
                {/* Renders nothing when you're the only one here. */}
                <ShoppersBadge names={shopperNames} />
              </View>

              {/* The two primary actions, sharing the row.
                  Solid green carries the one you came here to do; the receipt is
                  a ghost/outline so it reads as the second option rather than
                  competing with it. Both flexGrow with a zero basis, so they are
                  exactly half each whatever the labels say in German. */}
              {list.items.length > 0 && (
                <View style={styles.actionRow}>
                  <PressScale
                    onPress={() => {
                      haptics.tick();
                      router.push({
                        pathname: "/shop/[id]",
                        params: { id: list.id },
                      });
                    }}
                    accessibilityRole="button"
                    style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                  >
                    <Ionicons name="cart-outline" size={18} color={colors.accentInk} />
                    <Text style={[type.body, styles.btnLabel, { color: colors.accentInk }]}>
                      {t("listDetail.startShopping")}
                    </Text>
                  </PressScale>

                  {/* Signed out there is nowhere to write a receipt to:
                      receipts.household_id is not null and RLS answers to
                      membership. Asking for the camera first and refusing at
                      the end would waste four photographs and a vision call. */}
                  <PressScale
                    onPress={() => {
                      haptics.tick();
                      if (!user) {
                        router.push("/auth/sign-in");
                        return;
                      }
                      router.push({
                        pathname: "/receipt/capture",
                        params: { id: list.id },
                      });
                    }}
                    accessibilityRole="button"
                    style={[styles.ghostBtn, { borderColor: colors.accent }]}
                  >
                    <Ionicons name="camera-outline" size={18} color={colors.accent} />
                    <Text style={[type.body, styles.btnLabel, { color: colors.accent }]}>
                      {t("listDetail.scanReceipt")}
                    </Text>
                  </PressScale>
                </View>
              )}

              {/* Budget strip — and NOTHING when there is no money to show.
                  The empty state used to be a full-width card reading "add a
                  price to any item to track spend", which is instructions
                  wearing the costume of data: it occupied a card's worth of the
                  most valuable space on the screen to tell you about a feature
                  you had not asked for, on every list you had not priced. The
                  hint is gone rather than restyled — the price field is one tap
                  into any row, and a screen does not need to advertise it. */}
              {budget.hasPrices && (
                <GlassView radius={radii.md} style={styles.budget}>
                  <Stat
                    label={t("listDetail.toBuy")}
                    cents={budget.toBuy}
                    colors={colors}
                  />
                  <Stat
                    label={t("listDetail.inCartLabel")}
                    cents={budget.inCart}
                    colors={colors}
                  />
                  <Stat
                    label={t("listDetail.priced")}
                    value={t("listDetail.pricedOf", {
                      count: budget.pricedCount,
                      total: budget.totalCount,
                    })}
                    colors={colors}
                  />
                </GlassView>
              )}

              {/* The gap is on THIS wrapper, not on the budget strip above it.
                  It was on the strip, so when there were no prices to show and
                  the strip did not render, the eco card jumped up flush against
                  the buttons — the same list looked like two different layouts
                  depending on whether one item had a price. Spacing that belongs
                  to "what follows the actions" has to live on the thing that
                  always follows them. */}
              <View style={styles.ecoStrip}>
              {/* How light this basket is, while it is still a basket.
              Free, and deliberately so: the feedback is only worth anything before
              you have bought the thing, and a paywall on the one screen where it
              could change a decision would make the whole feature decorative. */}
              <BasketEcoStrip items={list.items} />
              </View>

              {/* Pantry, surfaced where you'd act on it: things you usually buy on this
              list that are due. A view over the one pantry, not a per-list copy. */}
              <ListPantryStrip list={list} />

              {/* Items */}
            </View>

            {/* Where the shop ends up.
            Collapsed by default, and above the list rather than below it. Both
            halves of that matter and they pull against each other: this is the
            part of the screen you are DONE with, so it must not compete with
            what is still to buy — but at the bottom of a long shop it was
            reachable only by scrolling past everything, which is the wrong
            trade for the one control that undoes a mistap. Collapsed, it costs
            a single row; open, it is exactly where you are already looking when
            you notice you ticked the wrong thing.

            It exists at all because unticking has to stay reachable: a mistap
            must be correctable here, not only from another screen — and
            unticking a row here returns it to its category group below, which
            is what makes it the undo for a whole trip.

            It says "added to pantry" rather than "in cart" because it outlives
            the trip. A trolley you are no longer pushing is not a trolley, and
            a list that still claims ten things are in one the week after you
            shopped is describing a moment that has passed. Where those items
            actually went is the pantry — except for a signed-out user, who has
            no pantry to go to, so they are told the true and smaller thing. */}
            {inCartItems.length > 0 && (
              <View style={styles.cartSection}>
                <Pressable
                  onPress={() => {
                    LayoutAnimation.configureNext(
                      LayoutAnimation.Presets.easeInEaseOut,
                    );
                    haptics.tick();
                    setCartOpen((v) => !v);
                  }}
                  style={styles.catRow}
                  hitSlop={6}
                >
                  <Ionicons
                    name={user ? "file-tray-full" : "bag-check"}
                    size={15}
                    color={colors.muted}
                  />
                  <Text style={[type.label, { color: colors.muted }]}>
                    {/* common.*, not a string of this screen's own: the
                        list card on the home tab says the same sentence, and
                        when only one of them was renamed the two screens
                        disagreed about what ticking an item had just done. */}
                    {t(user ? "common.addedToPantry" : "common.boughtCount", {
                      count: inCartItems.length,
                    })}
                  </Text>
                  <View
                    style={[styles.catLine, { backgroundColor: colors.line }]}
                  />
                  <Ionicons
                    name={cartOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </Pressable>

                {cartOpen &&
                  inCartItems.map((it) => (
                    <SwipeableItemRow
                      key={it.id}
                      item={it}
                    justAdded={it.id === justAdded}
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

            {grouped.map((group) => (
              <View key={group.category}>
                <View style={styles.catRow}>
                  <Text style={[type.label, { color: colors.accent }]}>
                    {categoryLabel(group.category, t)}
                  </Text>
                  <View
                    style={[styles.catLine, { backgroundColor: colors.line }]}
                  />
                </View>
                {group.items.map((it) => (
                  <SwipeableItemRow
                    key={it.id}
                    item={it}
                    justAdded={it.id === justAdded}
                    rowRef={(v) => {
                      if (v) rowRefs.current.set(it.id, v);
                      else rowRefs.current.delete(it.id);
                      // The same view the fly-to-cart animation measures also
                      // serves as the coach mark's target, for the first row.
                      if (it.id === firstOpenId) coachRef.current = v;
                    }}
                    onToggle={() => handleToggle(it)}
                    onEdit={() => openEdit(it)}
                    onDelete={() => deleteItem(list.id, it.id)}
                    // Only offer claiming when it can matter: someone else is
                    // online, or the item is already claimed. Solo shoppers see the
                    // row exactly as before.
                    claimable={
                      shoppersOnline.length > 0 || it.claimedBy != null
                    }
                    claimedByName={it.claimedBy ? nameFor(it.claimedBy) : null}
                    claimMine={
                      it.claimedBy != null && it.claimedBy === user?.id
                    }
                    onToggleClaim={() => {
                      haptics.tick();
                      setClaim(list.id, it.id, it.claimedBy == null);
                    }}
                  />
                ))}
              </View>
            ))}
            {list.items.length === 0 && (
              <Text
                style={[
                  type.sub,
                  {
                    color: colors.muted,
                    textAlign: "center",
                    marginTop: spacing.xl,
                  },
                ]}
              >
                {t("listDetail.emptyItems")}
              </Text>
            )}


          </Animated.ScrollView>

          {/* Flight layer. Outside the ScrollView so an arc is never clipped by it,
          and last in the tree so it paints above the header it flies toward. */}
          <FlyToCart ref={flightRef} onArrive={onGlyphArrive} />

          {/* Three ways in, said out loud.
              The old bar was a text field with a sparkle tucked beside it, so
              quick-add and recipe import were discoverable only if you already
              knew they were there. Naming them costs one row and makes the AI
              paths visible to somebody who has never found them.

              The manual field is revealed rather than always shown, but it stays
              open after each add and keeps focus — typing six things is still six
              types and six returns, which is the fastest path and the one this
              redesign must not slow down. */}
          {/* Solid, not frosted. A translucent bar lets rows ghost through the
              labels as they scroll under it, and this one sits over moving
              content permanently — the one place in the app where "you can
              faintly see through it" is a defect rather than a material. */}
          <View
            style={[
              styles.addBarGlass,
              { backgroundColor: colors.bg, borderTopColor: colors.glassBorder },
            ]}
          >
            <SafeAreaView edges={["bottom"]}>
              {adding && (
                /* Slides in from below and leaves the same way, so the field
                   arrives from the keyboard's direction and departs with it
                   rather than blinking out of existence. Mount and unmount are
                   the animation's own triggers — no extra state to keep in
                   step with `adding`. */
                <Animated.View
                  entering={SlideInDown.duration(200)}
                  exiting={SlideOutDown.duration(180)}
                  style={styles.addBar}
                >
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={t("listDetail.addItem")}
                    placeholderTextColor={colors.muted}
                    autoFocus
                    style={[
                      styles.input,
                      {
                        color: colors.ink,
                        backgroundColor: colors.glassFill,
                        borderColor: colors.glassBorder,
                      },
                    ]}
                    returnKeyType="done"
                    /* Submits without dismissing, so the next item is one more
                       line of typing rather than another tap on the button. */
                    blurOnSubmit={false}
                    onSubmitEditing={() => submit()}
                  />
                  <PressScale
                    onPress={() => submit(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t("listDetail.addItem")}
                    style={[
                      styles.addBtn,
                      {
                        backgroundColor: colors.accent,
                        opacity: draft.trim() ? 1 : 0.45,
                      },
                    ]}
                  >
                    <Ionicons name="add" size={24} color={colors.accentInk} />
                  </PressScale>
                  <Pressable
                    onPress={() => {
                      setAdding(false);
                      setDraft("");
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.cancel")}
                  >
                    <Ionicons name="close" size={22} color={colors.muted} />
                  </Pressable>
                </Animated.View>
              )}

              {/* The three ways in, hidden while one of them is open. Leaving
                  them under the field made the bar two rows of controls for a
                  single act of typing, and "Add item" sat there highlighted as
                  though it were still something to press. */}
              {!adding && (
                <View style={styles.actionsBar}>
                <PressScale
                  onPress={() => {
                    haptics.tick();
                    setQuickAdd(true);
                  }}
                  accessibilityRole="button"
                  style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
                >
                  <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
                  <Text
                    style={[type.sub, styles.actionText, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {t("listDetail.quickAdd")}
                  </Text>
                </PressScale>

                <PressScale
                  onPress={onImport}
                  accessibilityRole="button"
                  style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
                >
                  <Ionicons name="book-outline" size={18} color={colors.plusInk} />
                  <Text
                    style={[type.sub, styles.actionText, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {t("listDetail.importRecipe")}
                  </Text>
                </PressScale>

                <PressScale
                  onPress={() => {
                    haptics.tick();
                    if (adding) setDraft("");
                    setAdding((v) => !v);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: adding }}
                  style={[
                    styles.actionBtn,
                    { borderColor: adding ? colors.accent : colors.glassBorder },
                    adding && { backgroundColor: colors.accentSoft },
                  ]}
                >
                  <Ionicons name="add" size={18} color={colors.accent} />
                  <Text
                    style={[type.sub, styles.actionText, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {t("listDetail.addItemBtn")}
                  </Text>
                </PressScale>
                </View>
              )}
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <CoachMark
        visible={deleteCoach.visible}
        rect={deleteCoach.rect}
        textKey="coach.listDelete"
        gesture="swipeLeft"
        onDismiss={deleteCoach.dismiss}
        onSkipAll={deleteCoach.skipAll}
      />
      <ItemSheet
        listId={list.id}
        itemId={sheetItemId}
        onClose={() => setSheetItemId(null)}
      />
      <QuickAddSheet
        visible={quickAdd}
        listId={list.id}
        onClose={() => setQuickAdd(false)}
      />
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
  justAdded = false,
}: {
  /** Registered so a check-off can measure where this row currently sits. */
  rowRef?: (v: View | null) => void;
  item: Item;
  /** True for a moment after this row was typed, so it can announce itself. */
  justAdded?: boolean;
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
    "worklet";
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
      tx.value =
        next > 0 ? rubberBand(next, 0, 22) : -rubberBand(-next, DELETE_WIDTH);
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
      tx.value = springTo(
        shouldOpen ? -DELETE_WIDTH : 0,
        e.velocityX,
        SPRING.settle,
      );
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
    opacity: interpolate(
      tx.value,
      [-DELETE_WIDTH, -DELETE_WIDTH * 0.15, 0],
      [1, 0.25, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    /* collapsable={false} is load-bearing: swipeWrap carries only
       overflow:hidden, so Android flattens it away and rowRef then resolves to
       an ancestor. The coach mark measured that ancestor and spotlit the whole
       category group, starting at its header. The pantry row already had this;
       this one did not, which is exactly why only this screen stayed wrong. */
    <Animated.View
      ref={rowRef}
      collapsable={false}
      /* Only a row that has just mounted plays this, which is exactly the new
         one — every other row is already on screen and re-renders in place. */
      entering={FadeInDown.duration(220)}
      style={[
        styles.swipeWrap,
        // Held, then dropped by the parent's timer. A tint that fades on its own
        // schedule would need a second animation racing the first; letting the
        // prop go false and animating the layout is one moving part.
        justAdded && { backgroundColor: colors.accentSoft },
      ]}
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.itemRow,
            { borderBottomColor: colors.glassBorder },
            rowStyle,
          ]}
        >
          {/* No tick circle, and no strikethrough.
              Ticking lives in Start Shopping now, which is the moment it means
              something — you are standing in the shop with the trolley. Here the
              list is a document you are writing, so a row is a row: tapping it
              opens its details rather than crossing it out.

              `checked` still dims the row. A ticked item is not invisible on
              this screen, it is just visibly already handled, and hiding that
              entirely would make the count in the header unexplainable. */}
          <Pressable style={styles.grow} onPress={guard(onEdit)}>
            <View style={styles.nameRow}>
              <ItemEmoji
                name={it.name}
                category={it.category}
                dim={it.checked}
              />
              <Text
                style={[
                  type.body,
                  styles.grow,
                  { color: it.checked ? colors.muted : colors.ink },
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
                <Ionicons
                  name="leaf"
                  size={13}
                  color={colors.accent}
                  accessibilityLabel={t("eco.bioBadge")}
                />
              )}
            </View>
            {/* No amount and no store badge here.
                Both belong to the shop, not to the writing of the list: the
                quantity is what you check against the shelf and the store is
                where you are standing, so Shopping Mode shows them and this
                screen does not. It also made the rows two heights — one line for
                most items and two for the few with details — which is what a
                list of names should never be. Everything is still one tap away
                in the row's own sheet. */}
          </Pressable>

          {/* Claiming: only once a second person is around, and never on
              something already bought. */}
          {claimable && !it.checked && (
            <ClaimChip
              claimedByName={claimedByName}
              mine={claimMine}
              onPress={onToggleClaim}
            />
          )}

          <Pressable onPress={guard(onEdit)} hitSlop={8}>
            {it.priceCents != null ? (
              <Text style={[type.price, { color: colors.ink }]}>
                {money(it.priceCents)}
              </Text>
            ) : (
              <Text style={[type.price, { color: colors.muted, opacity: 0.5 }]}>
                ＋ €
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </GestureDetector>

      {/* Sits on top of the row's right edge; revealed as you swipe. */}
      <Animated.View
        style={[styles.deleteLayer, deleteStyle]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={() => {
            tx.value = withSpring(0, SPRING.settle);
            openRef.current = false;
            onDelete();
          }}
          style={[styles.deleteAction, { backgroundColor: colors.crit }]}
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <Text style={styles.deleteText}>{t("listDetail.delete")}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One figure in the basket-balance card.
 *
 * Money arrives as `cents` rather than a formatted string, so the figure can
 * count to its new value as items are checked off — which is exactly when this
 * card is being read. The third stat ("3 of 7 priced") is a sentence, not an
 * amount, so it takes `value` and stays static; the union makes passing both
 * a type error rather than a silent precedence rule.
 */
type StatProps = {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
} & ({ cents: number; value?: never } | { value: string; cents?: never });

function Stat({ label, cents, value, colors }: StatProps) {
  return (
    <View style={styles.stat}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      {cents != null ? (
        <AnimatedMoney
          value={cents}
          style={[type.body, { color: colors.ink }]}
        />
      ) : (
        <Text style={[type.body, { color: colors.ink }]}>{value}</Text>
      )}
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
    () =>
      ecoScoreFor(
        items.map((it) => ({
          name: it.name,
          category: it.category,
          bio: it.bio,
        })),
      ),
    [items],
  );
  if (eco.total < 4 || eco.score == null) return null;

  return (
    <GlassView radius={radii.md} style={styles.eco}>
      <View style={styles.ecoHead}>
        <Ionicons name="leaf-outline" size={16} color={colors.accent} />
        <Text style={[type.label, styles.grow, { color: colors.ink }]}>
          {t("eco.basketTitle")}
        </Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          {t("eco.lowShare", { percent: Math.round(eco.shares.low * 100) })}
        </Text>
        {/* A three-colour bar with no words is a rebus. The explanation is one
            tap away rather than always on, because it is worth reading once and
            then never again — and a permanent paragraph under a strip this
            small would be more explanation than thing explained. */}
        <Pressable
          onPress={() => {
            haptics.tick();
            LayoutAnimation.configureNext(
              LayoutAnimation.Presets.easeInEaseOut,
            );
            setExplained((v) => !v);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("eco.whatIsThis")}
        >
          <Ionicons
            name={
              explained ? "information-circle" : "information-circle-outline"
            }
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </View>
      <EcoBar shares={eco.shares} counts={eco.counts} compact />
      {explained && (
        <Text style={[type.sub, { color: colors.muted }]}>
          {t("eco.basketExplainer")}
        </Text>
      )}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fillTransparent: { flex: 1, backgroundColor: "transparent" },
  grow: { flex: 1, minWidth: 0 },
  scroll: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  titleBlock: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  btnLabel: { flexShrink: 1, minWidth: 0 },
  // The ghost half of the pair: same box, no fill, so it reads as the second
  // option rather than a rival to the green one.
  ghostBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  // Dimmed while the scanner does not exist. Opacity rather than a grey palette
  // so the shape stays judgeable — the point of shipping it early is to see the
  // row, not to see a placeholder.
  // flexGrow with a zero basis, not `flex`: the two halves share the width
  // rather than one claiming it all.
  primaryBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 44,
    borderRadius: radii.md,
  },
  actionsBar: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    // Extra beneath, for the home indicator and the Android gesture bar. The
    // SafeAreaView around this already adds the measured inset; this is the
    // breathing room on top of it, so the row never sits ON the bar.
    paddingBottom: spacing.md,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xs,
  },
  // Shrinkable: three labels across a 360pt phone is tight in German, and the
  // text must give way rather than push the buttons to unequal widths.
  actionText: { flexShrink: 1, minWidth: 0 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    marginHorizontal: spacing.lg,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  budget: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // The one gap that must not depend on what is above it. Equal to the budget
  // strip's own marginTop, so the spacing under the action row is identical
  // whether or not that strip rendered.
  ecoStrip: { marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  catLine: { flex: 1, height: 1 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  bagBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  bagBadgeText: { fontSize: 10, fontWeight: "800" },
  // Was marginTop alone, when this hung off the end of the groups. At the top it
  // needs to separate itself from the summary above AND from the first category
  // heading below, which used to have the whole list between them.
  cartSection: { marginTop: spacing.sm, marginBottom: spacing.md },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eco: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  ecoHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swipeWrap: { overflow: "hidden" },
  deleteLayer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_WIDTH,
    alignItems: "stretch",
    justifyContent: "center",
  },
  deleteAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginVertical: spacing.xs,
    borderRadius: radii.md,
  },
  deleteText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  addBarGlass: { borderTopWidth: StyleSheet.hairlineWidth },
  addBar: {
    flexDirection: "row",
    alignItems: "center",
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
  mic: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
