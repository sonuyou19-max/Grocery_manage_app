import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassView } from '@/components/glass';
import { haptics } from '@/lib/haptics';
import { useDeferUntilClosed } from '@/lib/modal-nav';
import { usePlusGate } from '@/lib/plus-gate';
import { useEntitlement } from '@/store/entitlement';
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
 * Rolling windows rather than calendar ones: "last 30 days" means exactly that,
 * not the 1st onwards. Calendar months would make the card useful on the 28th
 * and nearly empty on the 2nd, and a spending figure that collapses every time
 * the month turns over invites exactly one conclusion — that the app lost the
 * data.
 *
 * The labels used to say "This month", which described the behaviour nobody
 * built. They now say "Last 30 days", because a control that names a calendar
 * month and returns a rolling one is lying about a number the reader is
 * actively trying to reason about.
 */
export function rangeCutoff(range: Range, now: number): number | null {
  if (range === 'all') return null;
  return now - RANGE_DAYS[range] * 86_400_000;
}

/**
 * Does this range reach further back than a free account is allowed to see?
 *
 * Derived from the server's own window rather than from a list of "these three
 * are paid". `historyCutoff` is the oldest purchase this account may see, set by
 * `my_entitlement()` in Postgres — so the split between free and paid ranges
 * moves the moment that SQL function does, and cannot drift from the sentence
 * the Insights tab prints above the chart.
 *
 * The free window is five weeks, not four, BECAUSE of this function: 30 days is
 * the default view, and a four-week window (28 days) would put a free account's
 * own default card behind the paywall. Migration 0028 carries that reasoning and
 * is the one that turns the tier on. If anyone ever narrows it below 30 days
 * again, this is where the damage shows up.
 *
 * Null cutoff — signed out, or the first answer has not arrived — gates nothing.
 * A guess in this direction shows a paywall to someone who has not been told
 * they need one.
 */
export function beyondFreeWindow(
  range: Range,
  now: number,
  historyCutoff: number | null,
): boolean {
  if (historyCutoff == null) return false;
  const cutoff = rangeCutoff(range, now);
  // "All time" has no cutoff, so it is always beyond a bounded window.
  return cutoff == null || cutoff < historyCutoff;
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
  const { locked, requirePlus } = usePlusGate();
  const { historyCutoff } = useEntitlement();
  // This menu is a <Modal>, so opening the paywall from it has to wait for it
  // to close. See lib/modal-nav.ts for the three times that was learned.
  const whenClosed = useDeferUntilClosed(open);

  const now = Date.now();
  const isPaid = (r: Range) => locked && beyondFreeWindow(r, now, historyCutoff);

  const pick = (r: Range) => {
    setOpen(false);
    if (r === value) return;
    // A paid range is offered, not hidden. Somebody has to be able to see that
    // a year of history exists before they can decide they want it — and the
    // row already carries the badge, so the paywall is not a surprise.
    if (isPaid(r)) {
      whenClosed(requirePlus);
      return;
    }
    haptics.snap();
    onChange(r);
  };

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
              const paid = isPaid(r);
              return (
                <Pressable key={r} style={styles.option} onPress={() => pick(r)}>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.accent : colors.muted}
                  />
                  <Text
                    style={[
                      type.body,
                      styles.grow,
                      { color: active ? colors.accent : paid ? colors.muted : colors.ink },
                    ]}
                  >
                    {t(`range.${r}`)}
                  </Text>
                  {paid && (
                    <View style={[styles.badge, { borderColor: colors.plusInk }]}>
                      <Text style={[type.label, { color: colors.plusInk }]}>{t('plus.badge')}</Text>
                    </View>
                  )}
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
  grow: { flex: 1 },
  // Outlined, not filled — the same treatment the Unlock Plus badge uses, so a
  // paid thing looks the same everywhere it is offered.
  badge: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
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
