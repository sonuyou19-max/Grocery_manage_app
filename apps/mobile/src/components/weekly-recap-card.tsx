import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { Card } from '@/components/card';
import { categoryLabel } from '@/lib/categorize';
import { ecoScoreFor } from '@/lib/item-carbon';
import { basketBalance, basketItems } from '@/lib/nutrition';
import { dueAt, isResting } from '@/lib/pantry-intel';
import { bandForRegion, inSeason } from '@/lib/seasonal';
import { recapRuns } from '@/lib/recap-markup';
import { supabase } from '@/lib/supabase';
import { useAppActive } from '@/lib/use-app-active';
import {
  generateRecap,
  getCachedRecap,
  getSharedRecap,
  setCachedRecap,
  setSharedRecap,
  weekKey,
  type RecapPayload,
} from '@/lib/weekly-recap';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';
import { useLocale } from '@/store/locale';
import { usePantryIntel } from '@/store/pantry-intel';
import { spacing, type, useTheme } from '@/theme';

const DAY = 86_400_000;

type Phase = 'empty' | 'loading' | 'ready' | 'error';

/**
 * The AI weekly recap card. Builds a small aggregate snapshot, asks the edge
 * function for a warm narrative, and caches it for the week so it regenerates
 * only ~once every 7 days (or when the user taps refresh). Degrades quietly if
 * the function isn't reachable.
 */
export function WeeklyRecapCard() {
  const { colors } = useTheme();
  const { t, language, region } = useLocale();
  const appActive = useAppActive();
  const { lists } = useGroceries();
  const { stats, purchases } = usePantryIntel();
  const { household, members } = useHousehold();

  const scope = household?.id ?? 'local';

  const payload = useMemo<RecapPayload>(() => {
    const now = Date.now();

    /*
     * Two sets, kept apart, each matching the card that shows it.
     *
     * The old version flattened every row on every list into one `items` array
     * and derived the whole payload from it — count, balance, categories,
     * spend, climate. That array is ticked and unticked together, which is a
     * quantity nothing else in the app reports, so the recap disagreed with the
     * two cards printed directly beneath it. See RecapPayload.
     */
    const basket = basketItems(lists);
    // The same 7-day window the recap itself covers, from the same log the
    // Climate Mix card counts.
    const bought = purchases.filter((p) => p.at >= now - 7 * DAY);

    const balance = basketBalance(basket.map((it) => ({ name: it.name, category: it.category })));

    const catCount = new Map<string, number>();
    for (const it of basket) catCount.set(it.category, (catCount.get(it.category) ?? 0) + 1);
    // Localized labels, so the model writes the recap using the same category
    // wording the user sees elsewhere in the app.
    const topCategories = [...catCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, count]) => ({ label: categoryLabel(c as ItemCategory, t), count }));

    // Resting items are excluded throughout: the recap describes what the
    // household actually shops for, and a retired item is neither a staple nor
    // something anyone is running low on.
    const active = Object.values(stats).filter((s) => !isResting(s));

    const staples = active
      .filter((s) => s.sampleCount >= 1)
      .sort((a, b) => b.sampleCount - a.sampleCount)
      .slice(0, 4)
      .map((s) => s.display);

    const lowItems = active
      .filter((s) => s.lastPurchasedAt > 0 && dueAt(s) - now < 5 * DAY)
      .sort((a, b) => dueAt(a) - dueAt(b))
      .slice(0, 4)
      .map((s) => s.display);

    /*
     * Spend is what was PAID, not what was typed onto a list.
     *
     * This used to sum priceCents across list rows, so a price entered against
     * something still sitting in the basket counted as money spent — and the
     * same row counted again, from the purchase log, on the spend card below.
     */
    const pricedBought = bought.filter((p) => p.priceCents != null);
    const spendCents = pricedBought.reduce((sum, p) => sum + (p.priceCents ?? 0), 0);

    // Scored over the week's purchases, which is what the Climate Mix card
    // scores. Scoring the lists instead answered a different question — "how
    // heavy is what I am about to buy" — under a heading about the week just
    // gone.
    const eco = ecoScoreFor(
      bought.map((p) => ({
        name: p.name,
        category: p.category ?? ('other' as ItemCategory),
        bio: p.bio,
      })),
    );

    return {
      boughtCount: bought.length,
      basketCount: basket.length,
      listCount: lists.length,
      balance: balance.slices.map((s) => ({ group: s.group, pct: Math.round(s.fraction * 100) })),
      topCategories,
      staples,
      lowItems,
      spendEuros: Math.round(spendCents) / 100,
      pricedCount: pricedBought.length,
      members: members.length,
      ecoScore: eco.score,
      ecoLowPercent: eco.score == null ? null : Math.round(eco.shares.low * 100),
      // Translated here rather than in the function: the edge function has no
      // locale files, and a produce name is exactly the kind of word a model
      // will translate loosely if asked to.
      seasonalSuggestions: inSeason(new Date(), bandForRegion(region)).map((k) =>
        t(`eco.season.${k}`),
      ),
    };
  }, [lists, purchases, stats, members, region, t]);

  /*
   * Enough to say something about.
   *
   * Either half counts. A week where nothing was bought but the basket is full
   * is a real week with something to report — "15 waiting on your list" — and
   * suppressing the card there would hide it exactly when somebody has just
   * finished planning a shop. The reverse holds too: bought the lot and ticked
   * it all off leaves an empty basket and a week worth describing.
   */
  const enoughData =
    payload.boughtCount > 0 || payload.basketCount > 0 || payload.staples.length > 0;

  const [phase, setPhase] = useState<Phase>(enoughData ? 'loading' : 'empty');
  const [text, setText] = useState<string | null>(null);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const run = async (force: boolean) => {
    if (!enoughData) {
      setPhase('empty');
      return;
    }
    // In a household the recap is shared (one per household per week, seen by
    // everyone); logged-out / solo falls back to a per-device weekly cache.
    // A stored recap in another language is a miss either way: it's prose, so
    // it has to be rewritten rather than shown to someone who can't read it.
    if (!force) {
      const cached = household ? await getSharedRecap(household.id) : null;
      if (household && cached && cached.week === weekKey() && cached.language === language) {
        setText(cached.text);
        setPhase('ready');
        return;
      }
      if (!household) {
        const local = await getCachedRecap(scope, language);
        if (local) {
          setText(local);
          setPhase('ready');
          return;
        }
      }
    }
    setPhase('loading');
    const recap = await generateRecap(payloadRef.current, language);
    if (recap) {
      setText(recap);
      setPhase('ready');
      if (household) void setSharedRecap(household.id, recap, language);
      else void setCachedRecap(scope, recap, language);
    } else {
      setPhase('error');
    }
  };

  // Load once per scope+week+language (cache first, generate if missing).
  useEffect(() => {
    void run(false);
  }, [scope, weekKey(), enoughData, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-update when another member generates this week's recap. While
  // backgrounded we hold no socket; on return we fetch once to catch up on a
  // recap written while we were away, then re-subscribe (see useAppActive).
  useEffect(() => {
    if (!household || !appActive) return;
    let alive = true;
    const syncShared = async () => {
      const shared = await getSharedRecap(household.id);
      // Ignore a recap another member generated in a different language —
      // our own run() will rewrite it in this reader's language.
      if (alive && shared && shared.week === weekKey() && shared.language === language) {
        setText(shared.text);
        setPhase('ready');
      }
    };
    void syncShared();
    const channel = supabase
      .channel(`recap-${household.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_recaps', filter: `household_id=eq.${household.id}` },
        syncShared,
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [household?.id, appActive, language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card accented>
      <View style={styles.head}>
        <Ionicons name="sparkles" size={20} color={colors.accent} />
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>
          {t('weekly.recapThisWeek')}
        </Text>
        {phase === 'ready' || phase === 'error' ? (
          <Pressable onPress={() => void run(true)} hitSlop={10}>
            <Ionicons name="refresh-outline" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {phase === 'loading' && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[type.sub, { color: colors.muted }]}>{t('weekly.recapWriting')}</Text>
        </View>
      )}
      {phase === 'ready' && text && (
        <Text style={[type.bodyRegular, { color: colors.ink, lineHeight: 22 }]}>
          {recapRuns(text).map((run, i) => (
            // Index keys: runs have no identity of their own, and the whole
            // paragraph is replaced at once whenever the recap changes.
            <Text key={i} style={run.bold ? styles.bold : undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      )}
      {phase === 'empty' && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('weekly.recapEmpty')}</Text>
      )}
      {phase === 'error' && (
        <Text style={[type.sub, { color: colors.muted }]}>{t('weekly.recapError')}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
