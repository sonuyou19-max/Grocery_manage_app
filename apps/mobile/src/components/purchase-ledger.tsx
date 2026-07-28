import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassView } from '@/components/glass';
import { ItemEmoji } from '@/components/item-emoji';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { historyFor, type Purchase } from '@/lib/purchase-log';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

import type { ItemCategory } from '@korb/shared';

/**
 * Every time you bought one thing — the drill-down behind an aggregate card.
 *
 * The aggregates answer "what does this usually cost"; this answers "what
 * actually happened", which is the only place the transaction model becomes
 * visible to the user. Two purchases of the same item at different shops appear
 * as two rows here, which is the whole point of logging them separately.
 *
 * Unpriced purchases are shown, not hidden. They are real events — most
 * shopping in this app is unpriced — and a history that silently omitted them
 * would look like the app had forgotten half your trips. They simply carry no
 * amount, which is honest about what was recorded.
 */
export function PurchaseLedger({
  name,
  category,
  purchases,
  onClose,
}: {
  /** Item to show the history for; null closes the sheet. */
  name: string | null;
  category: ItemCategory;
  purchases: Purchase[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t, money } = useLocale();
  const insets = useSafeAreaInsets();

  if (!name) return null;
  const rows = historyFor(purchases, name);

  const dateOf = (at: number) =>
    new Date(at).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The sheet floats clear of the gesture bar. Without the inset its
            bottom edge sits directly on the Android navigation area, which is
            what made a one-row history look wedged into the corner. */}
        <Pressable
          onPress={() => {}}
          style={[styles.sheetWrap, { paddingBottom: spacing.md + insets.bottom }]}
        >
          <GlassView radius={radii.lg} style={styles.sheet}>
            <View style={styles.head}>
              <ItemEmoji name={name} category={category} size={22} />
              <View style={styles.grow}>
                <Text style={[type.h2, { color: colors.ink }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t('ledger.subtitle', { count: rows.length })}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
              // The sheet is only as tall as its rows (up to the cap), so a
              // short history must not leave the ScrollView stretched over
              // empty space with the rows stranded at the top.
              style={styles.scroll}
              bounces={false}
            >
              {rows.map((p, i) => (
                <View
                  key={p.id}
                  style={[
                    styles.row,
                    { borderBottomColor: colors.line },
                    // No rule under the last row: a divider with nothing beneath
                    // it reads as the list having been cut off rather than
                    // having ended.
                    i === rows.length - 1 && styles.lastRow,
                  ]}
                >
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]}>{dateOf(p.at)}</Text>
                    <View style={styles.meta}>
                      {p.store != null ? (
                        <SupermarketBadge store={p.store} size={16} />
                      ) : (
                        <Text style={[type.sub, { color: colors.muted }]}>
                          {t('ledger.noStore')}
                        </Text>
                      )}
                      {p.quantity != null && (
                        <Text style={[type.sub, { color: colors.muted }]}>
                          {p.quantity}
                          {p.unit ? ` ${p.unit}` : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                  {/* An unpriced purchase shows a dash, not a zero: it happened,
                      it just carries no amount, and €0.00 would be a lie that
                      also drags every average it lands in. */}
                  <Text
                    style={[
                      type.price,
                      { color: p.priceCents == null ? colors.muted : colors.ink },
                    ]}
                  >
                    {p.priceCents == null ? '—' : money(p.priceCents)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </GlassView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,18,10,0.45)', justifyContent: 'flex-end' },
  // paddingBottom is applied inline — it carries the safe-area inset.
  sheetWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  // Capped so a long history scrolls instead of covering the whole screen;
  // shorter than the cap it shrinks to fit, because flexShrink on the scroll
  // view lets the sheet size to its content.
  sheet: { maxHeight: '80%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  grow: { flex: 1, minWidth: 0 },
  // Generous at the bottom: this is the sheet's closing edge and the last row
  // needs room to breathe under it, not a hairline against the rim.
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
});
