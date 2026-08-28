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
import { ItemEmoji } from '@/components/item-emoji';
import { ListPickerSheet } from '@/components/list-picker-sheet';
import { PantryTeaser } from '@/components/pantry-teaser';
import { CoachMark } from '@/components/coach-mark';
import { PurchaseLedger } from '@/components/purchase-ledger';
import { Screen } from '@/components/screen';
import { StapleSheet } from '@/components/staple-sheet';
import { StockBar } from '@/components/stock-bar';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { useToast } from '@/components/toast';
import { categorizeSync, categoryLabel } from '@/lib/categorize';
import { coachMarkDue, useCoachMark } from '@/lib/coach-marks';
import { haptics } from '@/lib/haptics';
import { cascade } from '@/lib/cascade';
import { rubberBand, springTo } from '@/lib/motion';
import { usePlusGate } from '@/lib/plus-gate';
import {
  dueAt,
  hasUserCadence,
  isLowStat,
  hasStopped,
  lastBoughtLabel,
  listsHolding,
  queuedKeys,
  statusLabel,
  stockGeometry,
  type ItemStat,
  type StockTone,
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
  /*
   * Which items have a ledger worth opening, built once for the whole screen.
   *
   * The per-row question is "does historyFor return anything", and asking it
   * that way is a filter over every purchase ever logged, once per row, on
   * every render — quadratic against the two things that grow together. Both
   * sides are already normalized keys (see ItemStat.key and Purchase.key), so a
   * Set answers the same question by lookup.
   */
  const logged = useMemo(() => new Set(purchases.map((p) => p.key)), [purchases]);
  /** The staple sheet is mounted exactly while `stapleKey` is set. */

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
        /*
         * The cascade goes on a wrapper, not on the row.
         *
         * PantrySwipeRow already owns a transform — the swipe — driven by a
         * shared value on the UI thread. An entering animation on the same view
         * writes the same property from the layout-animation side, and the two
         * fight: a row swiped while the screen is still arriving snaps back to
         * wherever the entrance had got to.
         *
         * The wrapper is also what makes the numbering right. `i` restarts at
         * zero for each section, which is what you want — a collapsed section
         * expanding should cascade from its own top, not continue a count from
         * whatever was above it.
         */
        <Animated.View key={item.key} entering={cascade(i)}>
        <PantrySwipeRow
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
          hasHistory={logged.has(item.key)}
          /* Gated exactly as the settings sheet's row is — same feature, same
             price. Nothing to defer here: no sheet is open, so the ledger's
             Modal has no other Modal to collide with. See HistoryRow for the
             case that does. */
          onOpenHistory={() => {
            haptics.tick();
            if (locked) requirePlus();
            else setLedgerFor({ name: item.display, category: item.category });
          }}
        />
        </Animated.View>
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
        /*
         * The one thing you come here to add, in the corner opposite the
         * title.
         *
         * It was a green "+ Track item" pill floating over the bottom-right of
         * the list. Two problems with that on this screen in particular: it sat
         * on top of the rows it was meant to sit beside — a pantry of 85 items
         * always has a row underneath it — and a floating pill is the loudest
         * control the app has, spent on the action people take least often
         * here. Items mostly arrive by being ticked off a list, not by being
         * typed in.
         *
         * At display size beside the title it is unmissable without hovering
         * over anything, and it reads as part of the header rather than as
         * something laid over the content.
         */
        headerAction={<TrackButton onPress={() => setAdding(true)} />}
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
        /*
         * The three verbs, wired to what this screen already does.
         *
         * Every one of them existed and none was reachable from the sheet:
         * "still good" and "add to list" were swipe gestures on the row behind
         * it, and logging a purchase was a text prompt on the tab. A sheet that
         * reports a shortage and offers a toggle sends the reader somewhere
         * else to act on what it just told them.
         *
         * The sheet CLOSES on all three. Each one changes the reading the sheet
         * is showing — a purchase resets the cycle, using it up brings the due
         * date forward — so staying open would leave a stale set of numbers on
         * screen with no sign they had moved.
         */
        onAddPurchase={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          setStapleKey(null);
          logPurchase(item.display, item.category);
          haptics.success();
          showToast(t('pantry.loggedOne', { item: item.display }));
        }}
        onAddToList={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          setStapleKey(null);
          // The same path the swipe takes, list picker and all.
          onAddToList(item);
        }}
        onMarkUsed={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          setStapleKey(null);
          markAlmostOut(item.key);
          haptics.tick();
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
        /* No deferral here any more, and that is the fix.

           This used to wrap the follow-up in `useDeferUntilClosed(stapleKey !=
           null)` — keyed on VISIBLE, which goes false a whole exit animation
           before the Modal's window is gone. StapleSheet's row now goes through
           the Sheet's own `dismiss`, which keys on `mounted`. See HistoryRow. */
        onOpenHistory={() => {
          const item = stapleKey ? stats[stapleKey] : null;
          if (!item) return;
          if (locked) requirePlus();
          else setLedgerFor({ name: item.display, category: item.category });
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
 * The "+" opposite the title.
 *
 * Drawn as text in `type.display` rather than as an icon, because the thing it
 * has to match is the word beside it: same family, same 40dp, same weight, so
 * the two read as one line of header rather than as a heading with a button
 * stuck next to it. An Ionicons glyph at 40 would be a different shape at a
 * different optical weight, sitting on a different baseline.
 *
 * Accent rather than ink for exactly the reason the size is shared: at the
 * title's own size and colour it would read as punctuation after "Pantry"
 * instead of as something to press. Colour is the only thing separating them,
 * so it is the only thing that differs.
 *
 * The name is not written anywhere — a bare "+" beside a screen title is about
 * as conventional as controls get — but it is the accessible label, which is
 * why the string that titled the old pill is kept rather than replaced.
 */
function TrackButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      // Generous, because the glyph is far narrower than its line box and the
      // corner of the screen is a hard place to hit precisely.
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
      accessibilityRole="button"
      accessibilityLabel={t('pantry.track')}
      style={styles.track}
    >
      <Text style={[type.display, { color: colors.accent }]}>+</Text>
    </Pressable>
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
  hasHistory,
  onOpenHistory,
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
  /**
   * Whether there is a ledger to open. The button is hidden rather than
   * disabled when there is not: a control that opens an empty sheet teaches
   * that the control is broken, and an item with no logged purchase is the
   * normal state of a freshly tracked staple, not an error.
   */
  hasHistory: boolean;
  onOpenHistory: () => void;
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

  const geo = stockGeometry(item, now);
  const toneColor: Record<StockTone, string> = {
    learning: colors.muted,
    ok: colors.muted,
    low: colors.warn,
    crit: colors.crit,
  };
  /*
   * `ok` reads MUTED here while the bar draws it in the accent. Not an
   * oversight and not a disagreement: the bar is a reading and shows where a
   * comfortable item sits on the scale, whereas this line is a caption, and a
   * caption that shouts on every healthy row leaves nothing louder for the ones
   * that need it. Colour is the scarce thing on this screen — thirty rows of
   * green "9 days left" is thirty rows of noise with the two urgent ones buried
   * in it.
   */
  const statusColor = toneColor[geo.tone];

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
            style={styles.body}
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
            {/*
             * Facts on the left, verdict on the right. The status used to sit
             * under the bar in a 104px column, where the longer languages wrap
             * it to two lines ("Noch 12 Tage") against an ellipsised name; on
             * its own end of a full-width line it has the room, and it lands in
             * the same place on every row so the column can be scanned down.
             */}
            <View style={styles.metaRow}>
              <Text style={[type.sub, styles.grow, { color: colors.muted }]} numberOfLines={1}>
                {queued ? t('pantry.onList') : categoryLabel(item.category, t)} ·{' '}
                {lastBoughtLabel(item.lastPurchasedAt, now, t)}
                {hasUserCadence(item) ? ` · ${t('staple.everyDays', { count: item.cadenceDays ?? 0 })}` : ''}
              </Text>
              <Text style={[type.sub, styles.status, { color: statusColor }]} numberOfLines={1}>
                {statusLabel(item, now, t)}
              </Text>
            </View>
            <StockBar geo={geo} />
          </Pressable>

          {/*
           * Straight to the ledger, without the settings sheet in between.
           *
           * It was already reachable — open the item, find the row, tap it —
           * and it is the thing people come to a pantry row to see, so it was
           * two taps and a sheet behind a place nobody would think to look.
           * Being a second target on the row it also has to be genuinely small
           * and genuinely at the edge, so a thumb aiming at the row does not
           * land on it: hitSlop gives it the touch area it needs without
           * lending it any visual weight.
           */}
          {hasHistory && (
            <Pressable
              onPress={onOpenHistory}
              hitSlop={10}
              style={styles.historyBtn}
              accessibilityRole="button"
              accessibilityLabel={t('pantry.historyFor', { item: item.display })}
            >
              <Ionicons name="receipt-outline" size={18} color={colors.muted} />
            </Pressable>
          )}
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
  /*
   * Pulls the glyph back to the margin. `type.display` carries -1.4 of
   * letter-spacing, which a text node applies AFTER its last character too, so
   * a single "+" renders with a sliver of empty box on its right and sits that
   * far off the edge the title is aligned to.
   */
  track: { marginRight: -2 },
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
  // flex-start, not centre: the card is three stacked lines now and the history
  // button belongs beside the NAME, not floating at the vertical middle of a
  // block whose height changes with the text.
  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  grow: { flex: 1, minWidth: 0 },
  body: { flex: 1, minWidth: 0, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  // Never squeezed to nothing by a long category or a long item name: it is the
  // shortest string on the row and the one worth reading.
  status: { flexShrink: 0, fontWeight: '600' },
  // Nudged down onto the name's baseline, and given its own top padding so the
  // touch target reaches the card's edge.
  historyBtn: { paddingTop: 3 },
});
