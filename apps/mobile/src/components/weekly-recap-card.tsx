import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { CATEGORY_LABELS } from '@/lib/categorize';
import { basketBalance } from '@/lib/nutrition';
import { dueAt } from '@/lib/pantry-intel';
import {
  generateRecap,
  getCachedRecap,
  setCachedRecap,
  weekKey,
  type RecapPayload,
} from '@/lib/weekly-recap';
import { useGroceries } from '@/store/groceries';
import { useHousehold } from '@/store/household';
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
  const { lists } = useGroceries();
  const { stats } = usePantryIntel();
  const { household, members } = useHousehold();

  const scope = household?.id ?? 'local';

  const payload = useMemo<RecapPayload>(() => {
    const items = lists.flatMap((l) => l.items);
    const balance = basketBalance(items.map((it) => ({ name: it.name, category: it.category })));

    const catCount = new Map<string, number>();
    for (const it of items) catCount.set(it.category, (catCount.get(it.category) ?? 0) + 1);
    const topCategories = [...catCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, count]) => ({ label: CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c, count }));

    const staples = Object.values(stats)
      .filter((s) => s.sampleCount >= 1)
      .sort((a, b) => b.sampleCount - a.sampleCount)
      .slice(0, 4)
      .map((s) => s.display);

    const now = Date.now();
    const lowItems = Object.values(stats)
      .filter((s) => s.lastPurchasedAt > 0 && dueAt(s) - now < 5 * DAY)
      .sort((a, b) => dueAt(a) - dueAt(b))
      .slice(0, 4)
      .map((s) => s.display);

    const priced = items.filter((it) => it.priceCents != null);
    const spendCents = priced.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);

    return {
      itemCount: items.length,
      listCount: lists.length,
      balance: balance.slices.map((s) => ({ group: s.group, pct: Math.round(s.fraction * 100) })),
      topCategories,
      staples,
      lowItems,
      spendEuros: Math.round(spendCents) / 100,
      pricedCount: priced.length,
      members: members.length,
    };
  }, [lists, stats, members]);

  const enoughData = payload.itemCount > 0 || payload.staples.length > 0;

  const [phase, setPhase] = useState<Phase>(enoughData ? 'loading' : 'empty');
  const [text, setText] = useState<string | null>(null);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const run = async (force: boolean) => {
    if (!enoughData) {
      setPhase('empty');
      return;
    }
    if (!force) {
      const cached = await getCachedRecap(scope);
      if (cached) {
        setText(cached);
        setPhase('ready');
        return;
      }
    }
    setPhase('loading');
    const recap = await generateRecap(payloadRef.current);
    if (recap) {
      setText(recap);
      setPhase('ready');
      void setCachedRecap(scope, recap);
    } else {
      setPhase('error');
    }
  };

  // Load once per scope+week (cache first, generate if missing).
  useEffect(() => {
    void run(false);
  }, [scope, weekKey(), enoughData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card accented>
      <View style={styles.head}>
        <Ionicons name="sparkles" size={20} color={colors.accent} />
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>This week</Text>
        {phase === 'ready' || phase === 'error' ? (
          <Pressable onPress={() => void run(true)} hitSlop={10}>
            <Ionicons name="refresh-outline" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {phase === 'loading' && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[type.sub, { color: colors.muted }]}>Writing your recap…</Text>
        </View>
      )}
      {phase === 'ready' && text && (
        <Text style={[type.bodyRegular, { color: colors.ink, lineHeight: 22 }]}>{text}</Text>
      )}
      {phase === 'empty' && (
        <Text style={[type.sub, { color: colors.muted }]}>
          Add a few items and tick some off — I’ll write your first weekly recap here.
        </Text>
      )}
      {phase === 'error' && (
        <Text style={[type.sub, { color: colors.muted }]}>
          Couldn’t write your recap just now. Tap refresh to try again.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
