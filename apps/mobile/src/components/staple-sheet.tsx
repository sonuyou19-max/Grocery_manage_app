import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState, type PropsWithChildren } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet, SheetHandle, useSheetDismiss } from "@/components/sheet";
import { GlassView } from "@/components/glass";
import { ItemEmoji } from "@/components/item-emoji";
import { StockBar } from "@/components/stock-bar";
import { categoryLabel } from "@/lib/categorize";
import {
  CADENCE_PRESETS,
  effectiveInterval,
  hasUserCadence,
  lastBoughtLabel,
  sinceBoughtLabel,
  statusLabel,
  stockGeometry,
  type ItemStat,
  type StockTone,
} from "@/lib/pantry-intel";
import { storageTipFor } from "@/lib/item-lexicon";
import { listTint } from "@/lib/list-tint";
import { historyFor, type Purchase } from "@/lib/purchase-log";
import { useT } from "@/store/locale";
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Per-item restock settings: mark it a staple, and pin how often you restock it.
 *
 * Why both, when they sound like one thing:
 *
 * - **Always keep in stock** is a priority claim. It doesn't move the due date —
 *   it decides what wins a place in the capped Vibe Check deck, because running
 *   out of a declared staple is the failure worth preventing first.
 * - **Cadence** is a correction. The engine learns intervals by watching
 *   check-offs, which is wrong when it has no history (it's guessing from the
 *   category) or when it learned from irregular shopping. Setting a number here
 *   overrides it everywhere at once.
 *
 * Keeping them separate matters: you can want a fixed cadence on something
 * that isn't a staple, and mark a staple while still letting Korb learn its
 * rhythm. Collapsing them into one control would take that away.
 */

interface StapleSheetProps {
  item: ItemStat | null;
  onClose: () => void;
  onChange: (patch: {
    keepStocked?: boolean;
    cadenceDays?: number | null;
  }) => void;
  /**
   * "I have stopped buying this" — it leaves every forward-looking reading
   * while keeping its history. The caller closes the sheet.
   */
  onStopBuying: () => void;
  /**
   * Erase the item and its whole history. The caller confirms first and closes
   * the sheet — this component only offers the control, because the warning
   * has to name what else goes with it and only the caller knows that.
   */
  onDelete: () => void;
  /** Every logged purchase, so the sheet can offer this item's history. */
  purchases: Purchase[];
  onOpenHistory: () => void;
  /**
   * The three things a person can actually do about an item, from the screen
   * that told them it is running out.
   *
   * Handlers rather than behaviour, for the same reason `lists` is a prop: this
   * component draws a pantry item and the Pantry owns what buying, listing and
   * using one MEAN. All three already existed on that screen — two of them
   * behind swipes nobody discovers, and one only reachable from a text prompt.
   */
  onAddPurchase: () => void;
  onAddToList: () => void;
  onMarkUsed: () => void;
  /**
   * The lists this item is currently on, tagged under its name.
   *
   * Answering "where did I put this?" without leaving the Pantry — the moment
   * you want it is the moment you are looking at the item and wondering whether
   * it is already handled. Empty is the normal case for something tracked but
   * not currently needed, and renders nothing.
   */
  lists: { id: string; name: string }[];
}

export function StapleSheet({
  item: openItem,
  onClose,
  onChange,
  onStopBuying,
  onDelete,
  purchases,
  onOpenHistory,
  onAddPurchase,
  onAddToList,
  onMarkUsed,
  lists: openLists,
}: StapleSheetProps) {
  const { colors, scheme } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const t = useT();

  /*
   * What to draw, which stops being "the open item" the moment it closes.
   *
   * The Pantry closes this sheet by clearing the key it looks the item up by,
   * so `item` goes null on the same frame `visible` does — and this component
   * used to answer that with `if (!item) return null`, tearing the whole Sheet
   * down before it could play anything. That is why the sheet had no exit at
   * all: it did not animate away, it simply stopped existing. Sheet's own
   * `mounted` cannot help, because the thing being unmounted is Sheet.
   *
   * So the last item to have been open is kept, and rendered until the close
   * animation is over. `lists` rides along with it for the same reason — the
   * tags under the name are derived from the open key too, and would have
   * blinked out a beat before the sheet did.
   */
  const last = useRef<{
    item: ItemStat;
    lists: { id: string; name: string }[];
  } | null>(null);
  if (openItem) last.current = { item: openItem, lists: openLists };

  const snapshot = last.current;

  /*
   * EVERY HOOK ABOVE THE GATE.
   *
   * `snapshot` is null only before this sheet has ever opened, so the early
   * return below is real and unavoidable — which makes everything hook-shaped
   * have to come first, derived from a name that may not exist yet. Written the
   * other way round it reads fine and breaks the moment the sheet opens for the
   * first time, because the hook order changes between renders.
   */
  const displayName = snapshot?.item.display ?? null;
  const history = useMemo(
    () => (displayName ? historyFor(purchases, displayName) : []),
    [purchases, displayName],
  );

  /*
   * The gaps between purchases, newest last, for the little chart.
   *
   * Intervals rather than prices: this row answers "how often", and the sheet
   * around it is entirely about rhythm. `historyFor` returns newest first, so
   * this walks backwards to put time's direction left to right.
   */
  const intervals = useMemo(() => {
    const days: number[] = [];
    for (let i = history.length - 1; i > 0; i -= 1) {
      const gap = (history[i - 1]!.at - history[i]!.at) / 86_400_000;
      if (gap > 0) days.push(gap);
    }
    return days.slice(-8);
  }, [history]);

  /*
   * The storage tip, from the shared dictionary — learned once for "spinach"
   * and free for every household after.
   *
   * Null far more often than not, and that is the intended shape: most staples
   * keep perfectly well in a cupboard, and "store in a cool dry place" on forty
   * items is noise a reader learns to skip past. A missing tip renders nothing
   * rather than a placeholder.
   */
  const tip = displayName ? storageTipFor(displayName) : null;

  // The cadence footnote, which was permanent prose under the chips nobody
  // read. Behind a tap it is there when the question actually occurs.
  const [whyOpen, setWhyOpen] = useState(false);

  if (!snapshot) return null;
  const { item, lists } = snapshot;

  const learned = Math.round(effectiveInterval(item));
  const pinned = hasUserCadence(item);

  /*
   * One `now` for the whole sheet.
   *
   * Read once per render rather than per call site, so the status line, the
   * gauge and the last-bought label are all describing the same instant — three
   * Date.now() calls a millisecond apart can straddle a day boundary and print
   * a state that disagrees with its own bar.
   */
  const now = Date.now();
  const geo = stockGeometry(item, now);
  const tone = toneOf(geo.tone, colors);

  /*
   * A real pixel ceiling, replacing `maxHeight: '85%'`.
   *
   * The percentage had nothing definite to resolve against: everything above
   * this card in Sheet — a Pressable, an Animated.View, another Pressable — is
   * sized from its own content, so "85% of my parent" asks a parent that is
   * still asking its children. purchase-ledger hit this first and wrote it up;
   * the symptom there and here is the same, a card laid out against a
   * degenerate constraint with its last rows clipped away by GlassView's
   * overflow: hidden. On this sheet that took Done with it, which is the way
   * out of the sheet.
   */
  const cardCap = Math.round(windowHeight * 0.85);

  return (
    // gutter 0 and square bottom corners: this is a bottom sheet that meets the
    // screen edge, the way the list's item sheet does, rather than a card
    // floating inside a margin. Same component, same motion — only the resting
    // shape differs.
    <Sheet
      visible={openItem != null}
      onClose={onClose}
      scrim
      gutter={0}
      motion="slide"
    >
      <GlassView
        over="content"
        radius={radii.lg}
        style={[styles.sheet, { maxHeight: cardCap }]}
      >
        <SheetHandle />
        {/*
          PINNED, outside the ScrollView, for the same reason Done is.

          This sheet is tall enough to scroll, and the first thing to leave the
          screen was the name of the thing it is about — leaving a category, a
          gauge and a set of chips with nothing saying which item they belong
          to. It is also where the two ways out of an item live, and a
          destructive control that scrolls past is a control people hunt for.

          A hairline under it, drawn only while there is something above the
          fold, so a short sheet has no rule floating over its own whitespace.
        */}
        <View style={[styles.pinnedHead, { borderColor: colors.line }]}>
          <View style={styles.headRow}>
            {/*
              The item's own glyph, given room.

              Not a photograph. There is no image source in the app, and the
              failure mode decides it: a photo is right for "Spinach" and blank
              for "Provital toast 50 pieces" or "Kawa", which is a large share
              of a receipt-fed pantry. The emoji table covers 646 words across
              seven languages, resolves offline and instantly, and is never
              missing. What it lacked was scale, which is free.
            */}
            <View style={[styles.glyphPad, { backgroundColor: colors.accentSoft }]}>
              <ItemEmoji name={item.display} category={item.category} size={38} />
            </View>
            <View style={styles.grow}>
            {/* Name and list tags share one row, the tags reading as a suffix
                to the name rather than as a separate fact below it — "Pizza,
                which is on Weekly" instead of "Pizza" then "Weekly".

                One tag per list, each in the list's own colour — see
                lib/list-tint for why the colour is hashed from the id rather
                than cycled by position. The row wraps rather than truncating:
                a household with four lists and a long name for each is
                ordinary, and a clipped tag names the wrong list. A long item
                name simply takes the width it needs and pushes the tags onto
                the next line, which is the same layout as before. */}
            <View style={styles.titleRow}>
              <Text
                style={[type.h2, { color: colors.ink }, styles.title]}
                numberOfLines={2}
              >
                {item.display}
              </Text>
              {lists.map((l) => {
                const tint = listTint(l.id, scheme);
                return (
                  <View
                    key={l.id}
                    style={[styles.tag, { backgroundColor: tint.bg }]}
                  >
                    <Text
                      style={[styles.tagText, { color: tint.fg }]}
                      numberOfLines={1}
                    >
                      {l.name}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={[type.sub, { color: colors.muted }]}>
              {categoryLabel(item.category, t)}
            </Text>
            </View>

            {/* The two ways an item leaves the pantry, side by side and in
                that order: stop buying it, or delete it.

                They used to be at opposite ends of the sheet, on the reasoning
                that one is reversible and the other ends the item, so a
                destructive control should not sit at the foot of a list of
                settings where somebody working downwards will hit it. That
                second half still holds and is why neither is down there any
                more — but keeping them apart also hid the reversible one at the
                bottom of a scroll, which made delete the obvious answer to "I
                do not buy this any more" when it is the wrong one.

                Adjacent, they read as a choice. Both muted rather than red: the
                weight belongs in delete's confirmation, and a red button up
                here would shout on a screen opened to change a cadence. */}
            <Pressable
              onPress={onStopBuying}
              accessibilityRole="button"
              accessibilityLabel={t("stopped.action")}
              accessibilityHint={t("stopped.hint")}
              hitSlop={12}
              style={styles.trash}
            >
              <Ionicons name="bag-remove-outline" size={22} color={colors.muted} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t("forget.action", { item: item.display })}
              hitSlop={12}
              style={styles.trash}
            >
              <Ionicons name="trash-outline" size={22} color={colors.muted} />
            </Pressable>
          </View>

        </View>
        <ScrollView
          {...scrollIndicator}
          style={styles.scrollArea}
          contentContainerStyle={styles.content}
        >
          {/*
            WHAT THE ITEM IS DOING, before any setting about it.

            The sheet opened on a toggle. It is reached by tapping a row that
            says "19 days left", and the first thing it owed the reader was that
            same fact in full — the state in words, the number, and where the
            marker sits along the cycle.

            One reading of the clock, not three. The reference drawing carried a
            ring, a bar AND a date; the bar is the one that also shows how far
            through you are, so it is the one that stays, with the day count
            beside the state.
          */}
          <View style={[styles.fresh, { backgroundColor: tone.soft }]}>
            <View style={styles.freshTop}>
              <View style={[styles.toneDot, { backgroundColor: tone.ink }]}>
                <Ionicons name={tone.icon} size={15} color={tone.on} />
              </View>
              <Text style={[type.h2, styles.grow, { color: tone.ink }]} numberOfLines={1}>
                {statusLabel(item, now, t)}
              </Text>
            </View>
            {/* The same gauge the row draws — one instrument, two places, so
                the sheet can never disagree with the row that opened it. */}
            <StockBar geo={geo} />
          </View>

          {/*
            THE THREE VERBS.

            All three already existed and none was findable from here: buying
            was a text prompt on the tab, listing and using were swipe gestures.
            A sheet that reports a shortage and offers only a toggle is asking
            the reader to go somewhere else to act on what it just told them.
          */}
          <View style={styles.actions}>
            <ActionButton
              icon="cart-outline"
              label={t("staple.actionBuy")}
              onPress={onAddPurchase}
            />
            <ActionButton
              icon="add-circle-outline"
              label={t("staple.actionList")}
              onPress={onAddToList}
            />
            <ActionButton
              icon="checkmark-circle-outline"
              label={t("staple.actionUsed")}
              onPress={onMarkUsed}
            />
          </View>

          {/* Staple toggle */}
          {/*
            A promise, and it looks like one once it has been made.

            OFF this is a plain row among settings, because that is what it is —
            one option of several. ON it is a commitment the app will act on
            every week without asking again, and the warm card is the app
            acknowledging that rather than leaving a switch to carry the whole
            meaning. Amber rather than accent green so it does not read as
            another "this is fine" surface beside the freshness card.
          */}
          <View
            style={[
              styles.keep,
              item.keepStocked
                ? { backgroundColor: colors.warnSoft }
                : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
            ]}
          >
            <Ionicons
              name={item.keepStocked ? "bookmark" : "bookmark-outline"}
              size={22}
              color={item.keepStocked ? colors.warn : colors.muted}
            />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>
                {t("staple.keepTitle")}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("staple.keepHint")}
              </Text>
            </View>
            <Switch
              value={item.keepStocked ?? false}
              onValueChange={(v) => onChange({ keepStocked: v })}
              trackColor={{ true: colors.warn, false: colors.line }}
            />
          </View>

          {/* Cadence */}
          <View style={styles.section}>
            <View style={styles.sectHead}>
              {/* An icon per section, so the sheet has a rhythm to scan down
                  rather than four indistinguishable blocks of text. */}
              <View style={styles.sectTitle}>
                <Ionicons name="repeat" size={15} color={colors.muted} />
                <Text style={[type.label, { color: colors.muted }]}>
                  {t("staple.cadenceTitle")}
                </Text>
              </View>
              {/* The note used to sit under the chips permanently: prose nobody
                  reads, under controls everybody uses. */}
              <Pressable
                onPress={() => setWhyOpen((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ expanded: whyOpen }}
                style={[styles.why, { borderColor: colors.line }]}
              >
                <Text style={[type.label, { color: colors.muted }]}>
                  {t("staple.whyThese")}
                </Text>
                <Ionicons name="information-circle-outline" size={13} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={[type.sub, { color: colors.muted }]}>
              {pinned
                ? t("staple.cadencePinned", { count: item.cadenceDays ?? 0 })
                : t("staple.cadenceLearned", { count: learned })}
            </Text>
            <View style={styles.chips}>
              {/* "Learn it" is first and is the default state, so handing
                      control back is never buried behind the presets. */}
              <CadenceChip
                label={t("staple.cadenceAuto")}
                active={!pinned}
                onPress={() => onChange({ cadenceDays: null })}
              />
              {CADENCE_PRESETS.map((days) => (
                <CadenceChip
                  key={days}
                  label={t("staple.everyDays", { count: days })}
                  active={pinned && item.cadenceDays === days}
                  onPress={() => onChange({ cadenceDays: days })}
                />
              ))}
            </View>
            {whyOpen && (
              <Text style={[type.sub, { color: colors.muted }]}>
                {t("staple.cadenceNote")}
              </Text>
            )}
          </View>

          {/* Every time you bought this. The pantry knows the rhythm; the
                  ledger is the evidence behind it, and the place a wrong price
                  or a purchase at the wrong shop becomes visible. */}
          {history.length > 0 && (
            <HistoryRow
              onOpenHistory={onOpenHistory}
              style={[styles.insight, { backgroundColor: colors.accentSoft }]}
            >
              {/*
                TWO ROWS, because one cannot survive a long language.

                Badge, text, chart, date box and chevron on a single line leaves
                the text 16 points on a 390pt phone — and the box is wide
                because of its LABEL, not its value: "ZULETZT GEKAUFT" is 111
                points at 11px/800 with letter-spacing, wider than the date it
                introduces. German truncated the card's own title to
                "Kauf-Einblic…", which is a heading that has run out of room to
                say what it is.

                No amount of flex tuning fixes five things competing for one
                line. Split, the text gets the full width and the chart gets
                more room to be legible than it had.
              */}
              <View style={styles.insightTop}>
                <View style={[styles.badge, { backgroundColor: colors.accent + '28' }]}>
                  <Ionicons name="stats-chart" size={17} color={colors.accent} />
                </View>
                <View style={styles.insightBody}>
                  <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                    {t("staple.insightsTitle")}
                  </Text>
                  <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                    {t("staple.typicalCycle")}
                  </Text>
                  <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
                    {t("staple.cycleDays", { count: learned })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>

              <View style={styles.insightBottom}>
                {/*
                  Below two intervals there is no rhythm to plot, and an empty
                  frame reads as a broken chart rather than as an item with
                  little history. On its own row it no longer has to earn its
                  place against the text, so the narrow-screen rule is gone.
                */}
                {intervals.length >= 2 && <IntervalChart days={intervals} />}
                <View style={styles.grow} />
                <View style={[styles.lastBuy, { borderColor: colors.line, backgroundColor: colors.surface }]}>
                  <Ionicons name="calendar-outline" size={15} color={colors.muted} />
                  <View style={styles.lastBuyText}>
                    <Text style={[type.label, { color: colors.muted }]} numberOfLines={1}>
                      {t("staple.lastBoughtLabel")}
                    </Text>
                    {/* The RELATIVE form. lastBoughtLabel is a whole sentence
                        and under this label it read "LAST BOUGHT / Last bought a
                        week ago" — the fact twice in one box. */}
                    <Text style={[type.sub, { color: colors.ink }]} numberOfLines={1}>
                      {sinceBoughtLabel(item.lastPurchasedAt, now, t)}
                    </Text>
                  </View>
                </View>
              </View>
            </HistoryRow>
          )}

          {/*
            KEEPING IT. Advice about the product, never a claim about the
            shopper's own item — hence "Keeping spinach" rather than a sentence
            that sounds like it was measured in their fridge.

            Storage only, and that boundary is enforced three deep: the prompt
            forbids nutrition and health words, isShareableTip refuses any tip
            containing them, and the column's CHECK bounds the shape. "High in
            iron" is a regulated claim under EU 1924/2006; where to keep a bag
            of leaves is not.
          */}
          {tip != null && (
            <View style={[styles.tip, { borderColor: colors.line }]}>
              <Ionicons name="bulb-outline" size={18} color={colors.accent} />
              <Text style={[type.sub, styles.grow, { color: colors.muted }]}>
                {tip}
              </Text>
            </View>
          )}

        </ScrollView>

        {/* Outside the ScrollView, like the list's item sheet: the way out of a
            sheet must not be something you have to scroll to find. It also
            carries the safe-area inset, because the card now meets the bottom
            of the screen and the gesture bar is its floor. */}
        <Pressable
          onPress={onClose}
          style={[styles.done, { paddingBottom: spacing.sm + insets.bottom }]}
          hitSlop={8}
        >
          <Text style={[type.body, { color: colors.accent }]}>
            {t("common.done")}
          </Text>
        </Pressable>
      </GlassView>
    </Sheet>
  );
}

function CadenceChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      /*
        Chosen means FILLED. Tinted-with-a-coloured-border is the same weight as
        the four beside it from more than a foot away, and this strip's whole
        job is to answer "which one is on" at a glance.
      */
      style={[
        styles.chip,
        {
          borderColor: active ? colors.accent : colors.line,
          backgroundColor: active ? colors.accent : colors.surface,
        },
      ]}
    >
      <Text
        style={[type.sub, { color: active ? colors.accentInk : colors.ink }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The row that opens the purchase ledger.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own component at all
 * ---------------------------------------------------------------------------
 *
 * Only something rendered INSIDE `<Sheet>` can call `useSheetDismiss()`, and
 * only `useSheetDismiss()` knows when the Modal's native window has actually
 * gone. StapleSheet cannot: it is the component that renders the Sheet, so it
 * sits above the context it would need. Exactly the split range-picker made,
 * for exactly the same reason.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * The ledger is a second Modal, opened from inside this one. The Pantry used to
 * defer it with its own `useDeferUntilClosed(stapleKey != null)` — keyed on
 * VISIBLE, which goes false a whole exit animation before the window is gone.
 * So the ledger was presented while this sheet was still on screen.
 *
 * Android tolerates that: two Modals are two windows and the second lands on
 * top. iOS does not. UIKit refuses to present a view controller while one is
 * already presenting, so the ledger never appeared — and the Pantry was left
 * with a transparent Modal over it swallowing every touch, which is what "it
 * doesn't open anything and the tab gets stuck" is.
 *
 * `dismiss(action)` closes this sheet and runs the action once `mounted` goes
 * false, which is the Modal's real visibility rather than the prop that drives
 * it.
 */
function HistoryRow({
  onOpenHistory,
  style,
  children,
}: PropsWithChildren<{ onOpenHistory: () => void; style: StyleProp<ViewStyle> }>) {
  const dismiss = useSheetDismiss();
  return (
    <Pressable onPress={() => dismiss(onOpenHistory)} accessibilityRole="button" style={style}>
      {children}
    </Pressable>
  );
}

/** One of the three verbs. Equal thirds, so no action reads as the main one. */
function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.action, { backgroundColor: colors.accentSoft }]}
    >
      <Ionicons name={icon} size={19} color={colors.accent} />
      {/*
        Sentence case at body weight, not the uppercase label style.

        `type.label` is 11px, weight 800, letter-spaced and capitalised — it is
        built for a section heading, and three of them side by side read as
        SHOUTING rather than as buttons. These are the sheet's primary verbs and
        should look like something you press, not like a legend.

        Two lines allowed: "Mark as used" is a word longer in German and wider
        in Polish, and a truncated verb is not a verb.
      */}
      <Text style={[styles.actionText, { color: colors.ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The gaps between purchases, as bars.
 *
 * Heights are relative to the LONGEST gap rather than to the learned cycle: the
 * question this answers is "how regular am I", and a scale anchored to the
 * average would flatten exactly the variation worth seeing. A floor of 15%
 * keeps a very short gap visible as a bar rather than as a line.
 *
 * The most recent two are drawn solid and the rest dimmed — recency is the part
 * that tells you whether the rhythm is holding, and it is the part the eye
 * should land on first.
 */
function IntervalChart({ days }: { days: number[] }) {
  const { colors } = useTheme();
  const longest = Math.max(...days);
  return (
    <View style={styles.chart} accessibilityRole="image">
      {days.map((d, i) => (
        <View
          key={`${i}-${d}`}
          style={[
            styles.bar,
            {
              height: `${Math.max(15, (d / longest) * 100)}%`,
              backgroundColor: colors.accent,
              opacity: i >= days.length - 2 ? 1 : 0.38,
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * The freshness card's whole palette, from the tone the gauge is already using.
 *
 * The card used to be accent-tinted whatever the item was doing, so an overdue
 * mango sat in a calm green card with red text inside it — the surface saying
 * one thing and its contents another. A card that carries the state is the
 * cheapest way to make a sheet readable before it is read: green, amber and red
 * are legible from arm's length and the words are not.
 *
 * `on` is the ink that goes ON the solid dot, which is why it is a separate
 * value rather than a fixed white: in dark mode the accent is a light green and
 * white on it is unreadable.
 */
function toneOf(
  tone: StockTone,
  colors: {
    muted: string; line: string; surface: string;
    accent: string; accentSoft: string; accentInk: string;
    warn: string; warnSoft: string; crit: string; critSoft: string;
  },
): { ink: string; soft: string; on: string; icon: keyof typeof Ionicons.glyphMap } {
  if (tone === 'learning') {
    return { ink: colors.muted, soft: colors.line, on: colors.surface, icon: 'hourglass-outline' };
  }
  if (tone === 'crit') {
    return { ink: colors.crit, soft: colors.critSoft, on: colors.critSoft, icon: 'alert-circle' };
  }
  if (tone === 'low') {
    return { ink: colors.warn, soft: colors.warnSoft, on: colors.warnSoft, icon: 'time' };
  }
  return { ink: colors.accent, soft: colors.accentSoft, on: colors.accentInk, icon: 'leaf' };
}

const styles = StyleSheet.create({
  // Name block and the delete control, top-aligned so the icon stays level
  // with the first line of a name that wraps to two.
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  trash: { paddingTop: 2 },
  /*
   * The pinned header's own padding, because it is no longer inside the
   * ScrollView's contentContainer and would otherwise sit flush to the edges.
   */
  pinnedHead: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // The glyph's own ground. Square-ish rather than round: a circle around an
  // emoji reads as an avatar, and this is a thing, not a person.
  glyphPad: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fresh: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  freshTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // A solid disc of the tone's own colour. The card is a wash; this is the one
  // saturated mark on it, which is what stops a pale tint reading as decoration.
  toneDot: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  keep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  sectTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  // 13/600 rather than the 11/800 uppercase label style: a button, not a legend.
  actionText: { textAlign: 'center', fontSize: 13, fontWeight: '600' },

  sectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  why: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },

  // A column now: see the note at the call site for why one row could not hold
  // five things in German.
  insight: {
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  insightTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  insightBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Takes the whole top row now, so a heading no longer truncates itself.
  insightBody: { flex: 1, minWidth: 0 },
  // Wider than it was, because it no longer competes with the text for a line.
  chart: {
    flexShrink: 0,
    width: 104,
    height: 38,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: { flex: 1, minWidth: 3, borderRadius: 2 },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  /*
   * SHRINKABLE, because React Native's default is not.
   *
   * On the web flexShrink defaults to 1; in React Native it defaults to 0, so a
   * box like this does not give — it overflows. In German the row ran off the
   * right edge of the screen and took the chevron with it, and no amount of
   * shortening the text fixes the cause. minWidth 0 on both this and the column
   * inside it is what lets numberOfLines actually truncate rather than the box
   * simply refusing to be narrower than its content.
   */
  lastBuy: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  lastBuyText: { flexShrink: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    // Centre, not baseline: RN resolves baseline against a multi-line Text's
    // last line, which would hang the tag off the bottom of a two-line name.
    alignItems: "center",
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  // Shrinkable so the name yields before the row overflows; it still gets a
  // full line to itself when it is long, because the row wraps.
  title: { flexShrink: 1 },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    // Keeps one very long list name from pushing the sheet wide; the name
    // itself truncates inside the chip rather than the row overflowing.
    maxWidth: "100%",
  },
  tagText: { fontSize: 12, fontWeight: "700" },
  // Capped so a long item name plus the presets can't push the Done row off a
  // short screen — the content scrolls instead. The cap itself is applied
  // inline (cardCap, from the window); flexShrink is the static half that lets
  // it actually squeeze rather than the card overflowing it.
  sheet: {
    flexShrink: 1,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  // flexGrow 0 so a short item sizes the sheet to its own content instead of
  // stretching to the cap; flexShrink 1 so a long one gives way to it.
  scrollArea: { flexGrow: 0, flexShrink: 1 },
  /*
   * ONE spacing system, not two.
   *
   * This gap and a marginTop on every card were both in play, so each seam was
   * the sum of the two — which is most of the empty space the sheet was
   * carrying. The gap owns the rhythm now and no card adds to it.
   */
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Shares the bordered `row` layout but drops the top rule, so it reads as the
  // sheet's closing action rather than another setting in the stack.
  grow: { flex: 1, minWidth: 0 },
  // Wraps, because translated cadence labels ("alle 14 Tage") run much longer
  // than the English.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: "100%",
  },
  done: { alignItems: "center", paddingVertical: spacing.sm },
});
