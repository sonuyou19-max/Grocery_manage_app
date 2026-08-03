import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateSheet } from '@/components/create-sheet';
import { haptics } from '@/lib/haptics';
import { useT } from '@/store/locale';
import { spacing, useTheme } from '@/theme';

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
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const t = useT();
  const [creating, setCreating] = useState(false);

  const tabWidth = (width - H_MARGIN * 2 - INNER_PAD * 2) / SLOTS;

  // Driven by the SLOT, not the route index, or the highlight would land on the
  // create button when Insights is selected and stop one place short thereafter.
  const active = useSharedValue(slotFor(state.index));
  useEffect(() => {
    active.value = withSpring(slotFor(state.index), { damping: 15, stiffness: 150, mass: 0.7 });
  }, [state.index, active]);

  // Lozenge centred under each tab's icon; slides one slot-width per step.
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: active.value * tabWidth }],
  }));
  const bubbleBase = { left: INNER_PAD + tabWidth / 2 - BUBBLE_W / 2 };

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_GAP }]} pointerEvents="box-none">
      <View style={styles.shadow}>
        <BlurView
          intensity={scheme === 'dark' ? 40 : 60}
          tint={colors.blurTint}
          experimentalBlurMethod="dimezisBlurView"
          style={[styles.pill, { borderColor: colors.glassBorder }]}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]} pointerEvents="none" />
          <View style={styles.row}>
            <Animated.View style={[styles.bubble, bubbleBase, { backgroundColor: colors.accentSoft }, bubbleStyle]} />
            {state.routes.map((route, i) => {
              // The spacer occupies the middle slot so the four real tabs keep
              // their positions; the button itself is drawn outside the pill so
              // it can overlap the top edge without being clipped by it.
              const spacer =
                slotFor(i) === CENTER_SLOT + 1 && i === CENTER_SLOT ? (
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

              return (
                <View key={route.key} style={styles.slotGroup}>
                {spacer}
                <Pressable
                  onPress={onPress}
                  style={styles.tab}
                  accessibilityRole="button"
                  accessibilityState={focused ? { selected: true } : {}}
                  accessibilityLabel={label}
                >
                  <View style={styles.iconZone}>
                    <Ionicons
                      name={focused ? activeIcon : inactiveIcon}
                      size={22}
                      color={focused ? colors.accent : colors.muted}
                    />
                  </View>
                  {/* Tab labels translate longer than English ("Settings" →
                      "Einstellungen"/"Instellingen"), which overruns a quarter
                      of the pill on narrow phones. Shrink a little before
                      falling back to truncation. */}
                  <Text
                    style={[styles.label, { color: focused ? colors.accent : colors.muted }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {label}
                  </Text>
                </Pressable>
                </View>
              );
            })}
          </View>
        </BlurView>

        {/* Outside the BlurView, which has overflow:hidden — a child would be
            cropped at the pill's edge exactly where this is meant to rise
            above it. */}
        <Pressable
          onPress={() => {
            haptics.tick();
            setCreating(true);
          }}
          style={[styles.fabWrap, { left: width / 2 - H_MARGIN - FAB_SIZE / 2 }]}
          accessibilityRole="button"
          accessibilityLabel={t('create.title')}
        >
          <LinearGradient
            colors={[colors.plusFrom, colors.plusTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fab}
          >
            <Ionicons name="add" size={28} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>

      <CreateSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: H_MARGIN, right: H_MARGIN },
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
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', paddingHorizontal: INNER_PAD },
  bubble: {
    position: 'absolute',
    top: 0,
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: BUBBLE_H / 2,
  },
  // One group per route, so the middle spacer can be emitted alongside the tab
  // that follows it without a fragment key warning.
  slotGroup: { flex: 1, flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center' },
  fabWrap: {
    position: 'absolute',
    top: -FAB_LIFT,
    width: FAB_SIZE,
    height: FAB_SIZE,
    shadowColor: '#2A1B5E',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
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
