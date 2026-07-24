import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { ListPickerSheet } from '@/components/list-picker-sheet';
import { Screen } from '@/components/screen';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { CATEGORY_LABELS, categorizeSync } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import {
  dueAt,
  lastBoughtLabel,
  lifeRemaining,
  normalizeKey,
  statusLabel,
  type ItemStat,
} from '@/lib/pantry-intel';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

// Enable the smooth expand/collapse animation on Android too.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** An item is "running low" once less than this fraction of its lifespan is left. */
const LOW_THRESHOLD = 0.35;

type Colors = ReturnType<typeof useTheme>['colors'];

/**
 * Pantry: the honest view of what Korb is tracking. Every item you check off a
 * list is learned here with a real burn-rate — the bar shows how much of its
 * usual lifespan is left. Swipe a row to snooze a prediction ("Still good", no
 * hard delete) or send it to a shopping list. A search bar keeps it usable as
 * the list grows, and items split into "Running low" (open by default) and "In
 * stock" (collapsed). "Track item" seeds a staple manually (bought now).
 */
export default function PantryScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { stats, logPurchase, markAlmostOut, markStillGood } = usePantryIntel();
  const { lists, addParsedItem } = useGroceries();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [lowOpen, setLowOpen] = useState(true);
  const [stockOpen, setStockOpen] = useState(false);
  // The item awaiting a list-picker choice (null when the picker is closed).
  const [pendingAdd, setPendingAdd] = useState<ItemStat | null>(null);

  const now = Date.now();
  const items = useMemo(
    () => Object.values(stats).sort((a, b) => dueAt(a) - dueAt(b)),
    [stats],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const { low, stocked } = useMemo(() => {
    const matches = (s: ItemStat) => !q || s.display.toLowerCase().includes(q);
    const low: ItemStat[] = [];
    const stocked: ItemStat[] = [];
    for (const s of items) {
      if (!matches(s)) continue;
      (lifeRemaining(s, now) < LOW_THRESHOLD ? low : stocked).push(s);
    }
    return { low, stocked };
  }, [items, q, now]);

  // While searching, force both sections open so a match is never hidden.
  const lowExpanded = searching ? true : lowOpen;
  const stockExpanded = searching ? true : stockOpen;

  const toggle = (which: 'low' | 'stock') => {
    if (searching) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    haptics.tick();
    if (which === 'low') setLowOpen((v) => !v);
    else setStockOpen((v) => !v);
  };

  // Swipe right: the item's fine — teach the model to wait longer (no delete).
  const onStillGood = (item: ItemStat) => {
    markStillGood(item.key);
    haptics.tick();
  };

  // Swipe left: choose a list, then add the item and mark it almost-out.
  const onAddToList = (item: ItemStat) => {
    haptics.snap();
    setPendingAdd(item);
  };

  const pickList = (listId: string) => {
    const item = pendingAdd;
    setPendingAdd(null);
    if (!item) return;
    const target = lists.find((l) => l.id === listId);
    const already = target?.items.some((it) => normalizeKey(it.name) === item.key);
    if (!already) {
      addParsedItem(listId, {
        name: item.display,
        category: item.category,
        quantity: null,
        unit: null,
      });
    }
    markAlmostOut(item.key);
    haptics.success();
  };

  const renderRows = (rows: ItemStat[]) => (
    <View style={styles.rowStack}>
      {rows.map((item) => (
        <PantrySwipeRow
          key={item.key}
          item={item}
          now={now}
          colors={colors}
          onStillGood={() => onStillGood(item)}
          onAddToList={() => onAddToList(item)}
        />
      ))}
    </View>
  );

  const SectionHeader = ({
    title,
    tone,
    count,
    expanded,
    onPress,
  }: {
    title: string;
    tone: string;
    count: number;
    expanded: boolean;
    onPress: () => void;
  }) => (
    <Pressable onPress={onPress} style={styles.sectionHead} hitSlop={6}>
      <Text style={[type.label, { color: tone }]}>{title}</Text>
      <View style={[styles.countPill, { backgroundColor: colors.line }]}>
        <Text style={[type.sub, { color: colors.muted, fontWeight: '700' }]}>{count}</Text>
      </View>
      <View style={styles.grow} />
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
    </Pressable>
  );

  const lowCount = items.filter((s) => lifeRemaining(s, now) < LOW_THRESHOLD).length;

  return (
    <>
      <Screen
        title={t('tabs.pantry')}
        subtitle={
          items.length === 0
            ? t('pantry.subtitleEmpty')
            : t('pantry.subtitleTracked', { count: items.length, low: lowCount })
        }
        hasFab
      >
        {items.length === 0 ? (
          <EmptyState
            icon="file-tray-full-outline"
            title={t('pantry.emptyTitle')}
            body={t('pantry.emptyBody')}
          />
        ) : (
          <>
            {/* Search — keeps the pantry usable as it grows. */}
            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('pantry.search')}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.ink }]}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {!searching && (
              <Text style={[type.sub, { color: colors.muted }]}>{t('pantry.swipeHint')}</Text>
            )}

            {searching && low.length === 0 && stocked.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title={t('pantry.noMatchesTitle')}
                body={t('pantry.noMatchesBody', { query: query.trim() })}
              />
            ) : (
              <>
                {/* Running low — expanded by default. Hidden while searching if empty. */}
                {(!searching || low.length > 0) && (
                  <View style={styles.section}>
                    <SectionHeader
                      title={t('pantry.runningLow')}
                      tone={colors.warn}
                      count={low.length}
                      expanded={lowExpanded}
                      onPress={() => toggle('low')}
                    />
                    {lowExpanded &&
                      (low.length > 0 ? (
                        renderRows(low)
                      ) : (
                        <Text style={[type.sub, { color: colors.muted, paddingVertical: spacing.sm }]}>
                          {t('pantry.nothingLow')}
                        </Text>
                      ))}
                  </View>
                )}

                {/* In stock — collapsed by default. */}
                {(!searching || stocked.length > 0) && (
                  <View style={styles.section}>
                    <SectionHeader
                      title={t('pantry.inStock')}
                      tone={colors.muted}
                      count={stocked.length}
                      expanded={stockExpanded}
                      onPress={() => toggle('stock')}
                    />
                    {stockExpanded &&
                      (stocked.length > 0 ? (
                        renderRows(stocked)
                      ) : (
                        <Text style={[type.sub, { color: colors.muted, paddingVertical: spacing.sm }]}>
                          {t('pantry.nothingHere')}
                        </Text>
                      ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </Screen>

      <Fab label={t('pantry.track')} onPress={() => setAdding(true)} />
      <TextPromptModal
        visible={adding}
        title={t('pantry.trackTitle')}
        placeholder={t('pantry.trackPlaceholder')}
        confirmLabel={t('pantry.trackConfirm')}
        onCancel={() => setAdding(false)}
        onSubmit={(name) => {
          const clean = name.trim();
          if (clean) logPurchase(clean, categorizeSync(clean));
          setAdding(false);
        }}
      />
      <ListPickerSheet
        visible={pendingAdd != null}
        title={pendingAdd ? t('pantry.addTo', { item: pendingAdd.display }) : t('pantry.addToList')}
        onCancel={() => setPendingAdd(null)}
        onPick={pickList}
      />
    </>
  );
}

/** How far (px) you must swipe a row before releasing fires its action. */
const ACTION_THRESHOLD = 80;
const MAX_TRAVEL = 130;

/**
 * One pantry row with a two-way swipe: right reveals "Still good" (snooze the
 * prediction — never a delete), left reveals "Add to list". Releasing past the
 * threshold fires that action and springs the row back; the item then moves
 * between sections on its own as its status changes. The gesture only engages
 * on a clear horizontal drag and yields to the vertical scroll (failOffsetY).
 */
function PantrySwipeRow({
  item,
  now,
  colors,
  onStillGood,
  onAddToList,
}: {
  item: ItemStat;
  now: number;
  colors: Colors;
  onStillGood: () => void;
  onAddToList: () => void;
}) {
  const t = useT();
  const tx = useSharedValue(0);
  const armed = useSharedValue(0); // -1/0/1: which side is past threshold (for haptic)
  const settle = { duration: 260, easing: Easing.out(Easing.cubic) };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      tx.value = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, e.translationX));
      const dir = tx.value > ACTION_THRESHOLD ? 1 : tx.value < -ACTION_THRESHOLD ? -1 : 0;
      if (dir !== armed.value) {
        armed.value = dir;
        if (dir !== 0) runOnJS(haptics.snap)();
      }
    })
    .onEnd(() => {
      if (tx.value > ACTION_THRESHOLD) runOnJS(onStillGood)();
      else if (tx.value < -ACTION_THRESHOLD) runOnJS(onAddToList)();
      tx.value = withTiming(0, settle);
      armed.value = 0;
    });

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const leftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, ACTION_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-ACTION_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const left = lifeRemaining(item, now);
  const barColor =
    left < 0.15 ? colors.crit : left < LOW_THRESHOLD ? colors.warn : colors.accent;

  return (
    <View style={styles.swipeWrap}>
      {/* Revealed behind the row; only the swiped side fades in. */}
      <Animated.View style={[styles.actionPanel, styles.actionLeft, { backgroundColor: colors.warn }, leftStyle]}>
        <Ionicons name="time-outline" size={20} color="#FFFFFF" />
        <Text style={styles.actionText}>{t('pantry.stillGood')}</Text>
      </Animated.View>
      <Animated.View style={[styles.actionPanel, styles.actionRight, { backgroundColor: colors.accent }, rightStyle]}>
        <Text style={styles.actionText}>{t('pantry.addToList')}</Text>
        <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.rowContent, { backgroundColor: colors.surface }, contentStyle]}>
          <View style={styles.grow}>
            <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
              {item.display}
            </Text>
            <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
              {CATEGORY_LABELS[item.category]} · {lastBoughtLabel(item.lastPurchasedAt, now)}
            </Text>
          </View>
          <View style={styles.stock}>
            <View style={[styles.bar, { backgroundColor: colors.line }]}>
              <View style={[styles.fill, { width: `${Math.max(left, 0.02) * 100}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={[type.sub, { color: left < LOW_THRESHOLD ? barColor : colors.muted }]}>
              {statusLabel(item, now)}
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 16, padding: 0 },
  section: { gap: spacing.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  countPill: {
    minWidth: 22,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowStack: { gap: spacing.sm },
  swipeWrap: { borderRadius: radii.md, overflow: 'hidden' },
  actionPanel: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  actionLeft: { justifyContent: 'flex-start' },
  actionRight: { justifyContent: 'flex-end' },
  actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  grow: { flex: 1, minWidth: 0 },
  stock: { width: 104, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
