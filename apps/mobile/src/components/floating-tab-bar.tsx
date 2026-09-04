import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Frosted } from '@/components/frosted';
import { CreateSheet } from '@/components/create-sheet';
import { SCRIM_COLOR, SHEET_CLOSE_MS, SHEET_OPEN_MS } from '@/components/sheet';
import { haptics } from '@/lib/haptics';
import { SPRING } from '@/lib/motion';
import { useT } from '@/store/locale';
import { spacing, useTheme } from '@/theme';

/**
 * What `<Tabs tabBar={…}>` hands this component, taken from `<Tabs>` itself.
 *
 * It used to be `BottomTabBarProps` from `@react-navigation/bottom-tabs`, which
 * SDK 57 stopped shipping — react-navigation is vendored inside expo-router
 * now, and its bottom-tabs types live under `expo-router/build/…`, a path no
 * package export points at.
 *
 * Reading the type off the prop that receives it is better than reaching for
 * that path anyway: this is by construction whatever the installed expo-router
 * passes, so an SDK that changes the shape becomes a type error here rather
 * than a tab bar that renders against a signature nothing has checked.
 */
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Pill dimensions, exported so screens can reserve bottom clearance for it. */
export const TAB_BAR_HEIGHT = 68;
export const TAB_BAR_GAP = 12; // float gap above the home indicator

/**
 * Five slots, four of them routes.
 *
 * The middle slot is not a tab. It is an action, and it deliberately does not
 * participate in the selected-tab machinery: it never becomes "current", the
 * highlight never travels to it, and pressing it changes nothing about where
 * you are. Everything below that maps a route index to a screen position has to
 * account for the gap, which is what `slotFor` is.
 */
const SLOTS = 5;
const CENTER_SLOT = 2;

/** Route index (0–3) to slot index (0,1,3,4). */
const slotFor = (routeIndex: number) =>
  routeIndex < CENTER_SLOT ? routeIndex : routeIndex + 1;

/** Diameter of the create button, and how far it rides above the pill. */
const FAB_SIZE = 54;
const FAB_LIFT = 16;
/**
 * Thickness of the page-coloured ring around the button.
 *
 * Four is the number that reads as a cutout rather than as a border: thin
 * enough that nobody registers it as a stroke, thick enough to separate the
 * gradient from the pill's own edge so the two do not appear welded together.
 */
const FAB_RING = 4;
const RING_SIZE = FAB_SIZE + FAB_RING * 2;

const H_MARGIN = spacing.lg;
const INNER_PAD = 6;
// The active highlight hugs the icon (a compact lozenge), not the whole column.
const BUBBLE_W = 58;
const BUBBLE_H = 36;

type IoniconName = keyof typeof Ionicons.glyphMap;

// [active (filled), inactive (outline)] per route.
const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index: ['basket', 'basket-outline'],
  pantry: ['file-tray-full', 'file-tray-full-outline'],
  insights: ['trending-up', 'trending-up-outline'],
  settings: ['settings', 'settings-outline'],
};

/**
 * Floating "water bubble" tab bar: a rounded frosted-glass pill hovering above
 * the bottom edge, with a soft highlight that springs smoothly to the active
 * tab. Mirrors the current tabs (icons + labels), just re-laid-out.
 */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const t = useT();
  const [creating, setCreating] = useState(false);

  /**
   * Measured, not computed.
   *
   * This used to be `(width - H_MARGIN * 2 - INNER_PAD * 2) / SLOTS`, which is
   * the width a slot OUGHT to be — and the bug was that it wasn't. Deriving the
   * highlight's step from an assumption about the layout means the highlight is
   * right only while the assumption holds; measuring the row means it cannot
   * disagree with what is on screen, whatever the padding or the safe area does
   * later. `width` stays a dependency so a rotation re-measures.
   */
  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth > 0 ? rowWidth / SLOTS : 0;

  // Driven by the SLOT, not the route index, or the highlight would land on the
  // create button when Insights is selected and stop one place short thereafter.
  const active = useSharedValue(slotFor(state.index));
  useEffect(() => {
    active.value = withSpring(slotFor(state.index), SPRING.snappy);
  }, [state.index, active]);

  /*
   * The tap acknowledgement: the icon you just selected swells and settles.
   *
   * One shared value for the whole bar, not one per tab. Only the focused icon
   * reads it, and focus is exclusive, so a single driver is enough — and it
   * means switching tabs cannot leave a half-finished pop on the tab you left.
   *
   * Two legs, the same shape as the bag catching an item in list/[id]: `punch`
   * swells it, `snappy` lands it back at rest. Both are presets, so the two
   * acknowledgements in the app cannot drift apart by a damping point.
   */
  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = withSequence(withSpring(1, SPRING.punch), withSpring(0, SPRING.snappy));
  }, [state.index, pop]);

  // Lozenge centred under each tab's icon; slides one slot-width per step.
  // Hidden until the row has been measured, so it cannot flash at x=0 on the
  // first frame.
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: active.value * tabWidth }],
  }));
  const bubbleBase = {
    left: tabWidth / 2 - BUBBLE_W / 2,
    opacity: tabWidth > 0 ? 1 : 0,
  };

  // 0 = plus, 1 = cross. A spring rather than a timing curve: this is a direct
  // response to a finger, and the small overshoot at the end is what makes it
  // feel like the icon turned rather than that a value was interpolated.
  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withSpring(creating ? 1 : 0, SPRING.snappy);
  }, [creating, open]);

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${open.value * 45}deg` }],
  }));

  return (
    <>
      <CreateBackdrop open={creating} />
    <View style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_GAP }]} pointerEvents="box-none">
      <View style={styles.shadow}>
        <Frosted
          over="content"
          intensity={scheme === 'dark' ? 40 : 60}
          style={[styles.pill, { borderColor: colors.glassBorder }]}
        >
          {/* The inner padding lives on the pill, not on this row, so the row's
              measured width IS the width the five slots divide up and the
              absolutely-positioned highlight below shares one unambiguous
              origin with them. Padding on the row would make both of those
              depend on how Yoga resolves an absolute child against a padded
              parent, which is not a thing this layout should rest on. */}
          <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
            <Animated.View style={[styles.bubble, bubbleBase, { backgroundColor: colors.accentSoft }, bubbleStyle]} />
            {state.routes.flatMap((route, i) => {
              /*
               * The spacer holding the middle slot open, emitted as a SIBLING of
               * the tabs rather than nested inside one.
               *
               * It used to be wrapped in a per-route group, which quietly broke
               * the whole layout: the row had four groups at flex:1, so each got
               * a quarter, and the group carrying the spacer split its quarter
               * between two children. The real slots were therefore ¼, ¼, ⅛, ⅛,
               * ¼ while every highlight calculation assumed five equal fifths.
               * That is the asymmetric pill — and the unevenly spaced icons with
               * it. flatMap keeps them siblings, so five flex:1 children are
               * five equal slots and the arithmetic is true again.
               */
              const spacer =
                i === CENTER_SLOT ? (
                  <View key="center-slot" style={styles.tab} pointerEvents="none" />
                ) : null;

              const focused = state.index === i;
              const { options } = descriptors[route.key];
              const label = typeof options.title === 'string' ? options.title : route.name;
              const [activeIcon, inactiveIcon] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];

              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              };

              return [
                spacer,
                <TabButton
                  key={route.key}
                  onPress={onPress}
                  focused={focused}
                  label={label}
                  icon={focused ? activeIcon : inactiveIcon}
                  pop={pop}
                />,
              ];
            })}
          </View>
        </Frosted>

        {/* Outside the Frosted pill, which has overflow:hidden — a child would be
            cropped at the pill's edge exactly where this is meant to rise
            above it. */}
        <Pressable
          onPress={() => {
            haptics.tick();
            setCreating((v) => !v);
          }}
          style={[
            styles.fabRing,
            {
              left: width / 2 - H_MARGIN - RING_SIZE / 2,
              // The cutout. A ring in the PAGE's colour, not the pill's, so the
              // button reads as punched through the bar rather than resting on
              // it — and on Android it does double duty, because elevation
              // draws no shadow for a view with no background to cast one.
              // That absence is why this looked flat and pasted-on.
              backgroundColor: colors.bg,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ expanded: creating }}
          accessibilityLabel={t('create.title')}
        >
          <LinearGradient
            colors={[colors.plusFrom, colors.plusTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fab}
          >
            {/* One glyph, rotated — not two glyphs swapped. A cross IS a plus
                turned an eighth of a turn, so rotating is the honest animation
                and it cannot flicker mid-transition the way a swap does. */}
            <Animated.View style={plusStyle}>
              <Ionicons name="add" size={28} color="#FFFFFF" />
            </Animated.View>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Clear the whole bar AND the button standing proud of it, plus a gap.
          The sheet used to cover both, which hid the plus-to-cross rotation it
          had just triggered — the animation played underneath its own menu. */}
      <CreateSheet
        visible={creating}
        onClose={() => setCreating(false)}
        bottomClearance={insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + FAB_LIFT + spacing.md}
      />
    </View>
    </>
  );
}

/**
 * The page dimming behind the create menu, WITHOUT dimming the bar it came from.
 *
 * ---------------------------------------------------------------------------
 * Why this cannot be Sheet's own scrim
 * ---------------------------------------------------------------------------
 *
 * Sheet has one, and every other dialog in the app uses it. It is unusable
 * here for a structural reason rather than a stylistic one: a <Modal> is its
 * own native window, stacked above the entire app, so a scrim drawn inside it
 * covers the tab bar as well. There is no z-order inside that Modal that can
 * put something from a different window underneath it.
 *
 * So the dim is drawn from the tab bar's own tree instead, as a sibling
 * BEFORE the bar. The page is below it, the bar is above it, and the menu —
 * being in the Modal — is above them both. Each of the three ends up in the
 * layer it belongs in, and the bar goes on looking exactly as it did.
 *
 * ---------------------------------------------------------------------------
 * Sizing it without a container to fill
 * ---------------------------------------------------------------------------
 *
 * React Navigation lays a custom tab bar out in a strip the height of the bar,
 * so `StyleSheet.absoluteFill` here would dim the strip and nothing else. The
 * strip does not clip — the create button already stands proud of it — so this
 * takes the window's height and grows upward from the strip's bottom edge,
 * which is the screen's.
 *
 * ---------------------------------------------------------------------------
 * It never takes a touch
 * ---------------------------------------------------------------------------
 *
 * pointerEvents none, always. The Modal's own backdrop is above this and is
 * what closes the menu, including on a tap over the cross — which is the same
 * gesture as tapping the button again and has to keep working. A dim that
 * caught touches would be a second, invisible backdrop with its own opinion
 * about what a tap outside means.
 */
function CreateBackdrop({ open }: { open: boolean }) {
  const { height } = useWindowDimensions();
  const dim = useSharedValue(0);

  useEffect(() => {
    /*
     * The same clock the sheet is on, read from sheet.tsx rather than restated.
     * Two fades a few milliseconds apart do not read as two fades; they read as
     * one fade with something wrong with it.
     */
    dim.value = open
      ? withTiming(1, { duration: SHEET_OPEN_MS, easing: Easing.out(Easing.cubic) })
      : withTiming(0, { duration: SHEET_CLOSE_MS, easing: Easing.out(Easing.quad) });
  }, [open, dim]);

  const style = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.backdrop, { height, backgroundColor: SCRIM_COLOR }, style]}
    />
  );
}

/**
 * One tab. A component rather than JSX inside the map because it owns a hook —
 * useAnimatedStyle cannot be called in a loop, and check-hooks.mjs would say so.
 */
function TabButton({
  onPress,
  focused,
  label,
  icon,
  pop,
}: {
  onPress: () => void;
  focused: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  pop: SharedValue<number>;
}) {
  const { colors } = useTheme();

  // Only the focused icon reacts. An unfocused one reads the same driver and
  // multiplies it by zero, so there is no branch on the UI thread and no way
  // for two icons to animate at once.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: focused ? 1 + pop.value * 0.18 : 1 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.iconZone, iconStyle]}>
        <Ionicons name={icon} size={22} color={focused ? colors.accent : colors.muted} />
      </Animated.View>
      {/* Tab labels translate longer than English ("Settings" →
          "Einstellungen"/"Instellingen"), which overruns a quarter of the pill
          on narrow phones. Shrink a little before falling back to truncation. */}
      <Text
        style={[styles.label, { color: focused ? colors.accent : colors.muted }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: H_MARGIN, right: H_MARGIN },
  // Anchored to the strip's bottom, which is the screen's, and given the
  // window's height so it grows up over the whole page. See CreateBackdrop.
  backdrop: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  shadow: {
    borderRadius: 30,
    shadowColor: '#08130B',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  pill: {
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: INNER_PAD,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row' },
  bubble: {
    position: 'absolute',
    top: 0,
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: BUBBLE_H / 2,
  },
  tab: { flex: 1, alignItems: 'center' },
  fabRing: {
    position: 'absolute',
    top: -FAB_LIFT,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // iOS reads the four shadow* properties; Android reads only elevation, and
    // only for a view that has a background. The ring supplies that background,
    // which is why the two effects are deliberately on the same element.
    shadowColor: '#2A1B5E',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    // Above the pill's own elevation (12), or Android would paint the bar over
    // the button regardless of tree order.
    elevation: 16,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconZone: { height: BUBBLE_H, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1, marginTop: 4 },
});
