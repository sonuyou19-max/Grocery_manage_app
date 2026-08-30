import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { MeshBackground } from '@/components/mesh-background';
import { ReceiptRow } from '@/components/receipt-row';
import { Safe } from '@/components/safe';
import { useReceipts } from '@/lib/use-receipts';
import { useLocale } from '@/store/locale';
import { spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Every receipt this household has scanned.
 *
 * ---------------------------------------------------------------------------
 * Why a receipt is worth keeping after it has been imported
 * ---------------------------------------------------------------------------
 *
 * The import was one pass over a photograph, and some of it was a model's best
 * reading. A price misread, a line matched to the wrong item, a line skipped
 * because the shopper was not sure — every one of those is a wrong number in
 * the purchase log, and the log is what Insights, the burn rate and every price
 * comparison are computed from. Before this screen the only way to find out was
 * to notice the arithmetic looking odd weeks later, and there was nothing to do
 * about it when you did.
 *
 * Re-read on focus rather than subscribed to. See lib/use-receipts: a receipt
 * changes twice in its life, and the change worth catching is the correction
 * the user just made on the screen they came back from.
 */
export default function ReceiptsScreen() {
  const { colors } = useTheme();
  const { t } = useLocale();
  const scrollIndicator = useScrollIndicator();
  const { receipts, loading, reload } = useReceipts();

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <View style={styles.root}>
      <MeshBackground />
      <Safe style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <Text style={[type.h2, { color: colors.ink }]}>{t('receipts.title')}</Text>
        </View>

        {/*
          Loading and empty are different sentences and only one of them is
          true. A household that has never scanned anything is told what
          scanning is for; one whose query has not come back yet is told
          nothing, because there is nothing yet to say.
        */}
        {loading ? (
          <ActivityIndicator style={styles.spinner} color={colors.accent} />
        ) : (
          <FlatList
            {...scrollIndicator}
            data={receipts}
            keyExtractor={(r) => r.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={[styles.rule, { backgroundColor: colors.line }]} />
            )}
            renderItem={({ item }) => <ReceiptRow receipt={item} />}
            ListEmptyComponent={
              <EmptyState
                icon="receipt-outline"
                title={t('receipts.emptyTitle')}
                body={t('receipts.emptyBody')}
              />
            }
          />
        )}
      </Safe>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  spinner: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  rule: { height: StyleSheet.hairlineWidth },
});
