import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassView } from '@/components/glass';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

export interface StapleRow {
  key: string;
  display: string;
  times: number;
}

/**
 * The full staples list, when five is not enough.
 *
 * A sheet rather than a route: this is a longer look at a card you are already
 * reading, not a place you navigate to, and pushing a screen for it would put a
 * back button in the way of a glance. It also means the card keeps its range —
 * the sheet shows whatever window the card was showing, because a list that
 * silently switched to "all time" on expand would not be the same list the
 * reader asked to see more of.
 */
export function StaplesSheet({
  visible,
  staples,
  onClose,
}: {
  visible: boolean;
  staples: StapleRow[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const t = useT();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <GlassView radius={radii.lg} style={styles.card}>
            <View style={styles.grabber} />
            <Text style={[type.h2, { color: colors.ink }]}>{t('insights.staplesTitle')}</Text>
            {/* Bounded height, not flex: the sheet must not grow past the
                screen on a household with a hundred tracked items, and the
                scroll has to live inside the card rather than under it. */}
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {staples.map((s, i) => (
                <View key={s.key} style={styles.row}>
                  <Text style={[type.sub, styles.rank, { color: colors.muted }]}>{i + 1}</Text>
                  <Text
                    style={[type.body, styles.grow, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {s.display}
                  </Text>
                  <Text style={[type.sub, { color: colors.muted }]}>
                    {t('insights.boughtTimes', { count: s.times })}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={onClose} style={styles.done} hitSlop={8}>
              <Text style={[type.body, { color: colors.accent }]}>{t('common.done')}</Text>
            </Pressable>
          </GlassView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
    marginBottom: spacing.xs,
  },
  scroll: { maxHeight: 380 },
  grow: { flex: 1, minWidth: 0 },
  rank: { width: 22, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  done: { alignSelf: 'center', paddingTop: spacing.sm },
});
