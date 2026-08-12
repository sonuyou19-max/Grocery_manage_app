import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Modal, Pressable, StyleSheet, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { useDeferUntilClosed } from "@/lib/modal-nav";
import { spacing } from "@/theme";

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
}

const Ctx = createContext<SheetApi | null>(null);

/** The dismiss/navigate function for the <Sheet> you are inside. */
export function useSheetDismiss(): SheetApi["dismiss"] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSheetDismiss must be used within a <Sheet>");
  return ctx.dismiss;
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

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
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
  }, [visible, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    // 0.82, not 0: shrinking to nothing reads as a card being destroyed. A
    // shallow scale reads as one folding away, which is the thing being said.
    transform: [{ scale: 0.82 + progress.value * 0.18 }],
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

  const body = (
    <Pressable
      style={[
        styles.backdrop,
        { padding: gutter },
        scrim ? styles.scrim : null,
        align === "center" ? styles.center : styles.end,
        bottomClearance != null ? { paddingBottom: bottomClearance } : null,
      ]}
      onPress={onClose}
    >
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
    <Ctx.Provider value={{ dismiss }}>
      <Modal
        visible={mounted}
        transparent
        // "none": the scale/fade above IS the transition. RN's own would run
        // underneath it and the two would fight.
        animationType="none"
        onRequestClose={onClose}
      >
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior="padding" style={styles.fill}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
