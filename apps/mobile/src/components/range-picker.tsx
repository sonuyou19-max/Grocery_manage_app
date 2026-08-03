import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassView } from '@/components/glass';
import { haptics } from '@/lib/haptics';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * The window a card is reporting on, and the control that changes it.
 *
 * ---------------------------------------------------------------------------
 * Per card, not per screen
 * ---------------------------------------------------------------------------
 *
 * One filter at the top of the tab would be simpler to build and worse to use.
 * The questions these cards answer have different natural spans: "what did I
 * spend" is a month, "where do I shop" is a quarter before it says anything,
 * and "what are my staples" wants everything Korb has. A single control forces
 * one answer on all three, and the reader cannot tell which card it was wrong
 * for.
 *
 * The cost is that three cards can disagree about the period, which is why each
 * one prints its own range in its own header rather than relying on a control
 * somewhere above.
 */
export const RANGES = ['week', 'month', 'quarter', 'year', 'all'] as const;
export type Range = (typeof RANGES)[number];

/** Days in each window. `all` has no cutoff — see `rangeCutoff`. */
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = {
  week: 7,
  month: 30,
  quarter: 91,
  year: 365,
};

/**
 * The oldest timestamp a range includes, or null for "everything".
 *
 * Rolling windows rather than calendar ones: "this month" here means the last
 * 30 days, not the 1st onwards. Calendar months would make the card useful on
 * the 28th and nearly empty on the 2nd, and a spending figure that collapses
 * every time the month turns over invites exactly one conclusion — that the app
 * lost the data.
 */
export function rangeCutoff(range: Range, now: number): number | null {
  if (range === 'all') return null;
  return now - RANGE_DAYS[range] * 86_400_000;
}

/** Keep only what falls inside the window. */
export function withinRange<T extends { at: number }>(
  items: T[],
  range: Range,
  now: number,
): T[] {
  const cutoff = rangeCutoff(range, now);
  return cutoff == null ? items : items.filter((it) => it.at >= cutoff);
}

/**
 * The inline "This month ⌄" control that sits in a card's header.
 *
 * Renders as text plus a chevron rather than as a button, because it is a label
 * that happens to be tappable — a bordered control here would compete with the
 * card's own title for the eye at the top of every card on the tab.
 */
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { colors } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => {
          haptics.tick();
          setOpen(true);
        }}
        hitSlop={8}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={t(`range.${value}`)}
      >
        <Text style={[type.sub, { color: colors.muted }]}>{t(`range.${value}`)}</Text>
        <Ionicons name="chevron-down" size={13} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <GlassView radius={radii.lg} style={styles.menu}>
            {RANGES.map((r) => {
              const active = r === value;
              return (
                <Pressable
                  key={r}
                  style={styles.option}
                  onPress={() => {
                    setOpen(false);
                    if (r !== value) {
                      haptics.snap();
                      onChange(r);
                    }
                  }}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.accent : colors.muted}
                  />
                  <Text style={[type.body, { color: active ? colors.accent : colors.ink }]}>
                    {t(`range.${r}`)}
                  </Text>
                </Pressable>
              );
            })}
          </GlassView>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,18,10,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menu: { padding: spacing.md, gap: spacing.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
});
