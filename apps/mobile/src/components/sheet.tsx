import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type PanGesture,
} from "react-native-gesture-handler";

import { useDeferUntilClosed } from "@/lib/modal-nav";
import { rubberBand, SPRING, springTo } from "@/lib/motion";
import { radii, spacing, useTheme } from "@/theme";

/**
 * One dialog, one motion, one way to leave it.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Eleven modals had grown four different entrances between them. Four were
 * hand-animated on the UI thread; seven used React Native's `animationType`,
 * and not even consistently — `staple-sheet` faded while `staples-sheet`, which
 * is the same idea one letter apart, slid. Stock `fade` also cross-dissolves a
 * dialog in place, which says nothing about where it came from.
 *
 * They all now scale out of the bottom of the screen and fold back into it, the
 * way the create sheet already did. It is one gesture, it is transform and
 * opacity only, and it runs on the UI thread — which after the blur episode is
 * not a stylistic preference but a budget.
 *
 * ---------------------------------------------------------------------------
 * The bug it makes structurally impossible
 * ---------------------------------------------------------------------------
 *
 * On Android a <Modal> is its own native window: push a route while one is up
 * and the new screen lands underneath it, and the user gets a blank page. That
 * has now been fixed four separate times in four features (see lib/modal-nav.ts,
 * which exists entirely because knowing about the hazard did not prevent it).
 *
 * `useDeferUntilClosed` solved it for anyone who remembered to call it, which is
 * exactly the wrong shape — and `household-switcher` proves it: it pushed
 * /auth/household straight after setOpen(false), had no deferral, and nobody
 * noticed because it was never added to the guard's list.
 *
 * So the deferral moves inside the thing that owns the Modal. A child calls
 * `useSheetDismiss()` and gets one function that closes the sheet AND runs the
 * follow-up once the window is really gone. There is no shorter way to write it
 * and no way to express "navigate now" at all, which is the only kind of fix
 * that has held.
 */

interface SheetApi {
  /**
   * Close the sheet, then run `action` — if given — once the native window has
   * actually gone. Navigation and paywalls MUST go through this; see above.
   */
  dismiss: (action?: () => void) => void;
  /** The pull-down gesture, for sheets that slide. Null for the others. */
  drag: PanGesture | null;
}

const Ctx = createContext<SheetApi | null>(null);

/** The dismiss/navigate function for the <Sheet> you are inside. */
export function useSheetDismiss(): SheetApi["dismiss"] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSheetDismiss must be used within a <Sheet>");
  return ctx.dismiss;
}

/**
 * The grab handle for a sliding sheet, with pull-to-dismiss already on it.
 *
 * Offered as a component rather than a raw gesture because WHERE the gesture
 * goes is the whole difficulty. It cannot go on the card: every one of these
 * sheets has a ScrollView in it, and a Pan covering the card fights the scroll
 * for the same downward drag. Bound to the handle — a strip nobody scrolls —
 * both work, which is exactly what item-sheet already did by hand.
 *
 * Renders the bar alone when the sheet is not a sliding one, so a child can use
 * it unconditionally.
 */
export function SheetHandle() {
  const ctx = useContext(Ctx);
  const { colors } = useTheme();
  const bar = (
    // A generous target around a small bar: the visible 36x4 is far under the
    // 44dp minimum, and a handle you have to hit precisely is one users decide
    // is decorative — which is what was reported.
    <View style={styles.handleZone} collapsable={false}>
      <View style={[styles.grabber, { backgroundColor: colors.line }]} />
    </View>
  );
  if (!ctx?.drag) return bar;
  return <GestureDetector gesture={ctx.drag}>{bar}</GestureDetector>;
}

/** Long enough to read as a movement, short enough not to sit in the way. */
const OPEN_MS = 220;
const CLOSE_MS = 160;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Where the card sits. `end` is a bottom sheet; `center` is a dialog or a
   * menu. Both use the same motion — only the resting position differs — so a
   * menu and a sheet feel like the same app.
   */
  align?: "end" | "center";
  /**
   * Extra room under the card, in px. The create sheet passes the tab bar's
   * height so it clears the button it grew out of.
   *
   * PADDING on the backdrop, never margin on the card: margin counts toward the
   * card's own tap-blocking wrapper, whose touch area would then cover the
   * cleared strip and swallow every tap meant for the button under it. That was
   * a dead close button for a whole release.
   */
  bottomClearance?: number;
  /** Lift above the keyboard. For sheets containing a text field. */
  avoidKeyboard?: boolean;
  /**
   * Darken the page behind. Per-sheet rather than global, because the two cases
   * genuinely differ: a dialog demanding a decision wants the page pushed back,
   * while the create menu must NOT dim the button it grew out of — dimming the
   * thing you just pressed reads as the app going away rather than the menu
   * arriving. Each call site keeps whatever it had.
   */
  scrim?: boolean;
  /**
   * Inset around the card. Zero for a sheet that meets the screen edges.
   */
  gutter?: number;
  /** Style for the card wrapper, e.g. a max width on a wide menu. */
  cardStyle?: ViewStyle;
  /**
   * How it arrives.
   *
   * `scale` (default) is the fold-out-of-the-bottom described above, and is
   * what every dialog and menu here uses.
   *
   * `slide` travels up from off-screen on a clamped spring with the scrim
   * fading in lockstep — the motion components/item-sheet.tsx already had, and
   * never gave up when the other ten modals were consolidated. That is the
   * reason this option exists rather than a second copy of it: a full-height
   * bottom sheet that meets the screen edge reads as coming FROM the edge, and
   * scaling one out of nothing reads as a dialog wearing a sheet's shape. Two
   * bottom sheets in the same app arriving two different ways is what a user
   * noticed and reported.
   *
   * Use it for sheets that sit flush to the bottom. Leave it alone for
   * anything centred: a dialog has no edge to travel from.
   */
  motion?: "scale" | "slide";
  children: ReactNode;
}

export function Sheet({
  visible,
  onClose,
  align = "end",
  bottomClearance,
  avoidKeyboard = false,
  scrim = false,
  gutter = spacing.lg,
  cardStyle,
  motion = "scale",
  children,
}: SheetProps) {
  /*
   * The Modal has to outlive `visible` so the closing animation has something
   * to play on — RN would otherwise tear the window down on the same frame the
   * prop flips and the fold-away would never be seen. `mounted` is therefore
   * driven up by the prop and down by the animation's own completion.
   */
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  // `slide` travels this value from screenH to 0 instead. Kept as its own
  // shared value rather than reusing `progress` because the scrim reads it in
  // pixels — the fade has to finish while the sheet is still well clear of its
  // resting place, or the last of the dim lands after the sheet has stopped.
  const { height: screenH } = useWindowDimensions();
  const sheetY = useSharedValue(screenH);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (motion === "slide") {
        cancelAnimation(sheetY);
        sheetY.value = withSpring(0, SPRING.sheet);
      } else {
        progress.value = withTiming(1, {
          duration: OPEN_MS,
          easing: Easing.out(Easing.cubic),
        });
      }
    } else if (motion === "slide") {
      cancelAnimation(sheetY);
      sheetY.value = withSpring(screenH, SPRING.sheet, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
        (done) => {
          if (done) runOnJS(setMounted)(false);
        },
      );
    }
  }, [visible, progress, sheetY, motion, screenH]);

  const cardAnim = useAnimatedStyle(() =>
    motion === "slide"
      ? { transform: [{ translateY: sheetY.value }] }
      : {
          opacity: progress.value,
          // 0.82, not 0: shrinking to nothing reads as a card being destroyed.
          // A shallow scale reads as one folding away, which is the thing
          // being said.
          transform: [{ scale: 0.82 + progress.value * 0.18 }],
        },
  );

  // Only used by `slide`. The scale motion keeps its scrim as a flat background
  // colour on the backdrop, exactly as before — this is deliberately not a
  // behaviour change for the ten modals that did not ask for one.
  const scrimAnim = useAnimatedStyle(() => ({
    opacity: interpolate(
      sheetY.value,
      [0, screenH * 0.7],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  // Keyed on `mounted`, the Modal's real visibility — not on `visible`, which
  // goes false a whole exit animation before the window is gone.
  const whenClosed = useDeferUntilClosed(mounted);

  const dismiss = useCallback(
    (action?: () => void) => {
      if (action) whenClosed(action);
      onClose();
    },
    [whenClosed, onClose],
  );

  /*
   * Pull down to dismiss, for sliding sheets.
   *
   * Past 110px of travel, or thrown faster than 800px/s, it goes; otherwise it
   * springs back carrying the release velocity, so letting go mid-drag
   * continues the motion rather than restarting it. The numbers are
   * item-sheet's, deliberately — that sheet is the one users have learned the
   * feel of, and two bottom sheets with different dismiss thresholds is the
   * same inconsistency in a subtler form.
   *
   * Dismissing just flips `visible`; the effect above then springs from
   * wherever the finger left the sheet down to screenH, so the hand-off is
   * continuous without the gesture needing to own the exit.
   */
  const drag = useMemo(
    () =>
      Gesture.Pan()
        // Only after a deliberate downward move, so a tap on the handle is
        // still a tap and a horizontal swipe is left alone.
        .activeOffsetY(8)
        .onUpdate((e) => {
          // Down tracks the finger exactly; up rubber-bands, so dragging a
          // sheet that is already fully open pushes back instead of nothing
          // happening.
          sheetY.value =
            e.translationY >= 0
              ? e.translationY
              : -rubberBand(-e.translationY, 0, 44);
        })
        .onEnd((e) => {
          if (sheetY.value > 110 || e.velocityY > 800) {
            runOnJS(onClose)();
          } else {
            sheetY.value = springTo(0, e.velocityY, SPRING.sheet);
          }
        }),
    [sheetY, onClose],
  );

  const api = useMemo<SheetApi>(
    () => ({ dismiss, drag: motion === "slide" ? drag : null }),
    [dismiss, drag, motion],
  );

  const body = (
    <Pressable
      style={[
        styles.backdrop,
        { padding: gutter },
        scrim && motion !== "slide" ? styles.scrim : null,
        align === "center" ? styles.center : styles.end,
        bottomClearance != null ? { paddingBottom: bottomClearance } : null,
      ]}
      onPress={onClose}
    >
      {/* The sliding scrim is its own layer rather than a colour on the
          backdrop, because it has to fade and the backdrop must not: this
          Pressable is what catches a tap outside the card, and animating the
          view that owns the touch target is how that stops being reliable.
          pointerEvents none for the same reason — it sits over the backdrop
          and would otherwise be the thing tapped. */}
      {scrim && motion === "slide" && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.scrim, scrimAnim]}
        />
      )}

      {/* Stops a tap on the card itself from closing it. Wraps the card and
          nothing else — anything that ADDS layout in here (padding, margin,
          a minimum size) eats the backdrop's taps, which is what once left a
          close button dead for a whole release.

          What it does carry is the opposite of that: constraints that can only
          ever make it smaller. Without them this Pressable is the break in the
          chain — a flex item at RN's default `flexShrink: 0`, with no definite
          height for a child's `maxHeight: '80%'` to resolve against. So a sheet
          whose content outgrows the screen cannot shrink and its ScrollView
          never becomes scrollable; it just runs off the edge. */}
      <Pressable onPress={() => {}} style={styles.cardWrap}>
        <Animated.View
          style={[
            styles.card,
            align === "center" ? styles.originCenter : styles.originEnd,
            cardStyle,
            cardAnim,
          ]}
        >
          {children}
        </Animated.View>
      </Pressable>
    </Pressable>
  );

  return (
    <Ctx.Provider value={api}>
      <Modal
        visible={mounted}
        transparent
        // "none": the scale/fade above IS the transition. RN's own would run
        // underneath it and the two would fight.
        animationType="none"
        onRequestClose={onClose}
      >
        {/* Gesture handler needs its own root INSIDE the Modal, and this one
            line is why no sheet in this app could be swiped away.

            Read RNGestureHandlerRootView.kt: touches reach the gesture system
            through that view's dispatchTouchEvent, and it walks UP looking for
            an existing one — stopping the moment it meets any RootView. A
            Modal's content hangs off ReactModalHostView.DialogRootViewGroup,
            its own window root, so the walk stops there and never sees the one
            at the app root in _layout.tsx. RNGH's own comment on that check
            names modals as the reason it exists.

            So every Pan inside every Modal here was inert. item-sheet had a
            fully written pull-to-dismiss that had never once run, which is
            precisely the report: the handle is purely visual. */}
        <GestureHandlerRootView style={styles.fill}>
          {avoidKeyboard ? (
            <KeyboardAvoidingView behavior="padding" style={styles.fill}>
              {body}
            </KeyboardAvoidingView>
          ) : (
            body
          )}
        </GestureHandlerRootView>
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // 44dp of grabbable height around a 4dp bar. The bar is the affordance; the
  // zone is what makes it work with a thumb.
  handleZone: {
    height: 28,
    paddingTop: spacing.sm,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  grabber: { width: 36, height: 4, borderRadius: radii.pill },
  backdrop: { flex: 1 },
  scrim: { backgroundColor: "rgba(12,18,10,0.45)" },
  end: { justifyContent: "flex-end" },
  /*
   * `stretch` is what the wrapper already did implicitly (the backdrop's
   * alignItems defaults to stretch), stated so the rest is obviously additive.
   * `maxHeight: 100%` gives the chain a definite bound to resolve percentages
   * against, and `flexShrink: 1` lets that bound actually squeeze the card
   * rather than being ignored. Neither can enlarge the touch area.
   */
  cardWrap: { alignSelf: "stretch", maxHeight: "100%", flexShrink: 1 },
  // Same reason, one level down: the constraint has to reach the card's own
  // content or the ScrollView inside it never learns it has a ceiling.
  card: { flexShrink: 1 },
  center: { justifyContent: "center" },
  // Scaling out of the bottom edge, which is where the sheet came from.
  originEnd: { transformOrigin: "center bottom" },
  // A centred dialog has no edge to grow from, so it grows about itself.
  originCenter: { transformOrigin: "center center" },
});
