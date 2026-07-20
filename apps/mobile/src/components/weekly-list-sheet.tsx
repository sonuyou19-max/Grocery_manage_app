import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SupermarketBadge } from '@/components/supermarket-badge';
import { CATEGORY_LABELS } from '@/lib/categorize';
import { haptics } from '@/lib/haptics';
import type { WeeklySuggestion } from '@/lib/weekly-list';
import { radii, spacing, type, useTheme } from '@/theme';

interface WeeklyListSheetProps {
  visible: boolean;
  suggestions: WeeklySuggestion[];
  onClose: () => void;
  /** Called with the items the user kept ticked; the parent picks the list. */
  onBuild: (selected: WeeklySuggestion[]) => void;
}

/**
 * Preview/confirm sheet for "Build my weekly list". Everything predicted low is
 * pre-ticked; untick anything you don't need, then Add — the parent then asks
 * which list to add them to (the shared ListPickerSheet).
 */
export function WeeklyListSheet({ visible, suggestions, onClose, onBuild }: WeeklyListSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pre-tick everything each time the sheet opens.
  useEffect(() => {
    if (visible) setSelected(new Set(suggestions.map((s) => s.key)));
  }, [visible, suggestions]);

  const toggle = (key: string) => {
    haptics.tick();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const count = selected.size;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.grab, { backgroundColor: colors.line }]} />

          <View style={styles.header}>
            <Ionicons name="sparkles" size={20} color={colors.accent} />
            <Text style={[type.h2, { color: colors.ink, flex: 1 }]}>This week's list</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={[type.sub, { color: colors.muted, paddingHorizontal: spacing.lg }]}>
            Predicted low, based on how fast you get through them. Untick anything you don't need.
          </Text>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {suggestions.map((s) => {
              const on = selected.has(s.key);
              const detail = [
                CATEGORY_LABELS[s.category],
                s.quantity != null ? `${s.quantity}${s.unit ? ` ${s.unit}` : ''}` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={s.key}
                  onPress={() => toggle(s.key)}
                  style={[styles.row, { borderColor: on ? colors.accent : colors.line }]}
                >
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? colors.accent : colors.muted}
                  />
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
                      {s.display}
                    </Text>
                    <Text style={[type.sub, { color: colors.muted }]} numberOfLines={1}>
                      {detail}
                    </Text>
                  </View>
                  {s.store != null && <SupermarketBadge store={s.store} size={18} />}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Pressable
              onPress={() => onBuild(suggestions.filter((s) => selected.has(s.key)))}
              disabled={count === 0}
              style={[styles.build, { backgroundColor: colors.accent, opacity: count ? 1 : 0.45 }]}
            >
              <Text style={[type.body, { color: colors.accentInk }]}>
                Add {count} item{count === 1 ? '' : 's'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,18,10,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    maxHeight: '85%',
  },
  grab: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  body: { padding: spacing.lg, gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  build: { height: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
