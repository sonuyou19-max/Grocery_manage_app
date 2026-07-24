import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, useTheme } from '@/theme';

/** Pill dimensions, exported so screens can reserve bottom clearance for it. */
export const TAB_BAR_HEIGHT = 68;
export const TAB_BAR_GAP = 12; // float gap above the home indicator

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

  const count = state.routes.length;
  const tabWidth = (width - H_MARGIN * 2 - INNER_PAD * 2) / count;

  const active = useSharedValue(state.index);
  useEffect(() => {
    active.value = withSpring(state.index, { damping: 15, stiffness: 150, mass: 0.7 });
  }, [state.index, active]);

  // Lozenge centred under each tab's icon; slides one tab-width per index.
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
              const focused = state.index === i;
              const { options } = descriptors[route.key];
              const label = typeof options.title === 'string' ? options.title : route.name;
              const [activeIcon, inactiveIcon] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];

              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              };

              return (
                <Pressable
                  key={route.key}
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
              );
            })}
          </View>
        </BlurView>
      </View>
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
  tab: { flex: 1, alignItems: 'center' },
  iconZone: { height: BUBBLE_H, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1, marginTop: 4 },
});
