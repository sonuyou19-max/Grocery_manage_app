import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import {
  addMonths,
  isSameDay,
  monthGrid,
  monthLabel,
  weekdayLabels,
} from '@/lib/calendar';
import { useLocale } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * A month at a time, for picking a day that has already happened.
 *
 * ---------------------------------------------------------------------------
 * Why the future is closed rather than merely discouraged
 * ---------------------------------------------------------------------------
 *
 * `max` defaults to now and days past it are not dimmed-but-tappable, they are
 * inert. Every caller so far is recording something that HAS occurred — a shop
 * that happened, a receipt that was printed — and a purchase dated next Tuesday
 * is not an unusual entry, it is a typo that quietly corrupts arithmetic
 * downstream: the burn rate learns a gap that has not elapsed, the item stops
 * coming due, and nothing on any screen ever says why. The month arrows stop at
 * the same edge, so there is not even an empty future month to land in.
 *
 * ---------------------------------------------------------------------------
 * Why it is not a native picker
 * ---------------------------------------------------------------------------
 *
 * `DateTimePickerAndroid` and the iOS wheel are two different controls with two
 * different shapes, neither of which can render inside a sheet on both
 * platforms — and the Android one is itself a dialog, which is precisely the
 * modal-over-modal hazard check-modal-nav exists about. This is a grid of
 * Pressables, so it lives inline in whatever is already open.
 */
export function DayPicker({
  value,
  onChange,
  max = Date.now(),
}: {
  /** The chosen instant. Only its local day is read. */
  value: number;
  /** Called with local noon on the tapped day — see lib/calendar. */
  onChange: (ms: number) => void;
  /** The latest selectable day, inclusive. Defaults to today. */
  max?: number;
}) {
  const { colors } = useTheme();
  const { language } = useLocale();

  const shown = new Date(value);
  const [cursor, setCursor] = useState({ year: shown.getFullYear(), month: shown.getMonth() });

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const headings = useMemo(() => weekdayLabels(language), [language]);

  // The ceiling is a DAY, so a purchase made an hour ago does not make the rest
  // of today unpickable. Comparing the raw instants would do exactly that:
  // today's cell is local noon, and at 09:00 that is in the future.
  const ceiling = new Date(max);
  const capped = (ms: number) => {
    const d = new Date(ms);
    return (
      d.getFullYear() > ceiling.getFullYear() ||
      (d.getFullYear() === ceiling.getFullYear() &&
        (d.getMonth() > ceiling.getMonth() ||
          (d.getMonth() === ceiling.getMonth() && d.getDate() > ceiling.getDate())))
    );
  };

  // The whole month is out of reach, so there is nothing to walk forward into.
  const nextBlocked = capped(new Date(cursor.year, cursor.month + 1, 1).getTime());

  const step = (delta: number) => {
    haptics.tick();
    setCursor((c) => addMonths(c.year, c.month, delta));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          hitSlop={10}
          style={styles.arrow}
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>
        <Text style={[type.body, styles.month, { color: colors.ink }]}>
          {monthLabel(cursor.year, cursor.month, language)}
        </Text>
        <Pressable
          onPress={() => step(1)}
          disabled={nextBlocked}
          accessibilityRole="button"
          hitSlop={10}
          style={[styles.arrow, nextBlocked && styles.off]}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {headings.map((label, i) => (
          <View key={i} style={styles.cell}>
            <Text style={[type.label, styles.heading, { color: colors.muted }]}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={styles.cell} />;
          const chosen = isSameDay(cell.ms, value);
          const blocked = capped(cell.ms);
          return (
            <Pressable
              key={i}
              disabled={blocked}
              onPress={() => {
                haptics.tick();
                onChange(cell.ms);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen, disabled: blocked }}
              style={styles.cell}
            >
              <View
                style={[
                  styles.day,
                  chosen && { backgroundColor: colors.accent },
                ]}
              >
                <Text
                  style={[
                    type.sub,
                    styles.dayText,
                    {
                      color: chosen
                        ? colors.accentInk
                        : blocked
                          ? colors.line
                          : colors.ink,
                    },
                  ]}
                >
                  {cell.day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  arrow: { padding: spacing.xs },
  off: { opacity: 0.25 },
  month: { flex: 1, textAlign: 'center', fontWeight: '600' },
  // Seven equal columns, laid out by wrapping rather than by seven nested rows:
  // the grid is one flat list and the week boundary falls out of the width.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  heading: { textAlign: 'center' },
  // A circle rather than the cell itself, so the selected day reads as a mark
  // ON the calendar instead of a block cut out of it.
  day: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontVariant: ['tabular-nums'] },
});
