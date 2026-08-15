import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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
import { CARBON_COLORS, heavyHitters } from "@/lib/eco";
import { haptics } from "@/lib/haptics";
import { ecoScoreFor } from "@/lib/item-carbon";
import { isResting } from "@/lib/pantry-intel";
import { inSeason } from "@/lib/seasonal";
import { cachedSwaps, fetchSwaps, hydrateSwaps, type Swaps } from "@/lib/swaps";
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

export default function ClimateScreen() {
  const { colors } = useTheme();
  const { t, language } = useLocale();
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

  // The same figures the card shows, from the same source, so the score here
  // and the score there cannot disagree.
  const tracked = useMemo(
    () => Object.values(stats).filter((s) => !isResting(s)),
    [stats],
  );
  const eco = useMemo(
    () => ecoScoreFor(tracked.map((s) => ({ name: s.display, category: s.category }))),
    [tracked],
  );

  const heavy = useMemo(
    () =>
      heavyHitters(
        purchases.map((p) => ({
          name: p.name,
          category: p.category,
          store: p.store,
          at: p.at,
          bio: p.bio,
        })),
      ),
    [purchases],
  );

  const season = useMemo(() => inSeason(new Date(now)), [now]);

  /** The one open row, by name. Null when everything is closed. */
  const [openName, setOpenName] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<Record<string, Swaps | null>>({});

  const toggle = (name: string) => {
    haptics.tick();
    // The accordion, and the "close the other one" rule, in one line: setting a
    // new name closes whatever was open because only one can be the open one.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = openName === name ? null : name;
    setOpenName(next);
    if (!next || swaps[next] !== undefined) return;

    const cached = cachedSwaps(name, language);
    if (cached) {
      setSwaps((prev) => ({ ...prev, [name]: cached }));
      return;
    }
    void fetchSwaps(name, language).then((res) => {
      // Straight into state whether or not it worked: `null` is a real answer
      // ("nothing lighter to suggest") and the row must stop spinning either
      // way. A spinner that never ends is the worst way to say "no".
      setSwaps((prev) => ({ ...prev, [name]: res }));
    });
  };

  const sections = useMemo(() => {
    const out: { part: Part; data: string[] }[] = [];
    if (heavy.length > 0) out.push({ part: "heavy", data: heavy.map((h) => h.name) });
    if (season.length > 0) out.push({ part: "season", data: [...season] });
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
          <Text style={[type.h2, styles.grow, { color: colors.ink }]}>
            {t("eco.cardTitle")}
          </Text>
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
            keyExtractor={(row, i) => `${row}-${i}`}
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
                  name={item}
                  order={index}
                  open={openName === item}
                  swaps={swaps[item]}
                  onToggle={() => toggle(item)}
                  onAdd={(alt) => {
                    haptics.success();
                    // No list picker fallback here on purpose: this is a
                    // browsing screen, and throwing a modal over it to ask
                    // "which list?" would interrupt the reading it exists for.
                    // addToHomeList returns false only when there is no list at
                    // all, which the Insights tab cannot be reached without.
                    addToHomeList(alt, "other");
                  }}
                />
              ) : (
                <SeasonRow produce={item} order={index} />
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
  order,
  open,
  swaps,
  onToggle,
  onAdd,
}: {
  name: string;
  order: number;
  open: boolean;
  /** undefined = not asked yet, null = asked and there is nothing to suggest. */
  swaps: Swaps | null | undefined;
  onToggle: () => void;
  onAdd: (alt: string) => void;
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
        <ItemEmoji name={name} category="other" />
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
          ) : swaps === null ? (
            <Text style={[type.sub, { color: colors.muted }]}>
              {t("climate.noSwaps")}
            </Text>
          ) : (
            swaps.tiers.map((alt, i) => (
              <View key={alt} style={styles.swapRow}>
                <ItemEmoji name={alt} category="other" />
                <View style={styles.grow}>
                  <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                    {alt}
                  </Text>
                  <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                    {t(`climate.tier${i + 1}`)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onAdd(alt)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t("climate.addAlt", { item: alt })}
                  style={[styles.add, { borderColor: colors.accent }]}
                >
                  <Ionicons name="add" size={18} color={colors.accent} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      )}
    </Animated.View>
  );
}

function SeasonRow({ produce, order }: { produce: string; order: number }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const name = t(`eco.season.${produce}`);
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(order, 10) * 30).duration(240)}
      style={styles.row}
    >
      <View style={[styles.tierDot, { backgroundColor: CARBON_COLORS.low }]} />
      <ItemEmoji name={name} category="fruit_veg" />
      <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
        {name}
      </Text>
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
