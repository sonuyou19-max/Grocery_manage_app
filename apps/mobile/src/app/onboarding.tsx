import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ComponentProps, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { MeshBackground } from '@/components/mesh-background';
import { haptics } from '@/lib/haptics';
import { markOnboardingSeen } from '@/lib/onboarding';
import { radii, spacing, type, useTheme } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Slide {
  icon: IconName;
  title: string;
  body: string;
}

/** The feature tour — one card per thing that makes Korb worth opening. */
const SLIDES: Slide[] = [
  {
    icon: 'basket-outline',
    title: 'Welcome to Korb',
    body: 'Your grocery list — minus the paper. Quick to add, organised on its own, and shared with everyone at home.',
  },
  {
    icon: 'sparkles-outline',
    title: 'Add it your way',
    body: 'Jot “milk, eggs, 2 avocados” in one go and Korb sorts each item by aisle and store for you.',
  },
  {
    icon: 'people-outline',
    title: 'One list, everyone in sync',
    body: 'Share a household and your lists update live on every phone. Whoever grabs the milk, everyone sees it.',
  },
  {
    icon: 'pulse-outline',
    title: 'Pantry Vibe Check',
    body: 'Korb learns how fast you run out of things and gives you a 10-second swipe to restock — before you’re caught short.',
  },
  {
    icon: 'stats-chart-outline',
    title: 'Insights that get you',
    body: 'See your basket balance, your staples, and a warm weekly recap of how you actually shop.',
  },
];

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const finish = () => {
    void markOnboardingSeen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  };

  const onNext = () => {
    if (isLast) {
      haptics.snap();
      finish();
      return;
    }
    haptics.tick();
    goTo(index + 1);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) {
      setIndex(next);
      haptics.tick();
    }
  };

  return (
    <View style={styles.root}>
      <MeshBackground />

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        {!isLast ? (
          <Pressable onPress={finish} hitSlop={12} style={styles.skip}>
            <Text style={[type.body, { color: colors.muted }]}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.skip} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <GlassView accented radius={radii.pill} style={styles.iconWrap}>
              <Ionicons name={slide.icon} size={52} color={colors.accent} />
            </GlassView>
            <Text style={[type.display, styles.title, { color: colors.ink }]}>{slide.title}</Text>
            <Text style={[type.bodyRegular, styles.body, { color: colors.muted }]}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.title}
              style={[
                styles.dot,
                i === index
                  ? { width: 22, backgroundColor: colors.accent }
                  : { width: 7, backgroundColor: colors.line },
              ]}
            />
          ))}
        </View>

        <Pressable
          onPress={onNext}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[type.body, { color: colors.accentInk }]}>
            {isLast ? 'Get started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, alignItems: 'flex-end' },
  skip: { minHeight: 24, justifyContent: 'center' },
  pager: { flex: 1 },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  iconWrap: {
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 24, maxWidth: 320 },
  footer: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs },
  dot: { height: 7, borderRadius: radii.pill },
  button: {
    height: 54,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
