import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet, type ColorValue } from 'react-native';

import { useTheme } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IoniconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function TabsLayout() {
  const { colors, scheme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        // Frosted glass: transparent bar with a blurred background + hairline top.
        // Kept in normal layout flow so the FAB and scroll clearance are unaffected.
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.glassBorder,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={scheme === 'dark' ? 40 : 60}
            tint={colors.blurTint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Lists', tabBarIcon: tabIcon('basket-outline') }}
      />
      <Tabs.Screen
        name="pantry"
        options={{ title: 'Pantry', tabBarIcon: tabIcon('file-tray-full-outline') }}
      />
      <Tabs.Screen
        name="insights"
        options={{ title: 'Insights', tabBarIcon: tabIcon('trending-up-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('settings-outline') }}
      />
    </Tabs>
  );
}
