import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/card';
import { Recalc } from '@/components/recalc';
import { RangePicker, type Range } from '@/components/range-picker';
import { useLocale } from '@/store/locale';
import { spacing, type, useTheme } from '@/theme';

/**
 * A card with a range filter on it, and the empty window that filter can make.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to make unwriteable
 * ---------------------------------------------------------------------------
 *
 * Pick "Last 7 days" on the climate card in a quiet week and the whole card
 * disappeared — and the range control went with it, because the control lives
 * on the card. There is then nothing on the screen that mentions climate at
 * all, and no way back: the filter that emptied the card is inside the thing it
 * emptied. The reader has to guess that some other tab, or a restart, will
 * bring it back.
 *
 * It was written as `{eco.score != null && <EcoCard range={ecoRange} …/>}`,
 * which is a perfectly ordinary line and reads as "don't show a card with
 * nothing in it". The fault is that `eco.score` is derived FROM `ecoRange`, so
 * the card's existence and the card's contents were answering the same
 * question. Two cards on the same tab already had the fix — mount on what the
 * household has EVER logged, say "nothing in this window" inside — and two did
 * not, and nothing recorded which was which.
 *
 * ---------------------------------------------------------------------------
 * So the two questions are two props
 * ---------------------------------------------------------------------------
 *
 *   `ever` — is this card relevant to this household at all? A day-one install
 *   with no purchases has no use for a spending card, and hiding it is right.
 *   This must be computed from the UNFILTERED data.
 *
 *   `empty` — does the CURRENT window happen to have nothing in it? That is not
 *   a reason to hide anything. It is a fact about the window, and the answer is
 *   to say so and leave the picker where it is.
 *
 * Naming them apart is most of the fix: `ever={eco.score != null}` reads wrong
 * in a way `{eco.score != null && …}` never did. check-insights-cards asserts
 * the rest — that nothing derived from a range reaches `ever`.
 */
export function RangeCard({
  order,
  icon,
  title,
  range,
  onRange,
  ever,
  empty,
  emptyMessage,
  headExtra,
  children,
}: {
  order?: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  range: Range;
  onRange: (r: Range) => void;
  /**
   * Whether this household has EVER had data for this card, computed from the
   * unfiltered set. The only thing that may hide the card.
   */
  ever: boolean;
  /** Whether the CURRENT range is empty. Shows a message; hides nothing. */
  empty: boolean;
  /** Overrides the default sentence where a card can say something truer. */
  emptyMessage?: string;
  /** Anything else the header carries, to the right of the picker. */
  headExtra?: ReactNode;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();

  if (!ever) return null;

  return (
    <Card order={order}>
      <View style={styles.head}>
        <Ionicons name={icon} size={20} color={colors.accent} />
        <Text style={[type.body, styles.grow, { color: colors.ink }]}>{title}</Text>
        <RangePicker value={range} onChange={onRange} />
        {headExtra}
      </View>
      {/*
        The dip is keyed on the range, not on the contents, so switching INTO an
        empty window animates like every other switch. A card that went still
        exactly when it had nothing to show would read as the app hanging at the
        moment it is least able to explain itself.
      */}
      <Recalc trigger={range} style={styles.body}>
        {empty ? (
          <Text style={[type.sub, { color: colors.muted }]}>
            {emptyMessage ?? t('insights.noneInRange')}
          </Text>
        ) : (
          children
        )}
      </Recalc>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  body: { gap: spacing.sm },
});
