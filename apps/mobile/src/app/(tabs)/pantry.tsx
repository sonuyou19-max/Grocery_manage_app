import { Ionicons } from '@expo/vector-icons';
import type { ItemCategory } from '@korb/shared';
import { useCallback, useMemo, useState } from 'react';
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
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { ItemEmoji } from '@/components/item-emoji';
import { ListPickerSheet } from '@/components/list-picker-sheet';
import { PantryTeaser } from '@/components/pantry-teaser';
import { PurchaseLedger } from '@/components/purchase-ledger';
import { Screen } from '@/components/screen';
import { StapleSheet } from '@/components/staple-sheet';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { useToast } from '@/components/toast';
import { categorizeSync, categoryLabel } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { rubberBand, springTo } from '@/lib/motion';
import {
  dueAt,
  hasUserCadence,
  isResting,
  lastBoughtLabel,
  lifeRemaining,
  normalizeKey,
  statusLabel,
  type ItemStat,
} from '@/lib/pantry-intel';
import { useHomeListAdd } from '@/lib/use-home-list-add';
import { useAuth } from '@/store/auth';
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
/**
 * The gate. Signed out, the whole tab is a teaser.
 *
 * Two components rather than an early return, for the same reason as Insights:
 * the screen below is full of useMemo and a conditional return above them would
 * change the hook count between renders, so React throws the moment a guest
 * signs in — which is exactly the transition this exists to cause.
 */
export default function PantryScreen() {
  const { user } = useAuth();
  if (!user) return <PantryTeaser />;
  return <SignedInPantry />;
}

function SignedInPantry() {
  const { colors } = useTheme();
  const t = useT();
  const { stats, purchases, logPurchase, markAlmostOut, markStillGood, setStaple, setResting } =
    usePantryIntel();
  const { addToHomeList, addToChosenList } = useHomeListAdd();
  const { lists } = useGroceries();
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [lowOpen, setLowOpen] = useState(true);
  const [stockOpen, setStockOpen] = useState(false);
  // The item awaiting a list-picker choice (null when the picker is closed).
  const [pendingAdd, setPendingAdd] = useState<ItemStat | null>(null);
  // The item whose restock settings are open. Held by key, not by value, so the
  // sheet re-reads from `stats` and reflects each change as it's made.
  const [stapleKey, setStapleKey] = useState<string | null>(null);
  const [restOpen, setRestOpen] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<{ name: string; category: ItemCategory } | null>(null);

  const now = Date.now();
  // Resting items are split off before anything else: every count, section and
  // prediction on this screen is about what Korb is actively tracking.
  const { items, resting } = useMemo(() => {
    const all = Object.values(stats);
    return {
      items: all.filter((s) => !isResting(s)).sort((a, b) => dueAt(a) - dueAt(b)),
      resting: all
        .filter(isResting)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    };
  }, [stats]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Anything sitting unticked on a shopping list is, by the user's own hand,
  // running low — that's what putting it on the list *means*. Deriving it from
  // the lists rather than storing a flag means every add path agrees for free
  // (pantry swipe, Vibe Check, typing it straight onto a list), and it clears
  // itself the moment the item is ticked off.
  const queued = useMemo(() => {
    const keys = new Set<string>();
    for (const l of lists) {
      for (const it of l.items) if (!it.checked) keys.add(normalizeKey(it.name));
    }
    return keys;
  }, [lists]);

  const isLow = useCallback(
    (s: ItemStat) => queued.has(s.key) || lifeRemaining(s, now) < LOW_THRESHOLD,
    [queued, now],
  );

  const { low, stocked } = useMemo(() => {
    const matches = (s: ItemStat) => !q || s.display.toLowerCase().includes(q);
    const low: ItemStat[] = [];
    const stocked: ItemStat[] = [];
    for (const s of items) {
      if (!matches(s)) continue;
      (isLow(s) ? low : stocked).push(s);
    }
    return { low, stocked };
  }, [items, q, isLow]);

  const restingMatches = useMemo(
    () => (q ? resting.filter((s) => s.display.toLowerCase().includes(q)) : resting),
    [resting, q],
  );

  // While searching, force every section open so a match is never hidden —
  // including Resting, which is exactly where you look for "where did that go?".
  const lowExpanded = searching ? true : lowOpen;
  const stockExpanded = searching ? true : stockOpen;
  const restExpanded = searching ? true : restOpen;

  const toggle = (which: 'low' | 'stock' | 'rest') => {
    if (searching) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    haptics.tick();
    if (which === 'low') setLowOpen((v) => !v);
    else if (which === 'stock') setStockOpen((v) => !v);
    else setRestOpen((v) => !v);
  };

  // Let it rest: retire the item from every prediction, keeping its history.
  const onRest = (item: ItemStat) => {
    setStapleKey(null);
    setResting(item.key, true);
    haptics.success();
    showToast(t('rest.toastResting', { item: item.display }));
  };

  const onWake = (item: ItemStat) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setResting(item.key, false);
    haptics.success();
    showToast(t('rest.toastAwake', { item: item.display }));
  };

  // Swipe right: the item's fine — teach the model to wait longer (no delete).
  const onStillGood = (item: ItemStat) => {
    markStillGood(item.key);
    haptics.tick();
  };

  // Swipe left: send the item back to its home list without interrupting. Only
  // when it has no usable home do we ask which list.
  const onAddToList = (item: ItemStat) => {
    haptics.snap();
    if (addToHomeList(item.display, item.category)) {
      markAlmostOut(item.key);
      haptics.success();
      return;
    }
    setPendingAdd(item);
  };

  const pickList = (listId: string) => {
    const item = pendingAdd;
    setPendingAdd(null);
    if (!item) return;
    addToChosenList(listId, item.display, item.category);
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
          queued={queued.has(item.key)}
          colors={colors}
          onStillGood={() => onStillGood(item)}
          onAddToList={() => onAddToList(item)}
          onOpen={() => {
            haptics.tick();
            setStapleKey(item.key);
          }}
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

  const lowCount = items.filter(isLow).length;

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
        {items.length === 0 && resting.length === 0 ? (
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

            {!searching && <SwipeLegend colors={colors} />}

            {searching && low.length === 0 && stocked.length === 0 && restingMatches.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title={t('pantry.noMatchesTitle')}
                body={t('pantry.noMatchesBody', { query: query.trim() })}
              />
            ) : (
              <>
                {/* Everything is resting: say so rather than showing two empty
                    sections above a shelf the user can actually act on. */}
                {items.length === 0 && !searching && (
                  <EmptyState
                    icon="moon-outline"
                    title={t('rest.allRestingTitle')}
                    body={t('rest.allRestingBody')}
                  />
                )}

                {/* Running low — expanded by default. Hidden while searching if empty. */}
                {items.length > 0 && (!searching || low.length > 0) && (
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
                {items.length > 0 && (!searching || stocked.length > 0) && (
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

                {/* Resting — the quiet shelf. Only appears once something is on
                    it, so it never adds noise for people who don't use it. */}
                {restingMatches.length > 0 && (
                  <View style={styles.section}>
                    <SectionHeader
                      title={t('rest.section')}
                      tone={colors.muted}
                      count={restingMatches.length}
                      expanded={restExpanded}
                      onPress={() => toggle('rest')}
                    />
                    {restExpanded && (
                      <View style={styles.rowStack}>
                        <Text style={[type.sub, { color: colors.muted }]}>
                          {t('rest.sectionHint')}
                        </Text>
                        {restingMatches.map((item) => (
                          <RestingRow
                            key={item.key}
                            item={item}
                            now={now}
                            colors={colors}
                            onWake={() => onWake(item)}
                          />
                        ))}
                      </View>
                    )}
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
      <StapleSheet
        item={stapleKey ? stats[stapleKey] ?? null : null}
        onClose={() => setStapleKey(null)}
        onChange={(patch) => {
          if (stapleKey) setStaple(stapleKey, patch);
        }}
        onRest={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (item) onRest(item);
        }}
        purchases={purchases}
        onOpenHistory={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          // Close the settings sheet first: two stacked modals on Android leave
          // the lower one visible through the upper's backdrop.
          setStapleKey(null);
          setLedgerFor({ name: item.display, category: item.category });
        }}
      />

      <PurchaseLedger
        name={ledgerFor?.name ?? null}
        category={ledgerFor?.category ?? 'other'}
        purchases={purchases}
        onClose={() => setLedgerFor(null)}
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

/**
 * What the two swipe directions do, shown as the actions themselves.
 *
 * This was one line of text with arrow characters baked into the translation
 * ("Swipe a row: → still good · ← add to a list"). Three problems with that:
 * the arrows rendered at text weight and sat oddly against the words, the glyphs
 * are not reliably present in every Android system font, and a right-to-left
 * locale would need the arrows flipped inside the string — which is exactly the
 * kind of thing translators cannot be expected to get right.
 *
 * Showing the real thing instead: each side is a small pill wearing the same
 * icon and colour as the panel that appears under a swiped row, so the legend
 * and the gesture teach each other. The arrow is an icon, not a character, and
 * the labels reuse the strings the panels already use.
 */
function SwipeLegend({ colors }: { colors: Colors }) {
  const t = useT();
  return (
    <View style={styles.legend}>
      <View style={[styles.legendPill, { backgroundColor: colors.warnSoft ?? colors.line }]}>
        <Ionicons name="arrow-forward" size={13} color={colors.warn} />
        <Ionicons name="time-outline" size={13} color={colors.warn} />
        <Text style={[type.sub, { color: colors.warn }]} numberOfLines={1}>
          {t('pantry.stillGood')}
        </Text>
      </View>
      <View style={[styles.legendPill, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name="arrow-back" size={13} color={colors.accent} />
        <Ionicons name="add-circle-outline" size={13} color={colors.accent} />
        <Text style={[type.sub, { color: colors.accent }]} numberOfLines={1}>
          {t('pantry.addToList')}
        </Text>
      </View>
    </View>
  );
}

/**
 * A row on the Resting shelf. Deliberately not a swipe row: a resting item has
 * no prediction to correct and no reason to be added to a list, so the two
 * swipe actions would both be lies. It has exactly one control — bring it back
 * — and it's a plain, visible button rather than a hidden gesture, because this
 * is the page you land on when you're trying to undo something.
 *
 * Dimmed rather than greyed to a different palette: same row, asleep.
 */
function RestingRow({
  item,
  now,
  colors,
  onWake,
}: {
  item: ItemStat;
  now: number;
  colors: Colors;
  onWake: () => void;
}) {
  const t = useT();
  return (
    <View style={[styles.restRow, { backgroundColor: colors.surface }]}>
      <Ionicons name="moon-outline" size={18} color={colors.muted} />
      <ItemEmoji name={item.display} category={item.category} size={15} dim />
      <View style={styles.grow}>
        <Text style={[type.body, { color: colors.muted }]} numberOfLines={1}>
          {item.display}
        </Text>
        <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
          {categoryLabel(item.category, t)} · {lastBoughtLabel(item.lastPurchasedAt, now, t)}
        </Text>
      </View>
      <Pressable
        onPress={onWake}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('rest.wakeFor', { item: item.display })}
        style={[styles.wakeBtn, { borderColor: colors.accent }]}
      >
        <Text style={[type.sub, { color: colors.accent, fontWeight: '700' }]}>
          {t('rest.wake')}
        </Text>
      </Pressable>
    </View>
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
  queued,
  colors,
  onStillGood,
  onAddToList,
  onOpen,
}: {
  item: ItemStat;
  now: number;
  /** Currently sitting unticked on a shopping list. */
  queued: boolean;
  colors: Colors;
  onStillGood: () => void;
  onAddToList: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const tx = useSharedValue(0);
  const armed = useSharedValue(0); // -1/0/1: which side is past threshold (for haptic)

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      // Rubber-band rather than clamp: past MAX_TRAVEL the row keeps moving,
      // just less per pixel of finger. A hard clamp stops the row dead while
      // the finger carries on, which reads as the gesture having broken.
      tx.value = rubberBand(e.translationX, MAX_TRAVEL);
      const dir = tx.value > ACTION_THRESHOLD ? 1 : tx.value < -ACTION_THRESHOLD ? -1 : 0;
      if (dir !== armed.value) {
        armed.value = dir;
        if (dir !== 0) runOnJS(haptics.snap)();
      }
    })
    .onEnd((e) => {
      if (tx.value > ACTION_THRESHOLD) runOnJS(onStillGood)();
      else if (tx.value < -ACTION_THRESHOLD) runOnJS(onAddToList)();
      // Carries the release velocity, so a flung row leaves the finger at the
      // speed the finger was moving instead of stopping and restarting.
      tx.value = springTo(0, e.velocityX);
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
          {/* Tap opens restock settings. Nested inside the pan gesture rather
              than wrapping it, so a swipe still wins over a press. */}
          <Pressable
            onPress={onOpen}
            style={styles.grow}
            accessibilityRole="button"
            accessibilityLabel={t('staple.openFor', { item: item.display })}
          >
            <View style={styles.nameRow}>
              <ItemEmoji name={item.display} category={item.category} />
              {/* Staples carry a mark, and the accessible name says so too —
                  never colour or icon alone. */}
              {item.keepStocked && (
                <Ionicons
                  name="bookmark"
                  size={13}
                  color={colors.accent}
                  accessibilityLabel={t('staple.badge')}
                />
              )}
              {queued && (
                <Ionicons
                  name="cart"
                  size={13}
                  color={colors.warn}
                  accessibilityLabel={t('pantry.onList')}
                />
              )}
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {item.display}
              </Text>
            </View>
            <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
              {queued ? t('pantry.onList') : categoryLabel(item.category, t)} ·{' '}
              {lastBoughtLabel(item.lastPurchasedAt, now, t)}
              {hasUserCadence(item) ? ` · ${t('staple.everyDays', { count: item.cadenceDays ?? 0 })}` : ''}
            </Text>
          </Pressable>
          <View style={styles.stock}>
            <View style={[styles.bar, { backgroundColor: colors.line }]}>
              <View style={[styles.fill, { width: `${Math.max(left, 0.02) * 100}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={[type.sub, { color: left < LOW_THRESHOLD ? barColor : colors.muted }]}>
              {statusLabel(item, now, t)}
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
  // Wraps: the two labels together overrun a narrow phone in the longer
  // languages ("Noch gut" + "Zur Liste hinzufügen").
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    maxWidth: '100%',
  },
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    opacity: 0.72,
  },
  wakeBtn: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stock: { width: 104, gap: spacing.xs },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
