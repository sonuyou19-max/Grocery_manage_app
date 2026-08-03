import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshBackground } from '@/components/mesh-background';
import { useToast } from '@/components/toast';
import {
  billingAvailable,
  getPlusOffers,
  purchasePlus,
  restorePlus,
  type PlusOffer,
  type PlusOffers,
} from '@/lib/billing';
import { haptics } from '@/lib/haptics';
import { useEntitlement } from '@/store/entitlement';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

type Phase = 'loading' | 'ready' | 'unavailable' | 'working';

/**
 * The one place Korb asks for money.
 *
 * ---------------------------------------------------------------------------
 * Every price on this screen comes from Google Play
 * ---------------------------------------------------------------------------
 *
 * Not from a constant, not from a translation. `priceString` is formatted by
 * the store for the user's own country and locale — "€2,99", "2,99 €",
 * "9,99 zł" — and the annual saving is computed from the two figures the store
 * returned rather than written down as "44%".
 *
 * That is why the unavailable state below shows an apology instead of prices.
 * A paywall that falls back to hard-coded numbers when the store is
 * unreachable will eventually quote somebody a price we do not charge, in a
 * country nobody thought about, and take their money at a different one. An
 * error and a retry is a much smaller failure.
 *
 * ---------------------------------------------------------------------------
 * Buying does not unlock anything. The server does.
 * ---------------------------------------------------------------------------
 *
 * `purchasePlus` resolving means Play took the money — not that Korb knows.
 * The grant happens when RevenueCat's webhook writes `subscriptions`, and the
 * user is standing in front of us while that is in flight. So a successful
 * purchase polls `my_entitlement()` for a few seconds (`waitForEntitlement`)
 * rather than flipping a local flag.
 *
 * If the poll times out we STILL close and thank them. The alternative — an
 * error after a completed payment — is the worst screen in any app. Their
 * access arrives on the next foreground refresh, which is at most seconds
 * away, and their money is not in limbo either way.
 */
export default function PaywallScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { showToast } = useToast();
  const { entitled, trialEndsAt, refresh } = useEntitlement();

  const [phase, setPhase] = useState<Phase>('loading');
  const [offers, setOffers] = useState<PlusOffers | null>(null);
  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');

  const load = useCallback(async () => {
    setPhase('loading');
    if (!billingAvailable()) {
      setPhase('unavailable');
      return;
    }
    const found = await getPlusOffers();
    setOffers(found);
    setPhase(found ? 'ready' : 'unavailable');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Poll the server until it agrees the purchase happened.
   *
   * Bounded, and the bound is deliberately short: this runs while somebody
   * watches a spinner immediately after paying. Six tries at one second is
   * long enough for a webhook that is working and short enough that a webhook
   * that is not does not feel like a hang.
   */
  const waitForEntitlement = useCallback(async () => {
    for (let i = 0; i < 6; i++) {
      await refresh();
      // `entitled` from the closure is a render old, so the loop cannot read
      // it. Re-reading is the provider's job; the loop just gives it time and
      // lets the screen unmount when the value lands (see the effect below).
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, [refresh]);

  // The moment the server says yes, this screen has nothing left to ask for.
  useEffect(() => {
    if (entitled && phase === 'working') {
      haptics.success();
      showToast(t('paywall.thanks'));
      router.back();
    }
  }, [entitled, phase, showToast, t]);

  const buy = async (offer: PlusOffer) => {
    haptics.tick();
    setPhase('working');
    const outcome = await purchasePlus(offer);
    if (outcome.status === 'cancelled') {
      // Backing out is not a failure and gets no apology, no toast, no report.
      setPhase('ready');
      return;
    }
    if (outcome.status === 'failed') {
      setPhase('ready');
      showToast(t('paywall.failed'));
      return;
    }
    await waitForEntitlement();
    // Still here means the webhook has not landed yet. Thank them anyway and
    // get out of the way — see the header comment.
    showToast(t('paywall.thanks'));
    router.back();
  };

  const restore = async () => {
    haptics.tick();
    setPhase('working');
    const had = await restorePlus();
    if (had) {
      await waitForEntitlement();
      showToast(t('paywall.restored'));
      router.back();
      return;
    }
    setPhase('ready');
    showToast(t('paywall.nothingToRestore'));
  };

  /**
   * The same eight capabilities the Plus card lists, in the same order, read
   * from the same keys.
   *
   * Kept identical on purpose: somebody arrives here from that card, and a
   * shorter or differently-worded list at the moment of payment reads as a
   * bait-and-switch even when every line is true. `plus.detail.*Title` is the
   * single source; the bodies stay on the card, where there is room.
   */
  const perks: Array<{ icon: keyof typeof Ionicons.glyphMap; id: string }> = [
    { icon: 'time-outline', id: 'history' },
    { icon: 'swap-vertical-outline', id: 'moves' },
    { icon: 'trending-down-outline', id: 'cheaper' },
    { icon: 'pulse-outline', id: 'vibe' },
    { icon: 'file-tray-full-outline', id: 'pantryMix' },
    { icon: 'repeat-outline', id: 'staples' },
    { icon: 'home-outline', id: 'households' },
    { icon: 'sparkles-outline', id: 'recap' },
  ];

  const busy = phase === 'working';
  const trialDaysLeft =
    trialEndsAt && trialEndsAt > Date.now()
      ? Math.ceil((trialEndsAt - Date.now()) / 86_400_000)
      : null;

  return (
    <View style={styles.root}>
      <MeshBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={[type.h1, styles.centred, { color: colors.ink }]}>{t('paywall.title')}</Text>
          <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
            {t('paywall.subtitle')}
          </Text>

          {/* Said before the prices, not after. Somebody still inside their free
              month should know that before they are asked to pay, even though
              it costs a conversion — being told afterwards is what makes people
              feel tricked. */}
          {trialDaysLeft != null && (
            <View style={[styles.trial, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="gift-outline" size={18} color={colors.accent} />
              <Text style={[type.sub, styles.grow, { color: colors.ink }]}>
                {t('paywall.trialLeft', { count: trialDaysLeft })}
              </Text>
            </View>
          )}

          <View style={styles.perks}>
            {perks.map((p) => (
              <View key={p.id} style={styles.perkRow}>
                <Ionicons name={p.icon} size={18} color={colors.accent} />
                <Text style={[type.body, styles.grow, { color: colors.ink }]}>
                  {t(`plus.detail.${p.id}Title`)}
                </Text>
              </View>
            ))}
          </View>

          {phase === 'loading' && <ActivityIndicator color={colors.accent} style={styles.spin} />}

          {phase === 'unavailable' && (
            <View style={styles.unavailable}>
              <Text style={[type.body, styles.centred, { color: colors.ink }]}>
                {t('paywall.unavailableTitle')}
              </Text>
              <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
                {t('paywall.unavailableBody')}
              </Text>
              <Pressable onPress={() => void load()} hitSlop={8}>
                <Text style={[type.body, { color: colors.accent }]}>{t('paywall.retry')}</Text>
              </Pressable>
            </View>
          )}

          {offers && (phase === 'ready' || busy) && (
            <View style={styles.plans}>
              {offers.annual && (
                <PlanRow
                  label={t('paywall.annual')}
                  price={offers.annual.priceString}
                  sub={
                    offers.annual.pricePerMonthString
                      ? t('paywall.perMonth', { price: offers.annual.pricePerMonthString })
                      : null
                  }
                  badge={
                    offers.annualSavingPercent != null
                      ? t('paywall.save', { percent: offers.annualSavingPercent })
                      : null
                  }
                  selected={selected === 'annual'}
                  onPress={() => setSelected('annual')}
                  disabled={busy}
                />
              )}
              {offers.monthly && (
                <PlanRow
                  label={t('paywall.monthly')}
                  price={offers.monthly.priceString}
                  sub={null}
                  badge={null}
                  selected={selected === 'monthly'}
                  onPress={() => setSelected('monthly')}
                  disabled={busy}
                />
              )}

              <Pressable
                onPress={() => {
                  const offer = selected === 'annual' ? offers.annual : offers.monthly;
                  if (offer) void buy(offer);
                }}
                disabled={busy}
                style={[styles.cta, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text style={[type.body, { color: colors.accentInk }]}>
                    {t('paywall.subscribe')}
                  </Text>
                )}
              </Pressable>

              {/* Required by Google Play, and the honest answer to "I already
                  paid for this on my old phone". */}
              <Pressable onPress={() => void restore()} disabled={busy} hitSlop={8}>
                <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
                  {t('paywall.restore')}
                </Text>
              </Pressable>
            </View>
          )}

          <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
            {t('paywall.renewNote')}
          </Text>
          <Text style={[type.sub, styles.centred, { color: colors.muted }]}>
            {t('paywall.nothingLost')}
          </Text>

          <View style={styles.legalRow}>
            <Pressable onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}>
              <Text style={[type.sub, { color: colors.accent }]}>{t('settings.terms')}</Text>
            </Pressable>
            <Text style={[type.sub, { color: colors.muted }]}>·</Text>
            <Pressable
              onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}
            >
              <Text style={[type.sub, { color: colors.accent }]}>{t('settings.privacy')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PlanRow({
  label,
  price,
  sub,
  badge,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  price: string;
  sub: string | null;
  badge: string | null;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.plan,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.accent : colors.line,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.grow}>
        <View style={styles.planHead}>
          <Text style={[type.body, { color: colors.ink }]}>{label}</Text>
          {badge && (
            <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
              <Text style={[type.label, { color: colors.accent }]}>{badge}</Text>
            </View>
          )}
        </View>
        {sub && <Text style={[type.sub, { color: colors.muted }]}>{sub}</Text>}
      </View>
      <Text style={[type.body, { color: colors.ink }]}>{price}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  grow: { flex: 1, minWidth: 0 },
  centred: { textAlign: 'center' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, alignItems: 'flex-end' },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  trial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  perks: { gap: spacing.sm, marginVertical: spacing.sm },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  spin: { marginVertical: spacing.xl },
  unavailable: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.lg },
  plans: { gap: spacing.sm },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  cta: {
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
