import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { takeRun, type ScanRun } from '@/lib/receipt-run';
import { useLocale } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * What the scan read — the landing pad, not yet the review sheet.
 *
 * ---------------------------------------------------------------------------
 * Deliberately read-only
 * ---------------------------------------------------------------------------
 *
 * The real sheet — three groups, editable amounts, the reconciliation banner,
 * and an Import button that writes prices and purchases — is the next piece of
 * work. This is what stands in the meantime, and it stands because a capture
 * screen with nowhere to land cannot be tested against a real receipt at all.
 *
 * It shows every number the scan produced and changes nothing. That is the
 * whole point: the open question about this feature is not whether the UI is
 * pleasant, it is whether the extractor reads a real photograph of a real
 * receipt correctly — and this answers that question without any of the risk
 * that comes with a half-wired path that writes money.
 *
 * When the sheet lands, this file's contents are replaced. The route is not.
 */

export default function ReceiptReviewScreen() {
  const { t, money } = useLocale();
  const { colors } = useTheme();

  /*
   * Read once, in state, because takeRun() CONSUMES the stash — calling it in
   * render would hand the first paint a scan and every re-render nothing.
   */
  const [run] = useState<ScanRun | null>(() => takeRun());

  if (!run) {
    // No stash: arrived by a back gesture after the run was consumed, or by a
    // deep link. Nothing to show and nothing recoverable.
    return (
      <Screen title={t('receipt.reviewTitle')}>
        <Card>
          <Text style={[type.sub, { color: colors.muted }]}>{t('receipt.nothingToReview')}</Text>
        </Card>
        <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
          <Text style={[type.sub, { color: colors.accent }]}>{t('common.back')}</Text>
        </Pressable>
      </Screen>
    );
  }

  const { receipt, purchases, matches } = run;
  const matched = [...matches.values()].filter((m) => m.kind === 'matched').length;

  return (
    <Screen
      title={t('receipt.reviewTitle')}
      subtitle={receipt.store ?? t('receipt.unknownStore')}
    >
      {/* The banner the shopper was promised: when the parse does not agree
          with the totals the receipt prints about itself, that is said first
          and plainly, rather than buried under a page of confident numbers. */}
      {!receipt.reconciled && (
        <Card>
          <View style={styles.row}>
            <Ionicons name="warning-outline" size={20} color={colors.warn} />
            <View style={styles.grow}>
              <Text style={[type.body, { color: colors.ink }]}>
                {t('receipt.notReconciled')}
              </Text>
              {receipt.problems.map((p) => (
                <Text key={p} style={[type.sub, { color: colors.muted }]}>
                  {p}
                </Text>
              ))}
            </View>
          </View>
        </Card>
      )}

      <Card>
        <Line label={t('receipt.paid')} value={money(receipt.paidCents)} />
        <Line label={t('receipt.goods')} value={money(receipt.goodsCents)} />
        {receipt.depositCents !== 0 && (
          <Line label={t('receipt.deposit')} value={money(receipt.depositCents)} />
        )}
        {receipt.discountCents !== 0 && (
          <Line label={t('receipt.discount')} value={money(receipt.discountCents)} />
        )}
        <Line
          label={t('receipt.matchedCount')}
          value={`${matched} / ${purchases.length}`}
        />
      </Card>

      {purchases.map((p) => {
        const outcome = matches.get(p.key);
        return (
          <Card key={p.key}>
            <View style={styles.row}>
              <Text style={type.body}>{p.emoji ?? '🧾'}</Text>
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]}>{p.name}</Text>
                {/* The printed line, always. It is the only thing on this
                    screen that is not an interpretation, so it is the only
                    thing a shopper can check an interpretation against. */}
                {p.raw.map((raw) => (
                  <Text key={raw} style={[type.sub, { color: colors.muted }]}>
                    {raw}
                  </Text>
                ))}
                <Text
                  style={[
                    type.sub,
                    { color: outcome?.kind === 'matched' ? colors.accent : colors.muted },
                  ]}
                >
                  {outcome?.kind === 'matched'
                    ? t('receipt.matchedHow', { how: outcome.how })
                    : outcome?.kind === 'ambiguous'
                      ? t('receipt.ambiguous')
                      : t('receipt.unmatched')}
                </Text>
              </View>
              <Text style={[type.body, { color: colors.ink }]}>{money(p.priceCents)}</Text>
            </View>
          </Card>
        );
      })}

      <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
        <Text style={[type.sub, { color: colors.accent }]}>{t('common.done')}</Text>
      </Pressable>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[type.sub, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
});
