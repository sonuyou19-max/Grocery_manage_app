import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { Card } from '@/components/card';
import { EcoBar } from '@/components/eco-bar';
import { InsightsTeaser } from '@/components/insights-teaser';
import { PlusCard } from '@/components/plus-card';
import { Screen } from '@/components/screen';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { WeeklyRecapCard } from '@/components/weekly-recap-card';
import { SpendTrendChart } from '@/components/spend-trend-chart';
import { categoryLabel, CATEGORY_ORDER } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import { heaviestStaple, weeklyEco, type EcoScore, type EcoWeek, type HeaviestStaple } from '@/lib/eco';
import { ecoScoreFor } from '@/lib/item-carbon';
import { basketBalance, GROUP_COLORS, groupLabel, type BalanceSlice } from '@/lib/nutrition';
import { isResting } from '@/lib/pantry-intel';
import { inSeason } from '@/lib/seasonal';
import { cheaperStoreHints, spendByStore } from '@/lib/price-intel';
// `priced` is imported under a longer name on purpose. As `priced` it sat one
// character away from the `pricedItems` array below, and `priced.length` — the
// arity of a function, which is 1 — type-checked perfectly as a number and shipped
// "1 priced" onto a Spending card totalling €0.00. See the card itself.
import { priced as pricedPurchases, priceMoves, spendTrend, weekStartOf } from '@/lib/purchase-log';
import { supermarketLabel } from '@/lib/supermarkets';
import { usePlusGate } from '@/lib/plus-gate';
import { useAuth } from '@/store/auth';
import { useEntitlement } from '@/store/entitlement';
import { useGroceries } from '@/store/groceries';
import { useLocale } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { radii, spacing, type, useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Insights: a feed of what the app has learned about your shopping. Basket
 * balance (a rough food-group mix), your staples, and — once you log prices —
 * spending. Everything degrades gracefully while there isn't much data yet.
 *
 * Three states, not two:
 *
 *   guest   the whole tab is a blurred teaser — there is nothing of theirs to
 *           show, so the question being answered is "what is this for"
 *   free    their own real figures, for the last few weeks, with the three
 *           cards that need a longer history replaced by one that explains them
 *   Plus    everything
 *
 * The middle state only exists once billing is switched on server-side; until
 * then the tier is off and free reads identically to Plus. See lib/plus-gate.ts.
 *
 * Split into two components rather than an early return inside one, because
 * the screen below is full of useMemo and a conditional return above them
 * would change the hook count between renders — React throws "rendered fewer
 * hooks than expected" the moment a guest signs in, which is precisely the
 * transition this feature exists to encourage.
 *
 * The split also buys the stronger property: a guest's figures are never
 * computed at all, so no rendering slip can leak them through the blur.
 */
export default function InsightsScreen() {
  const { user } = useAuth();
  if (!user) return <InsightsTeaser />;
  return <SignedInInsights />;
}

function SignedInInsights() {
  const { colors } = useTheme();
  const { t, money } = useLocale();
  const { lists } = useGroceries();
  const { stats, purchases } = usePantryIntel();
  const { historyCutoff } = useEntitlement();
  // The one definition, shared with the Pantry, the dashboard and the Vibe
  // Check. See lib/plus-gate.ts for why it is not two lines written here.
  const { locked } = usePlusGate();
  const perUnitPrice = usePerUnitPrice();

  // The purchase log outlives the lists it came from, so these are the only
  // figures here that describe weeks rather than what's on a list right now.
  // Recomputed against a single `now` so the chart and the copy agree.
  const now = Date.now();

  /**
   * How many weeks the free tier is showing, derived from the server's own
   * cutoff rather than repeated as a constant here. If the number in the SQL
   * changes, the sentence on screen changes with it.
   */
  const freeWeeks = Math.max(
    1,
    Math.round((now - (historyCutoff ?? now)) / (7 * 24 * 60 * 60 * 1000)),
  );
  // Eight weeks of bars over a four-week log would be half an empty chart, so
  // the axis follows whatever history this account actually has.
  const trend = useMemo(
    () => spendTrend(purchases, now, locked ? 4 : 8),
    [purchases, now, locked],
  );
  const moves = useMemo(() => priceMoves(purchases), [purchases]);
  const hasTrend = trend.weeks.some((w) => w.count > 0);

  const cart = useMemo(
    () => basketBalance(lists.flatMap((l) => l.items).map((it) => ({ name: it.name, category: it.category }))),
    [lists],
  );
  // Resting items are out of every reading here: they're history Korb keeps but
  // no longer tracks, so counting them would describe a pantry you don't have.
  const tracked = useMemo(() => Object.values(stats).filter((s) => !isResting(s)), [stats]);

  const pantry = useMemo(
    () => basketBalance(tracked.map((s) => ({ name: s.display, category: s.category }))),
    [tracked],
  );

  const staples = useMemo(
    () =>
      tracked
        .filter((s) => s.sampleCount >= 1)
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .slice(0, 5),
    [tracked],
  );

  /** Category per item, looked up from the pantry — the log doesn't carry one. */
  const statsByKey = useMemo(() => {
    const m = new Map<string, (typeof tracked)[number]>();
    for (const s of tracked) m.set(s.key, s);
    return m;
  }, [tracked]);

  /**
   * Money comes from the PURCHASE LOG, never from the lists.
   *
   * This read `lists.flatMap(...)` — the items currently sitting on a list —
   * which meant editing a price after checking off silently rewrote history,
   * and deleting a list erased the spending that happened on it. What you spent
   * last Tuesday is a fact about last Tuesday; it must not move because a row
   * was edited today.
   *
   * Quantity and unit travel with the price. They used to be dropped here,
   * which is what made cheaperStoreHints compare a 1 L bottle against a 2 L one
   * and name the dearer shop as the bargain — the helper could not have been
   * right, because the data it needed never arrived.
   */
  const pricedItems = useMemo(
    () =>
      // `pricedPurchases` has already dropped every null price, so the narrowing
      // is a fact about the filter rather than an assumption about the data.
      pricedPurchases(purchases).map((p) => ({
        name: p.name,
        category: statsByKey.get(p.key)?.category ?? ('other' as ItemCategory),
        priceCents: p.priceCents as number,
        store: p.store,
        // Carried through, not dropped. Without these the cheaper-elsewhere
        // card compared €1.20 for 1 L against €2.00 for 2 L and named the
        // dearer shop as the bargain. See lib/price-intel.ts.
        quantity: p.quantity,
        unit: p.unit,
      })),
    [purchases, statsByKey],
  );

  const spendTotal = pricedItems.reduce((sum, it) => sum + it.priceCents, 0);
  const spendByCat = useMemo(() => {
    const m = new Map<ItemCategory, number>();
    for (const it of pricedItems) m.set(it.category, (m.get(it.category) ?? 0) + it.priceCents);
    return CATEGORY_ORDER.map((c) => ({ category: c, cents: m.get(c) ?? 0 }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents);
  }, [pricedItems]);
  const storeSpend = useMemo(() => spendByStore(pricedItems), [pricedItems]);
  const cheaper = useMemo(() => cheaperStoreHints(pricedItems), [pricedItems]);

  /**
   * The eco figures, all from the purchase log rather than the live lists.
   *
   * Same reasoning as the money above: what you bought last Tuesday is a fact
   * about last Tuesday, and a score that moved because somebody edited a row
   * today would be unimprovable by definition. The live-list read lives on the
   * list screen, where it is about the shop you are doing right now.
   *
   * `category` is looked up from the pantry only as a fallback — the log has
   * carried its own since 0023, and the item's recorded category is the one the
   * user may have corrected by hand.
   */
  const ecoPurchases = useMemo(
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
  const eco = useMemo(
    () =>
      ecoScoreFor(
        ecoPurchases.map((p) => ({
          name: p.name,
          category: p.category ?? ('other' as ItemCategory),
          bio: p.bio,
        })),
      ),
    [ecoPurchases],
  );
  const ecoWeeks = useMemo(
    () => weeklyEco(ecoPurchases, now, weekStartOf, locked ? 4 : 8),
    [ecoPurchases, now, locked],
  );
  /**
   * The one heavy thing this household buys most. Null until it has been bought
   * three times — below that it is a meal, not a habit, and the sentence says
   * "regularly" out loud.
   */
  const heaviest = useMemo(() => heaviestStaple(ecoPurchases), [ecoPurchases]);

  /** Two scored weeks is the minimum that can show a direction. */
  const ecoScored = ecoWeeks.filter((w) => w.score != null);

  return (
    <Screen title={t('tabs.insights')} subtitle={t('insights.subtitle')}>
      {/* Plus. The recap is the only card here that costs money to produce —
          one AI call per household per week — so it is also the one whose
          price and paid status line up without argument. */}
      {!locked && <WeeklyRecapCard />}

      {cart.total > 0 && (
        <Card>
          <CardHead
            icon="nutrition-outline"
            title={t('insights.basketTitle')}
            hint={t('insights.basketHint', { count: cart.total })}
          />
          <BalanceBar slices={cart.slices} />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.basketNote')}</Text>
        </Card>
      )}

      {/* FREE, and the only new card that is.
          The impact mix is what makes the dots on the list mean something —
          without a place that adds them up, a coloured dot is decoration. It is
          also the hook: somebody has to see the feature work before there is
          any reason to pay for its history. See lib/eco.ts for why the number
          is what it is. */}
      {eco.score != null && <EcoCard eco={eco} heaviest={heaviest} now={now} />}

      {/* Plus: HIDE, not prompt. A pantry mix is a single bar and a legend —
          there is no shell worth leaving behind, and a locked one would just be
          a rectangle asking for money in the middle of the reader's own
          figures. The Plus card at the foot of the tab makes the offer once. */}
      {!locked && pantry.total > 0 && (
        <Card>
          <CardHead
            icon="file-tray-full-outline"
            title={t('insights.pantryMixTitle')}
            hint={t('insights.pantryMixHint', { count: pantry.total })}
          />
          <BalanceBar slices={pantry.slices} />
        </Card>
      )}

      {/* Plus: HIDE, same reasoning. Staples is a list of names; without the
          names there is nothing to show. */}
      {!locked && staples.length > 0 && (
        <Card>
          <CardHead icon="repeat-outline" title={t('insights.staplesTitle')} hint={t('insights.staplesHint')} />
          {staples.map((s) => (
            <View key={s.key} style={styles.row}>
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.display}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>
                {t('insights.boughtTimes', { count: s.sampleCount + 1 })}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* No per-item purchase history here. The Pantry already gives every item
          a history behind a tap, and a second copy on this tab was the same
          data twice — one row per item-and-shop, which also grew without bound
          and made Insights unreadable the more you shopped. Insights answers
          "where is my money going"; the Pantry answers "what happened with this
          one thing". See components/purchase-ledger.tsx for the surviving one. */}

      {/* Spend across weeks, from the purchase log — this is the only card that
          survives deleting the list the prices were logged on. */}
      {hasTrend && (
        <Card>
          <CardHead
            icon="stats-chart-outline"
            title={t('insights.trendTitle')}
            hint={t('insights.trendWeeks', { count: trend.weeks.length })}
          />
          <View style={styles.heroRow}>
            <Text style={[type.h1, { color: colors.ink }]}>{money(trend.averageCents)}</Text>
            <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendPerWeek')}</Text>
          </View>
          {trend.weekOverWeek != null && (
            <View style={styles.deltaRow}>
              <Ionicons
                name={trend.weekOverWeek >= 0 ? 'arrow-up' : 'arrow-down'}
                size={14}
                // Neither direction is good or bad — spending more isn't a
                // failure — so this stays ink, not a status colour.
                color={colors.muted}
              />
              <Text style={[type.sub, { color: colors.muted }]}>
                {t(trend.weekOverWeek >= 0 ? 'insights.trendUp' : 'insights.trendDown', {
                  percent: Math.abs(Math.round(trend.weekOverWeek * 100)),
                })}
              </Text>
            </View>
          )}
          <SpendTrendChart
            weeks={trend.weeks}
            currentWeekStart={weekStartOf(now)}
            peakWeekStart={trend.peak?.weekStart ?? null}
            averageCents={trend.averageCents}
          />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendCaveat')}</Text>
        </Card>
      )}

      {/* Items that cost more (or less) than they usually do. Plus: "usually"
          is a claim about the past, and four weeks is not enough past to make
          it. */}
      {!locked && moves.length > 0 && (
        <Card>
          <CardHead
            icon="swap-vertical-outline"
            title={t('insights.movesTitle')}
            hint={t('insights.movesHint')}
          />
          {moves.slice(0, 5).map((m) => (
            <View key={m.key} style={styles.row}>
              <Ionicons
                name={m.change > 0 ? 'trending-up' : 'trending-down'}
                size={18}
                color={m.change > 0 ? colors.warn : colors.accent}
              />
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {m.name}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                {t(m.change > 0 ? 'insights.moveUp' : 'insights.moveDown', {
                  percent: Math.abs(Math.round(m.change * 100)),
                  price: money(m.latestCents),
                  usual: money(m.baselineCents),
                })}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* pricedItems, the array — NOT the `priced` filter it came from.
          `priced.length` is a function's arity: permanently 1, never 0, and a
          perfectly valid number as far as TypeScript is concerned. So this card
          rendered on every account that had never entered a price, the empty
          state two branches down was unreachable, and the header read "1 priced"
          above a total of €0.00. */}
      {pricedItems.length > 0 ? (
        <Card>
          <CardHead
            icon="cash-outline"
            title={t('insights.spendingTitle')}
            hint={t('insights.spendingHint', { count: pricedItems.length })}
          />
          <View style={styles.spendTotal}>
            <Text style={[type.sub, { color: colors.muted }]}>{t('insights.totalLogged')}</Text>
            <Text style={[type.h2, { color: colors.ink }]}>{money(spendTotal)}</Text>
          </View>
          {spendByCat.map((x) => (
            <View key={x.category} style={styles.row}>
              <Text style={[type.sub, styles.grow, { color: colors.ink }]}>{categoryLabel(x.category, t)}</Text>
              <Text style={[type.sub, { color: colors.muted }]}>{money(x.cents)}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <CardHead icon="pricetag-outline" title={t('insights.spendingTitle')} hint={t('insights.spendingOptional')} />
          <Text style={[type.sub, { color: colors.muted }]}>{t('insights.spendingEmpty')}</Text>
        </Card>
      )}

      {/* Spend per store — only when at least one priced item has a store. */}
      {storeSpend.some((s) => s.store != null) && (
        <Card>
          <CardHead icon="storefront-outline" title={t('insights.whereTitle')} hint={t('insights.whereHint')} />
          {storeSpend.map((s) => (
            <View key={s.store ?? 'none'} style={styles.row}>
              {s.store ? (
                <SupermarketBadge store={s.store} size={20} />
              ) : (
                <Ionicons name="pricetag-outline" size={20} color={colors.muted} />
              )}
              <Text style={[type.sub, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {s.store ? supermarketLabel(s.store) ?? s.store : t('insights.noStore')}
              </Text>
              <Text style={[type.sub, { color: colors.muted }]}>{money(s.cents)}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Cheaper elsewhere — same item priced at 2+ stores. Plus: same reason.
          Comparing shops needs enough trips to have visited more than one.

          The figures are PER UNIT whenever the user gave a quantity, so they
          are labelled as such — "€1.00 / L" is a different claim from "€1.00",
          and somebody who logged a 2 L bottle has to be able to tell which one
          they are reading. */}
      {!locked && cheaper.length > 0 && (
        <Card>
          <CardHead icon="trending-down-outline" title={t('insights.cheaperTitle')} hint={t('insights.cheaperHint')} />
          {cheaper.slice(0, 6).map((h) => (
            <View key={h.name} style={styles.hintRow}>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                {h.name}
              </Text>
              <View style={styles.hintDetail}>
                <SupermarketBadge store={h.cheapStore} size={16} />
                {/* The saving is the point of the row, so the winning price is
                    the only thing here set in a bold weight. The two prices
                    were the same size, the same weight and one step apart in
                    colour, which made the reader compare two numbers instead of
                    being handed the answer. */}
                <Text style={[type.sub, styles.cheapPrice, { color: colors.accent }]}>
                  {t('insights.cheaperAt', {
                    price: perUnitPrice(h.cheapCents, h.perUnit),
                    store: supermarketLabel(h.cheapStore) ?? h.cheapStore,
                  })}
                </Text>
                {/* Still legible — it is half the comparison and removing it
                    would leave a price with nothing to be cheaper THAN — but
                    set back so the eye reaches it second. */}
                <Text style={[type.sub, styles.dearPrice, { color: colors.muted }]}>
                  {t('insights.cheaperVs', { price: perUnitPrice(h.dearCents, h.perUnit) })}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* Plus: HIDE. A trend needs weeks, and the whole thing a free account is
          missing here IS the weeks — a locked shell would be an empty chart
          with a price on it. */}
      {!locked && ecoScored.length >= 2 && (
        <Card>
          <CardHead
            icon="trending-up-outline"
            title={t('eco.trendTitle')}
            hint={t('eco.trendHint', { count: ecoScored.length })}
          />
          <EcoTrend weeks={ecoWeeks} />
          {(() => {
            // First scored week against last. Not "this week vs last week":
            // one quiet week would swamp it, and the card is about a direction
            // over the window, which is what the bars behind it show.
            const first = ecoScored[0].score as number;
            const last = ecoScored[ecoScored.length - 1].score as number;
            const delta = last - first;
            if (Math.abs(delta) < 3) {
              return <Text style={[type.sub, { color: colors.muted }]}>{t('eco.trendFlat')}</Text>;
            }
            return (
              <View style={styles.row}>
                <Ionicons
                  name={delta > 0 ? 'arrow-up' : 'arrow-down'}
                  size={14}
                  color={delta > 0 ? colors.accent : colors.muted}
                />
                <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
                  {t(delta > 0 ? 'eco.trendUp' : 'eco.trendDown', { points: Math.abs(delta) })}
                </Text>
              </View>
            );
          })()}
        </Card>
      )}

      {/* Last, where the three cards it stands in for would have been — so it
          is found at the end of the reader's own figures rather than in front
          of them. A free tab still ends with something to read. */}
      {locked && <PlusCard freeWeeks={freeWeeks} />}
    </Screen>
  );
}

/**
 * A price, labelled with the unit it is per — or plain, when it isn't.
 *
 * "€1.00" and "€1.00 / L" are different claims, and the cheaper-elsewhere card
 * shows whichever the underlying comparison actually made. Assembled here
 * rather than in price-intel because it needs the locale's own money
 * formatter, which is a screen concern.
 */
function usePerUnitPrice() {
  const { money } = useLocale();
  return (cents: number, unit: string | null) =>
    unit ? `${money(cents)} / ${unit}` : money(cents);
}

function CardHead({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.cardHead}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={[type.body, styles.grow, { color: colors.ink }]}>{title}</Text>
      {hint ? <Text style={[type.sub, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * The free climate card: the score, what it is made of, and two sentences.
 *
 * ---------------------------------------------------------------------------
 * Why the methodology note moved behind an (i)
 * ---------------------------------------------------------------------------
 *
 * "Counted by item, not by weight" is the most important sentence on the card
 * and also the one nobody needs twice. Printed permanently it was a caveat
 * competing with the finding, and once two more lines arrived below it the card
 * was four sentences of hedging around one number. Behind the (i) it is still
 * one tap from anybody who wants to know how the figure is made — and the same
 * gesture as the basket strip on the list screen, so the pattern is learned
 * once.
 *
 * ---------------------------------------------------------------------------
 * The card deliberately ends on something good
 * ---------------------------------------------------------------------------
 *
 * Score, mix, then "the heaviest thing you buy" — three readings in a row that
 * are, at best, neutral. A feature whose every sentence is a shortcoming is one
 * people stop opening, so the last line is what is in season: true, useful to
 * somebody who has never thought about carbon, and the only place here where
 * Korb gets to be pleased about something.
 */
function EcoCard({
  eco,
  heaviest,
  now,
}: {
  eco: EcoScore;
  heaviest: HeaviestStaple | null;
  now: number;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const [explained, setExplained] = useState(false);
  const season = inSeason(new Date(now));

  return (
    <Card>
      <View style={styles.cardHead}>
        <Ionicons name="leaf-outline" size={18} color={colors.accent} />
        <Text style={[type.label, styles.grow, { color: colors.ink }]}>{t('eco.cardTitle')}</Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          {t('eco.cardHint', { count: eco.total })}
        </Text>
        <Pressable
          onPress={() => {
            haptics.tick();
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExplained((v) => !v);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('eco.whatIsThis')}
        >
          <Ionicons
            name={explained ? 'information-circle' : 'information-circle-outline'}
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </View>

      <View style={styles.heroRow}>
        <Text style={[type.h1, { color: colors.ink }]}>{eco.score}</Text>
        <Text style={[type.sub, { color: colors.muted }]}>{t('eco.outOf')}</Text>
      </View>
      <EcoBar shares={eco.shares} counts={eco.counts} />
      {explained && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('eco.cardNote')}</Text>
      )}

      {eco.bioCount > 0 && (
        /* Its own line, never folded into the bar. Organic is frequently higher
           carbon per kilo, so showing it as part of the impact mix would state
           something false; showing it beside is true and still gives credit. */
        <View style={styles.row}>
          <Ionicons name="leaf" size={16} color={colors.accent} />
          <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
            {t('eco.bioCount', { count: eco.bioCount })}
          </Text>
        </View>
      )}

      {/* A fact, with no instruction attached. See heaviestStaple in eco.ts for
          why there is no "try swapping" on the end of it. */}
      {heaviest && (
        <View style={styles.row}>
          <Ionicons name="arrow-up-circle-outline" size={16} color={colors.muted} />
          <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
            {t('eco.heaviest', { item: heaviest.name })}
          </Text>
        </View>
      )}

      {season.length > 0 && (
        <View style={styles.row}>
          <Ionicons name="sunny-outline" size={16} color={colors.accent} />
          <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
            {t('eco.inSeason', {
              items: season.map((k) => t(`eco.season.${k}`)).join(t('common.listJoin')),
            })}
          </Text>
        </View>
      )}
    </Card>
  );
}

/**
 * The eco score across weeks, as columns.
 *
 * Deliberately not the spend chart with different numbers. Spend has no ceiling
 * so its bars are scaled to the tallest; a score is out of 100, so the bars are
 * scaled to 100 and a tall bar means "close to as good as it gets" rather than
 * "the biggest of these". A week with no score draws a stub, matching the spend
 * chart's rule that an empty week is data rather than a gap.
 */
function EcoTrend({ weeks }: { weeks: EcoWeek[] }) {
  const { colors } = useTheme();
  const { t, language } = useLocale();
  const dayMonth = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });
  const first = weeks[0];

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.ecoPlot}>
        {weeks.map((w) => (
          <View key={w.weekStart} style={styles.ecoColumn}>
            <View
              style={{
                height: w.score == null ? 2 : Math.max(2, (w.score / 100) * 56),
                width: 14,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: w.score == null ? colors.line : colors.accent,
              }}
            />
          </View>
        ))}
      </View>
      <View style={[styles.ecoAxis, { backgroundColor: colors.line }]} />
      <View style={styles.ecoLabels}>
        <Text style={[type.sub, { color: colors.muted }]}>
          {first ? dayMonth.format(new Date(first.weekStart)) : ''}
        </Text>
        <Text style={[type.sub, { color: colors.muted }]}>{t('insights.trendThisWeek')}</Text>
      </View>
    </View>
  );
}

/** A stacked, weighted bar of food-group slices with a percentage legend. */
function BalanceBar({ slices }: { slices: BalanceSlice[] }) {
  const { colors } = useTheme();
  const { t } = useLocale();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.bar, { backgroundColor: colors.line }]}>
        {slices.map((s) => (
          <View key={s.group} style={{ flex: s.count, backgroundColor: GROUP_COLORS[s.group] }} />
        ))}
      </View>
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.group} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: GROUP_COLORS[s.group] }]} />
            <Text style={[type.sub, { color: colors.ink }]}>
              {groupLabel(s.group, t)} {Math.round(s.fraction * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  bar: { flexDirection: 'row', height: 16, borderRadius: radii.sm, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  ecoPlot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 56,
    gap: spacing.xs,
  },
  ecoColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  ecoAxis: { height: StyleSheet.hairlineWidth, borderRadius: radii.sm },
  ecoLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  spendTotal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.xs },
  // marginBottom, because the chart that follows draws its peak label at the
  // very top of its own box: without clearance the label sat on the baseline of
  // "a week, on average" and the two overlapped. flexWrap keeps the caption on
  // its own line when the amount is long or the translation is (pl:
  // "tygodniowo, średnio"), and alignItems baseline keeps them on one line when
  // it isn't.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  hintRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  hintDetail: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  cheapPrice: { fontWeight: '700' },
  /**
   * 0.9, and that is the floor rather than a taste call.
   *
   * `muted` on a card is 5.84:1. This text is 13px, so AA wants 4.5:1, which
   * leaves room for a fade to about 0.9 — at 0.75 it lands on 3.39:1 and fails.
   * Most of the separation in this row therefore comes from weight, not from
   * value: the cheap price is bold accent, this stays regular. Fading it
   * further would trade a readable comparison for a slightly prettier one.
   */
  dearPrice: { opacity: 0.9 },
});
