import { Ionicons } from '@expo/vector-icons';
import type { ItemCategory } from '@korb/shared';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
import { CoachMark } from '@/components/coach-mark';
import { PurchaseLedger } from '@/components/purchase-ledger';
import { Screen } from '@/components/screen';
import { StapleSheet } from '@/components/staple-sheet';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { useToast } from '@/components/toast';
import { categorizeSync, categoryLabel } from '@/lib/categorize';
import { coachMarkDue, useCoachMark } from '@/lib/coach-marks';
import { haptics } from '@/lib/haptics';
import { rubberBand, springTo } from '@/lib/motion';
import { useDeferUntilClosed } from '@/lib/modal-nav';
import { usePlusGate } from '@/lib/plus-gate';
import {
  LOW_THRESHOLD,
  dueAt,
  hasUserCadence,
  isLowStat,
  hasStopped,
  lastBoughtLabel,
  lifeRemaining,
  listsHolding,
  queuedKeys,
  statusLabel,
  type ItemStat,
} from '@/lib/pantry-intel';
import { useHomeListAdd } from '@/lib/use-home-list-add';
import { useAuth } from '@/store/auth';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

/*
 * No setLayoutAnimationEnabledExperimental call here, deliberately — see the
 * same note in components/store-groups.tsx. It is a no-op on the New
 * Architecture that warns in dev, and Fabric enables LayoutAnimations for
 * Android unconditionally, so there is nothing to switch on.
 */

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
  // Shared with Insights and the dashboard — see lib/plus-gate.ts.
  const { locked, requirePlus } = usePlusGate();
  const {
    stats,
    purchases,
    logPurchase,
    markAlmostOut,
    markStillGood,
    setStaple,
    setStopped,
    forgetItem,
  } = usePantryIntel();
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
  /** The staple sheet is mounted exactly while `stapleKey` is set. */
  const whenSheetClosed = useDeferUntilClosed(stapleKey != null);

  const now = Date.now();
  // Stopped items are split off before anything else: every count, section and
  // prediction on this screen is about what Korb is actively tracking.
  const { items, stopped } = useMemo(() => {
    const all = Object.values(stats);
    return {
      items: all.filter((s) => !hasStopped(s)).sort((a, b) => dueAt(a) - dueAt(b)),
      stopped: all
        .filter(hasStopped)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    };
  }, [stats]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Anything sitting unticked on a shopping list is, by the user's own hand,
  // running low — that's what putting it on the list *means*. A tick anywhere
  // cancels it again, including on a different list: see queuedKeys, which owns
  // the rule so it can be tested against the case that broke it.
  const queued = useMemo(() => queuedKeys(lists), [lists]);

  // The lists holding whichever item's sheet is open — tagged under its name so
  // "have I already put this on a list?" is answerable without leaving here.
  const stapleLists = useMemo(
    () =>
      stapleKey
        ? listsHolding(lists, stapleKey).map((l) => ({ id: l.id, name: l.name }))
        : [],
    [lists, stapleKey],
  );

  // The rule itself lives in lib/pantry-intel so the dashboard can describe the
  // same state without restating it — restating it is how the two screens came
  // to disagree in the first place.
  const isLow = useCallback((s: ItemStat) => isLowStat(s, queued, now), [queued, now]);

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

  const stoppedMatches = useMemo(
    () => (q ? stopped.filter((s) => s.display.toLowerCase().includes(q)) : stopped),
    [stopped, q],
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

  // "I've stopped buying this": out of every forward-looking reading, history
  // kept. Reversible in one tap from the toast, and in one tap from the section
  // it lands in after that.
  const onStopBuying = (item: ItemStat) => {
    setStapleKey(null);
    setStopped(item.key, true);
    haptics.success();
    /*
     * Undo, not "Buying again" — the two are different operations and the
     * difference matters exactly here.
     *
     * Resuming restarts the countdown, which is right when you have decided to
     * buy something again. Undo means the tap should never have happened, so
     * the item goes back to precisely what it was: same last-bought date, same
     * snooze. Restarting the clock on the button somebody reached for to
     * prevent a change would destroy the one field the stop was preserving.
     */
    showToast(t('stopped.toastStopped', { item: item.display }), {
      label: t('common.undo'),
      onPress: () => {
        setStopped(item.key, false, { restartClock: false });
        haptics.tick();
      },
    });
  };

  /*
   * Delete for good: the item and every purchase ever logged against it.
   *
   * Confirmed here rather than in the sheet because the warning has to name
   * what else disappears, and only this screen knows. The purchase log is what
   * Insights is computed FROM — spending, staples, cheaper-elsewhere, the
   * impact score — so erasing an item's log silently rewrites four cards on
   * another tab. A user who is told that and proceeds has made a choice; one
   * who is not has had data taken.
   *
   * Shopping lists are deliberately left alone. A row on a list is a thing
   * somebody intends to buy, possibly the person holding a different phone in
   * a different shop right now, and quietly removing it from under them is a
   * worse surprise than the item returning. If it IS bought later, it comes
   * back as a fresh item with one purchase and no history, which is exactly
   * what the pantry should say about it — so the message promises that rather
   * than hiding it.
   */
  const onDelete = (item: ItemStat) => {
    Alert.alert(
      t('forget.title', { item: item.display }),
      t('forget.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('forget.confirm'),
          style: 'destructive',
          onPress: () => {
            setStapleKey(null);
            forgetItem(item.key);
            haptics.success();
            showToast(t('forget.toast', { item: item.display }));
          },
        },
      ],
    );
  };

  const onWake = (item: ItemStat) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStopped(item.key, false);
    haptics.success();
    showToast(t('stopped.toastResumed', { item: item.display }));
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

  const pickList = (listId: string, listName: string) => {
    const item = pendingAdd;
    setPendingAdd(null);
    if (!item) return;
    addToChosenList(listId, listName, item.display, item.category);
    markAlmostOut(item.key);
    haptics.success();
  };

  /*
   * Two tips on one screen, and only ever one of them at a time.
   *
   * The swipe is the thing the whole tab is built around and the least
   * discoverable, so it goes first; the details tap waits until the swipe tip
   * has been dealt with, which in practice means a later visit. Stacking both
   * would put a second dimmed overlay on screen the instant the first is
   * dismissed, which reads as the app nagging.
   *
   * `low.length > 0` is the readiness gate: a tip pointing at the first row is
   * only sensible once there IS a first row, which on a new install is several
   * shops away.
   */
  const coachRef = useRef<View>(null);
  const swipeCoach = useCoachMark('pantrySwipe', low.length > 0, coachRef);
  const detailsCoach = useCoachMark(
    'pantryDetails',
    low.length > 0 && !swipeCoach.visible && coachMarkDue('pantrySwipe') === false,
    coachRef,
  );

  const renderRows = (rows: ItemStat[]) => (
    <View style={styles.rowStack}>
      {rows.map((item, i) => (
        <PantrySwipeRow
          key={item.key}
          /* Only the first row of the FIRST section carries a coach ref, and
             collapsable={false} inside the row keeps Android from flattening
             the view away — a flattened view measures nothing. */
          coachRef={i === 0 && rows === low ? coachRef : undefined}
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
        {items.length === 0 && stopped.length === 0 ? (
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

            {searching && low.length === 0 && stocked.length === 0 && stoppedMatches.length === 0 ? (
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
                    icon="bag-remove-outline"
                    title={t('stopped.allStoppedTitle')}
                    body={t('stopped.allStoppedBody')}
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
                {stoppedMatches.length > 0 && (
                  <View style={styles.section}>
                    <SectionHeader
                      title={t('stopped.section')}
                      tone={colors.muted}
                      count={stoppedMatches.length}
                      expanded={restExpanded}
                      onPress={() => toggle('rest')}
                    />
                    {restExpanded && (
                      <View style={styles.rowStack}>
                        <Text style={[type.sub, { color: colors.muted }]}>
                          {t('stopped.sectionHint')}
                        </Text>
                        {stoppedMatches.map((item) => (
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
      <CoachMark
        visible={swipeCoach.visible}
        rect={swipeCoach.rect}
        textKey="coach.pantrySwipe"
        gesture="swipeBoth"
        onDismiss={swipeCoach.dismiss}
        onSkipAll={swipeCoach.skipAll}
      />
      <CoachMark
        visible={detailsCoach.visible}
        rect={detailsCoach.rect}
        textKey="coach.pantryDetails"
        gesture="tap"
        onDismiss={detailsCoach.dismiss}
        onSkipAll={detailsCoach.skipAll}
      />
      <StapleSheet
        item={stapleKey ? stats[stapleKey] ?? null : null}
        /* Computed here rather than inside the sheet: this screen already holds
           the lists, and the sheet stays a presentational component that can be
           rendered from anywhere with whatever the caller knows. */
        lists={stapleLists}
        onClose={() => setStapleKey(null)}
        onChange={(patch) => {
          if (stapleKey) setStaple(stapleKey, patch);
        }}
        onStopBuying={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (item) onStopBuying(item);
        }}
        onDelete={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (item) onDelete(item);
        }}
        purchases={purchases}
        /* Plus gates this by PROMPTING, not hiding.
           The row stays in the settings sheet because an item visibly HAS a
           history — the pantry above it already says "last bought yesterday",
           so hiding the way in would look like a missing feature rather than a
           paid one.

           Both outcomes leave this sheet, so both wait for it to close. It used
           to be wrapped in `guard`, which put the close INSIDE the unlocked
           branch — so a free account pushed the paywall under a Modal that was
           still up and got a blank screen. Closing is not part of either
           branch; it is what happens before either can run. */
        onOpenHistory={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          whenSheetClosed(
            locked
              ? requirePlus
              : () => setLedgerFor({ name: item.display, category: item.category }),
          );
          setStapleKey(null);
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
 * A row on the Resting shelf. Deliberately not a swipe row: a stopped item has
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
      <Ionicons name="bag-remove-outline" size={18} color={colors.muted} />
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
        accessibilityLabel={t('stopped.resumeFor', { item: item.display })}
        style={[styles.wakeBtn, { borderColor: colors.accent }]}
      >
        <Text style={[type.sub, { color: colors.accent, fontWeight: '700' }]}>
          {t('stopped.resume')}
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
  coachRef,
}: {
  item: ItemStat;
  now: number;
  /** Currently sitting unticked on a shopping list. */
  queued: boolean;
  colors: Colors;
  onStillGood: () => void;
  onAddToList: () => void;
  onOpen: () => void;
  /** Set on the first row only, so a coach mark can measure where it sits. */
  coachRef?: RefObject<View | null>;
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
    /* collapsable={false} so Android keeps this view in the hierarchy — a
       flattened view has nothing to measure, and the coach mark would spotlight
       a rect of zeroes. Harmless on the rows that carry no ref. */
    <View ref={coachRef} collapsable={false} style={styles.swipeWrap}>
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
  //
  // The vertical margins are its own, not the parent's. Everything on this
  // screen is spaced by one `gap` on the scroll content, which gave the legend
  // the same 12dp as the gap between two pantry rows — so a caption explaining
  // a gesture sat as tightly against the search field above and the section
  // heading below as list items sit against each other. It is a different KIND
  // of thing from its neighbours and needs to look like one.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
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
