import { Ionicons } from "@expo/vector-icons";

import type { ItemCategory } from "@korb/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { EcoBar } from "@/components/eco-bar";
import { EmptyState } from "@/components/empty-state";
import { Frosted } from "@/components/frosted";
import { ItemEmoji } from "@/components/item-emoji";
import { MeshBackground } from "@/components/mesh-background";
import {
  RangePicker,
  RANGES,
  withinRange,
  type Range,
} from "@/components/range-picker";
import { CARBON_COLORS, heavyHitters } from "@/lib/eco";
import { haptics } from "@/lib/haptics";
import { ecoScoreFor } from "@/lib/item-carbon";
import { isResting } from "@/lib/pantry-intel";
import {
  bandForRegion,
  inSeason,
  PRODUCE_EMOJI,
  type SeasonalProduce,
} from "@/lib/seasonal";
import {
  cachedSwaps,
  fetchSwaps,
  hydrateSwaps,
  rungBand,
  scoresLighter,
  type SwapResult,
  type SwapRung,
} from "@/lib/swaps";
import { useHomeListAdd } from "@/lib/use-home-list-add";
import { useLocale } from "@/store/locale";
import { usePantryIntel } from "@/store/pantry-intel";
import { radii, spacing, type, useTheme } from "@/theme";

/**
 * The Climate Mix, in full: the score, the heavy things you buy, and what is
 * good right now.
 *
 * ---------------------------------------------------------------------------
 * Pull, never push
 * ---------------------------------------------------------------------------
 *
 * lib/eco.ts records that a suggested-substitutions feature was built here once
 * and deleted, because "generic advice is noise… the lecture is the part people
 * uninstall over". That judgement stands and this page is built around it
 * rather than against it.
 *
 * The difference is who starts the conversation. The deleted version showed
 * everyone the same eight swaps unasked. Here the rows are the reader's OWN
 * purchases, they say nothing but what was bought, and the alternatives exist
 * only behind a deliberate tap on one of them. A reader who never taps is never
 * advised — they just see what they buy. That is why the hint under a row reads
 * "tap for lighter alternatives" and not "try swapping this".
 *
 * The same rule shapes the copy inside: the three rungs are names and a badge,
 * with no reasons, no targets and no encouragement. A shopper who opens the row
 * has already had the thought; finishing it for them is the part that grates.
 */

/** Which section a row belongs to. Sections are fixed, so this is a union. */
type Part = "heavy" | "season";

/**
 * Columns in the seasonal grid.
 *
 * Two, not three: the cell holds an emoji, a dot and a name that has to survive
 * German and Polish — "junge Kartoffeln", "fasolka szparagowa" — and at a third
 * of the width those wrap to three lines or truncate. Two also divides six
 * evenly, so the section ends on a full row.
 *
 * check-eco asserts every month names exactly six, which is what keeps that
 * true.
 */
const SEASON_COLUMNS = 2;

export default function ClimateScreen() {
  const { colors } = useTheme();
  /*
   * The window the card was showing, handed over on the way in, and adjustable
   * here afterwards.
   *
   * Read defensively rather than cast: route params arrive as strings from a URL
   * and a deep link can carry anything. An unknown value falls back to the same
   * default the card starts on, so a bad link shows the ordinary screen instead
   * of an empty one.
   */
  const params = useLocalSearchParams<{ range?: string }>();
  const [range, setRange] = useState<Range>(
    (RANGES as readonly string[]).includes(params.range ?? "")
      ? (params.range as Range)
      : "month",
  );
  const { t, language, region } = useLocale();
  const { stats, purchases } = usePantryIntel();
  const insets = useSafeAreaInsets();
  const { addToHomeList } = useHomeListAdd();

  useEffect(() => {
    void hydrateSwaps();
  }, []);

  // Quantised to the hour: `inSeason` asks which month it is, and a fresh
  // Date.now() every render would make the memos below dependencies of the
  // clock. Same reasoning as the Insights tab's minute.
  const hour = Math.floor(Date.now() / 3_600_000);
  const now = useMemo(() => hour * 3_600_000, [hour]);

  const tracked = useMemo(
    () => Object.values(stats).filter((s) => !isResting(s)),
    [stats],
  );

  /*
   * The PURCHASE LOG, not the pantry, and the distinction is the whole reason
   * this is written out rather than reaching for `stats`.
   *
   * The card this page opens from scores `ecoPurchases` — one entry per logged
   * purchase, so buying cheese four times counts four times. Scoring the pantry
   * instead counts each tracked item once, which is a different question with a
   * different answer: the first build of this page did exactly that and would
   * have shown a different number under the same title, one tap apart.
   *
   * `category` falls back to the pantry only when the log has none, matching
   * the card: the log has carried its own since 0023, and the recorded category
   * is the one the user may have corrected by hand.
   */
  const statsByKey = useMemo(() => {
    const m = new Map<string, (typeof tracked)[number]>();
    for (const s of tracked) m.set(s.key, s);
    return m;
  }, [tracked]);

  const allPurchases = useMemo(
    () =>
      purchases.map((p) => ({
        name: p.name,
        category: p.category ?? statsByKey.get(p.key)?.category ?? null,
        store: p.store,
        at: p.at,
        bio: p.bio,
      })),
    [purchases, statsByKey],
  );

  // Scoped like the card, and to the same window: the count is PURCHASES, so
  // unscoped it only ever climbs and describes the install rather than the shop.
  const ecoPurchases = useMemo(
    () => withinRange(allPurchases, range, now),
    [allPurchases, range, now],
  );

  const eco = useMemo(
    () =>
      ecoScoreFor(
        ecoPurchases.map((p) => ({
          name: p.name,
          category: p.category ?? ("other" as ItemCategory),
          bio: p.bio,
        })),
      ),
    [ecoPurchases],
  );

  // Same array the score reads, so a heavy hitter is always one of the
  // purchases the number above it was computed from.
  const heavy = useMemo(() => heavyHitters(ecoPurchases), [ecoPurchases]);

  // The reader's own climate band, not one calendar for the continent: a Finn
  // and a Sicilian do not have the same June. See lib/seasonal.ts.
  const season = useMemo(
    () => inSeason(new Date(now), bandForRegion(region)),
    [now, region],
  );

  /** The one open row, by name. Null when everything is closed. */
  const [openName, setOpenName] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<Record<string, SwapResult>>({});

  const toggle = (name: string) => {
    haptics.tick();
    // The accordion, and the "close the other one" rule, in one line: setting a
    // new name closes whatever was open because only one can be the open one.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = openName === name ? null : name;
    setOpenName(next);
    // An 'error' is not an answer, so reopening the row asks again. A cached
    // 'none' or a real set of rungs is, and does not.
    if (!next || (swaps[next] !== undefined && swaps[next] !== "error")) return;

    const cached = cachedSwaps(name, language);
    if (cached) {
      setSwaps((prev) => ({ ...prev, [name]: cached }));
      return;
    }
    void fetchSwaps(name, language).then((res) => {
      // Straight into state whichever it is: the row has to stop spinning even
      // when the answer is "nothing" or "could not ask". A spinner that never
      // ends is the worst way to say either.
      setSwaps((prev) => ({ ...prev, [name]: res }));
    });
  };

  const sections = useMemo(() => {
    const out: { part: Part; data: string[][] }[] = [];
    /*
     * Both sections carry ARRAYS of names, so one renderItem can serve a full
     * -width row and a grid row without a second data shape.
     *
     * Heavy hitters stay one per row: the row opens into a three-rung accordion,
     * and two of those expanding side by side would fight for the width the
     * suggestions need. Seasonal produce is a name and an icon, which is exactly
     * what a half-width cell holds — and SectionList has no numColumns (that is
     * FlatList only), so the grid is made by chunking here, the same way
     * basket.tsx builds its two columns.
     */
    // [name, category] — the category so the row's emoji can resolve properly.
    // It used to pass a hardcoded "other", whose glyph is 🛒, so every heavy item
    // the emoji tables did not recognise drew a shopping cart.
    if (heavy.length > 0) {
      out.push({ part: "heavy", data: heavy.map((h) => [h.name, h.category]) });
    }
    if (season.length > 0) {
      const rows: string[][] = [];
      for (let i = 0; i < season.length; i += SEASON_COLUMNS) {
        rows.push([...season.slice(i, i + SEASON_COLUMNS)]);
      }
      out.push({ part: "season", data: rows });
    }
    return out;
  }, [heavy, season]);

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={[type.h2, { color: colors.ink }]}>
              {t("eco.cardTitle")}
            </Text>
            {/* The card's own count, verbatim. Same number under the same title
                on both sides of the tap. */}
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("eco.cardHint", { count: eco.total })}
            </Text>
          </View>
          <RangePicker value={range} onChange={setRange} />
        </View>

        {eco.score == null ? (
          <EmptyState
            icon="leaf-outline"
            title={t("climate.emptyTitle")}
            body={t("climate.emptyBody")}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(row, i) => `${row.join("|")}-${i}`}
            stickySectionHeadersEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.list,
              // Clear of the system gesture bar: this route covers the tab bar,
              // so the inset is all that is under the last row.
              { paddingBottom: insets.bottom + spacing.xxl },
            ]}
            ListHeaderComponent={<Hero eco={eco} />}
            renderSectionHeader={({ section }) => (
              /* `over="mesh"` is the translucent fill, not the opaque one: rows
                 should be visible sliding under the heading, which is the whole
                 point of a sticky one. On iOS Frosted is a real blur; on
                 Android it is a 90% wash, because a live blur there costs a
                 full-screen snapshot per frame and this app spent a release
                 removing them — see scripts/check-blur.mjs. */
              <Frosted over="mesh" style={styles.sectionHead}>
                <Ionicons
                  name={section.part === "heavy" ? "flame-outline" : "sunny-outline"}
                  size={16}
                  color={section.part === "heavy" ? CARBON_COLORS.high : colors.accent}
                />
                <Text style={[type.label, { color: colors.ink }]}>
                  {t(section.part === "heavy" ? "climate.heavyTitle" : "climate.seasonTitle")}
                </Text>
              </Frosted>
            )}
            renderItem={({ item, index, section }) =>
              section.part === "heavy" ? (
                <HeavyRow
                  name={item[0]}
                  category={item[1] as ItemCategory}
                  order={index}
                  open={openName === item[0]}
                  swaps={swaps[item[0]]}
                  onToggle={() => toggle(item[0])}
                  onAdd={(alt) => {
                    haptics.success();
                    // The rung's real category, so the item lands classified and
                    // does NOT trigger a categorize call — resolveIfUnknown fires
                    // precisely on "unknown name, category other", which is what
                    // this used to pass.
                    //
                    // No list picker fallback on purpose: this is a browsing
                    // screen, and a modal asking "which list?" would interrupt
                    // the reading it exists for. addToHomeList returns false only
                    // when there is no list at all, which the Insights tab cannot
                    // be reached without.
                    addToHomeList(alt.name, alt.category ?? "other");
                  }}
                />
              ) : (
                <SeasonGridRow produce={item} order={index} />
              )
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

/* ------------------------------------------------------------------- hero */

/** Below this the score is not "green" and the leaf does not animate. */
const GREEN_SCORE = 70;

function Hero({ eco }: { eco: ReturnType<typeof ecoScoreFor> }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const green = (eco.score ?? 0) >= GREEN_SCORE;

  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.hero}>
      <View style={styles.scoreRow}>
        <Text style={[type.display, { color: colors.ink }]}>{eco.score}</Text>
        <Text style={[type.body, { color: colors.muted }]}>
          {t("eco.outOf")}
        </Text>
        {green && <Sparkle />}
      </View>
      <EcoBar shares={eco.shares} counts={eco.counts} />
    </Animated.View>
  );
}

/**
 * A leaf that breathes, for a score in the green.
 *
 * Opacity and scale only, on the UI thread, on one view — the cheapest kind of
 * loop there is. This app has a hard budget rule about continuous animation
 * (see components/frosted.tsx: an always-on pre-draw listener saturated the UI
 * thread and made every other animation stall), so a celebration has to cost
 * almost nothing or not exist. Two interpolated properties on a single node
 * costs almost nothing.
 */
function Sparkle() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
    transform: [{ scale: 0.92 + pulse.value * 0.12 }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="leaf" size={22} color={CARBON_COLORS.low} />
    </Animated.View>
  );
}

/* -------------------------------------------------------------- the rows */

function HeavyRow({
  name,
  category,
  order,
  open,
  swaps,
  onToggle,
  onAdd,
}: {
  name: string;
  /** The purchases' own category, so the emoji can fall back to something true. */
  category: ItemCategory;
  order: number;
  open: boolean;
  /** undefined = not asked yet; otherwise see SwapResult. */
  swaps: SwapResult | undefined;
  onToggle: () => void;
  onAdd: (alt: SwapRung) => void;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(order, 10) * 30).duration(240)}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.row}
      >
        <View style={[styles.tierDot, { backgroundColor: CARBON_COLORS.high }]} />
        <ItemEmoji name={name} category={category} />
        <View style={styles.grow}>
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
            {t("climate.tapForSwaps")}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.muted}
        />
      </Pressable>

      {open && (
        <View style={[styles.drawer, { backgroundColor: colors.accentSoft }]}>
          {swaps === undefined ? (
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("climate.loading")}
            </Text>
          ) : swaps === "error" ? (
            /* Deliberately NOT the "nothing lighter" sentence. This one is
               about the app failing to ask, and saying otherwise would be
               confidently wrong about the food. Tapping the row again retries,
               which the copy says out loud. */
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("climate.swapsFailed")}
            </Text>
          ) : swaps === "none" ? (
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("climate.noSwaps")}
            </Text>
          ) : (
            swaps.tiers.map((alt, i) => {
              /*
               * The badge is EARNED, not assigned by position.
               *
               * It used to read `climate.tier${i + 1}` — rung 1 said "Good
               * impact drop" because it was first. Three suggestions shipped
               * where that was false and the app knew it was false: ghee for
               * butter, dark chocolate and cocoa powder for chocolate, each
               * scored `high` by the same table that had just scored the item
               * above them `high`. The row promised a fall the score could not
               * show.
               *
               * So the ladder label is used only when the drop is real. When it
               * is not, the rung's OWN band is shown instead — the same
               * "High impact" / "Medium impact" wording as the mix above and the
               * dot on the row, so the reader gets the app's honest opinion of
               * the suggestion rather than a claim about it. That also reads as
               * the explanation it is: a substitute still marked high impact is
               * visibly not the win, without a word of lecture.
               *
               * Nothing at all when the band is unknown. An empty line is a
               * worse row; an invented one is a worse app.
               */
              const band = rungBand(alt);
              const badge = scoresLighter(name, alt)
                ? t(`climate.tier${i + 1}`)
                : band
                  ? t(`eco.tier.${band}`)
                  : null;

              return (
              <View key={alt.name} style={styles.swapRow}>
                {/* The rung's own category, not "other". That constant was why
                    every unrecognised suggestion drew the fallback cart: 🛒 is
                    what `other` resolves to. ItemEmoji still reads the lexicon
                    first, which fetchSwaps has just seeded with the emoji the
                    same call returned. */}
                <ItemEmoji name={alt.name} category={alt.category ?? "other"} />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                    {alt.name}
                  </Text>
                  {badge !== null && (
                    <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                      {badge}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={() => onAdd(alt)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t("climate.addAlt", { item: alt.name })}
                  style={[styles.add, { borderColor: colors.accent }]}
                >
                  <Ionicons name="add" size={18} color={colors.accent} />
                </Pressable>
              </View>
              );
            })
          )}
        </View>
      )}
    </Animated.View>
  );
}

/**
 * One row of the seasonal grid — two produce cells, or one plus a spacer.
 *
 * The animation is on the ROW rather than the cell, so a row arrives as a unit:
 * two cells entering a frame apart side by side reads as a stutter, not a
 * cascade. Same reasoning, and the same delay curve, as basket.tsx.
 */
function SeasonGridRow({ produce, order }: { produce: string[]; order: number }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(order, 10) * 30).duration(240)}
      style={styles.seasonRow}
    >
      {produce.map((key) => (
        <View key={key} style={styles.seasonCell}>
          <View style={[styles.tierDot, { backgroundColor: CARBON_COLORS.low }]} />
          {/* An explicit glyph, because ItemEmoji's own lookup matches the
              TRANSLATED name and not one seasonal word is in its table — so every
              row drew the fruit_veg fallback and "plums" came out as a head of
              lettuce. PRODUCE_EMOJI is keyed by the stable produce key, so one
              entry is right in all seven languages. */}
          <ItemEmoji
            name={key}
            category="fruit_veg"
            glyph={PRODUCE_EMOJI[key as SeasonalProduce]}
          />
          {/* Two lines, like the basket's cells: at half width a single line
              truncates "junge Kartoffeln" and "fasolka szparagowa", which are
              ordinary words rather than edge cases. */}
          <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={2}>
            {t(`eco.season.${key}`)}
          </Text>
        </View>
      ))}
      {/* Holds a lone last cell at half width instead of letting it stretch
          across the row and break the column the eye is following. */}
      {produce.length < SEASON_COLUMNS && <View style={styles.seasonCell} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: "transparent" },
  grow: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg },
  // Room under the score before the first heading, so the hero reads as its own
  // thing rather than as the top of the first section.
  hero: { gap: spacing.md, paddingBottom: spacing.xl },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    // Bleeds through the list's own horizontal padding, or rows slide past
    // uncovered in the margins either side of the heading.
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  seasonRow: {
    flexDirection: "row",
    // flex-start, so a two-line name in one cell does not drag the other cell's
    // dot and emoji down to meet it.
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // Equal halves whatever the words: basis 0 is what makes the two share the row
  // evenly, and it is safe here precisely because the parent row is full-width.
  // (In a content-sized parent the same line collapses the cell to nothing —
  // which is exactly how the pantry-mix legend lost its labels.)
  seasonCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // The soft tint that says "this belongs to the row above". accentSoft rather
  // than a new colour: it is already the app's "this is a related surface" fill.
  drawer: {
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  swapRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  add: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
