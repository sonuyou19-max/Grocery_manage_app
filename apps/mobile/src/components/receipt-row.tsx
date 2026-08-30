import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SupermarketBadge } from '@/components/supermarket-badge';
import { haptics } from '@/lib/haptics';
import type { ReceiptSummary } from '@/lib/receipt-archive';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * One scanned receipt, as a row you can reopen.
 *
 * ---------------------------------------------------------------------------
 * What the row says, and why each part is on it
 * ---------------------------------------------------------------------------
 *
 * The shop and the date, because those are how a person recognises a receipt —
 * nobody remembers a shop by its total. The total on the right, because that is
 * how they tell two trips to the same shop in the same week apart. And two
 * marks that are only there when they mean something:
 *
 *   EDITED, when the scan has been corrected since it was imported. Without it
 *   a household cannot tell whether the figure they are looking at is what the
 *   model read or what somebody checked, which is the difference between a
 *   number to trust and a number to go and look at.
 *
 *   DIDN'T ADD UP, carried forward from the import. It is the same warning the
 *   review sheet showed at the time, and it belongs here because this is now
 *   the screen from which it can be acted on.
 *
 * A receipt with no stored scan cannot be reopened — imported before the scan
 * was kept, or written in a document shape this build does not know. It stays
 * in the list, greyed and inert, rather than being hidden: the purchases it
 * logged are real and visible everywhere else, and a receipt that vanished from
 * its own history would read as data loss.
 */
export function ReceiptRow({ receipt }: { receipt: ReceiptSummary }) {
  const { colors } = useTheme();
  const { t, money, language } = useLocale();

  const when = receipt.purchasedAt ?? receipt.scannedAt;
  const date = new Date(when).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const open = () => {
    haptics.tick();
    router.push({ pathname: '/receipt/review', params: { receipt: receipt.id } });
  };

  const body = (
    <>
      {/* The chain's own mark when we know the shop, a generic slip when we do
          not. An independent is not a failure to recognise anything. */}
      {receipt.storeId ? (
        <SupermarketBadge store={receipt.storeId} />
      ) : (
        <View style={[styles.generic, { borderColor: colors.line }]}>
          <Ionicons name="receipt-outline" size={16} color={colors.muted} />
        </View>
      )}

      <View style={styles.grow}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {receipt.store ?? t('receipt.unknownStore')}
        </Text>
        <View style={styles.marks}>
          <Text style={[type.sub, { color: colors.muted }]}>{date}</Text>
          {receipt.editedAt != null && (
            <Text style={[type.label, { color: colors.muted }]}>
              {' · '}
              {t('receipts.edited')}
            </Text>
          )}
          {!receipt.reconciled && (
            <Text style={[type.label, { color: colors.warn }]}>
              {' · '}
              {t('receipts.didNotAddUp')}
            </Text>
          )}
        </View>
      </View>

      {receipt.totalCents != null && (
        <Text style={[type.body, styles.total, { color: colors.ink }]}>
          {money(receipt.totalCents)}
        </Text>
      )}
      {receipt.reopenable && (
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      )}
    </>
  );

  if (!receipt.reopenable) {
    return (
      <View
        style={[styles.row, styles.inert]}
        accessibilityLabel={`${receipt.store ?? t('receipt.unknownStore')}, ${t('receipts.cannotReopen')}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={t('receipts.openFor', {
        store: receipt.store ?? t('receipt.unknownStore'),
        date,
      })}
      style={styles.row}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  inert: { opacity: 0.45 },
  grow: { flex: 1, minWidth: 0 },
  marks: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  total: { fontVariant: ['tabular-nums'] },
  generic: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
