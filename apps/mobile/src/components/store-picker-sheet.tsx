import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { GlassView } from '@/components/glass';
import { Sheet, SheetHandle } from '@/components/sheet';
import { SupermarketBadge } from '@/components/supermarket-badge';
import { TextPromptModal } from '@/components/text-prompt-modal';
import { haptics } from '@/lib/haptics';
import { storeChoices } from '@/lib/household-stores';
import { recordStoreUse, useStorePrefs } from '@/lib/store-prefs';
import { usePantryIntel } from '@/store/pantry-intel';
import { useT } from '@/store/locale';
import { radii, spacing, type, useScrollIndicator, useTheme } from '@/theme';

/**
 * Which shop this was.
 *
 * ---------------------------------------------------------------------------
 * Why a picker and not a text field
 * ---------------------------------------------------------------------------
 *
 * `store` is a KEY, not a caption. Everything that compares prices groups by
 * this exact string — "cheaper elsewhere", spend by shop, the price history on
 * an item — so `Colruyt` typed one week and `colruyt` the next are two shops
 * that never compare, in the features whose entire job is comparing them. The
 * same reasoning is why a receipt's printed header is resolved to a catalogue
 * id before it is stored (see planCommit).
 *
 * A picker makes the common answer unambiguous by construction. Typing stays
 * available for the corner shop nobody has a catalogue entry for, and what is
 * typed is then offered back as an option rather than retyped.
 *
 * ---------------------------------------------------------------------------
 * Ordered from the household's own history
 * ---------------------------------------------------------------------------
 *
 * See lib/household-stores. The list is led by shops this household has
 * actually bought at, most recent first, because a receipt is reviewed minutes
 * after a shop and the shop you were just in is overwhelmingly the answer. That
 * also makes the picker shared: a store one member typed shows up for the other
 * as soon as anything has been bought there, without a per-household table to
 * keep in step.
 */
export function StorePickerSheet({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** The currently chosen store id, or null for "not saying". */
  value: string | null;
  onPick: (store: string | null) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const scrollIndicator = useScrollIndicator();
  const { height: windowHeight } = useWindowDimensions();
  const prefs = useStorePrefs();
  const { purchases } = usePantryIntel();
  const t = useT();
  const [adding, setAdding] = useState(false);

  const choices = useMemo(() => storeChoices(purchases, prefs), [purchases, prefs]);

  const choose = (id: string | null) => {
    haptics.tick();
    if (id) recordStoreUse(id);
    onPick(id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} scrim gutter={0} motion="slide">
      {/* A real pixel ceiling, like every other listing sheet: nothing above
          this card has a definite height for a percentage to resolve against,
          and GlassView clips what overflows. */}
      <GlassView
        over="content"
        radius={radii.lg}
        style={[styles.sheet, { maxHeight: Math.round(windowHeight * 0.7) }]}
      >
        <SheetHandle />
        <View style={[styles.head, { borderColor: colors.line }]}>
          <Text style={[type.h2, { color: colors.ink }]}>{t('receipt.storeTitle')}</Text>
        </View>

        <ScrollView {...scrollIndicator} contentContainerStyle={styles.list}>
          {/*
            Typing a new one is FIRST, not buried at the bottom of forty chains.
            The reason somebody opens this picker having already been offered a
            resolved store is usually that the resolved one is wrong and the
            real shop is not a chain at all.
          */}
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            style={[styles.row, { borderColor: colors.line }]}
          >
            <View style={[styles.addBadge, { borderColor: colors.accent }]}>
              <Ionicons name="add" size={18} color={colors.accent} />
            </View>
            <Text style={[type.body, styles.grow, { color: colors.accent }]}>
              {t('itemSheet.storeOther')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => choose(null)}
            accessibilityRole="button"
            accessibilityState={{ selected: value == null }}
            style={[styles.row, { borderColor: colors.line }]}
          >
            <Ionicons name="remove-circle-outline" size={26} color={colors.muted} />
            <Text style={[type.body, styles.grow, { color: colors.muted }]}>
              {t('itemSheet.storeNone')}
            </Text>
            {value == null && <Ionicons name="checkmark" size={20} color={colors.accent} />}
          </Pressable>

          {choices.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => choose(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: value === c.id }}
              style={[styles.row, { borderColor: colors.line }]}
            >
              <SupermarketBadge store={c.id} />
              <Text style={[type.body, styles.grow, { color: colors.ink }]} numberOfLines={1}>
                {c.label}
              </Text>
              {/*
                A quiet mark on shops this household has actually shopped at,
                which is the difference between "we go here" and "this chain
                exists". It is the only thing separating the top of the list
                from the catalogue below it, and without it the ordering looks
                arbitrary.
              */}
              {c.used && !(value === c.id) && (
                <Text style={[type.label, { color: colors.muted }]}>{t('receipt.storeUsed')}</Text>
              )}
              {value === c.id && <Ionicons name="checkmark" size={20} color={colors.accent} />}
            </Pressable>
          ))}
        </ScrollView>
      </GlassView>

      <TextPromptModal
        visible={adding}
        title={t('itemSheet.customStoreTitle')}
        placeholder={t('itemSheet.customStorePlaceholder')}
        confirmLabel={t('itemSheet.customStoreConfirm')}
        onCancel={() => setAdding(false)}
        onSubmit={(name) => {
          setAdding(false);
          const clean = name.trim();
          if (clean) choose(clean);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { overflow: 'hidden' },
  head: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  addBadge: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
