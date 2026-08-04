import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import { billingAvailable } from '@/lib/billing';
import { haptics } from '@/lib/haptics';
import { usePlusGate } from '@/lib/plus-gate';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

// Same guard the list and pantry screens install — without it Android silently
// ignores LayoutAnimation and the card would snap open instead of expanding.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Korb Plus, as a thing somebody might actually buy.
 *
 * ---------------------------------------------------------------------------
 * It expands, it does not navigate
 * ---------------------------------------------------------------------------
 *
 * Tapping opens the detail in place rather than pushing a screen or raising a
 * sheet. A modal would take the reader away from the numbers that just made
 * them curious — they tapped BECAUSE of the tab they were looking at, and the
 * pitch lands better next to the thing it is about than alone on a black
 * screen. It also means no dismissal to think about: scroll away and it is
 * gone.
 *
 * LayoutAnimation rather than Reanimated. The app already uses it for the
 * check-off collapse and the pantry sections, it needs no measured height, and
 * one `configureNext` before the state change animates the whole reflow —
 * including the cards below sliding down — which is the part that makes it
 * feel like the card grew rather than that content appeared.
 *
 * ---------------------------------------------------------------------------
 * The colour is doing a job
 * ---------------------------------------------------------------------------
 *
 * Everything else in Korb is green and amber: your groceries. Plus is a
 * different KIND of thing — the one you pay for — and the violet-to-teal ramp
 * (theme tokens plusFrom/plusTo) says so before a word is read. It appears on
 * exactly three surfaces: this card, the dashboard badge, and the paywall. Use
 * it anywhere else and it stops meaning anything.
 *
 * ---------------------------------------------------------------------------
 * Collapsed says what it is; expanded says what you get
 * ---------------------------------------------------------------------------
 *
 * Collapsed is a shelf label: one line of promise and four short proofs. Long
 * enough to be worth a tap, short enough not to bury the tab it sits in.
 *
 * Expanded is one sub-card per capability, each with a CONCRETE sentence
 * rather than a feature name. "Olive oil is 18% up on what you usually pay" is
 * a thing a person can picture; "price tracking" is not.
 */

interface Perk {
  icon: IconName;
  /** i18n key suffix under `plus.detail.` — `<id>Title` and `<id>Body`. */
  id: string;
}

/**
 * Ordered by how much each one is worth to somebody deciding, not by how hard
 * it was to build. History first because it is the one that compounds — it is
 * worth more every week they stay — and the recap last because it is the most
 * obviously "nice extra".
 */
const PERKS: Perk[] = [
  { icon: 'time-outline', id: 'history' },
  { icon: 'swap-vertical-outline', id: 'moves' },
  { icon: 'trending-down-outline', id: 'cheaper' },
  { icon: 'restaurant-outline', id: 'recipe' },
  { icon: 'leaf-outline', id: 'eco' },
  { icon: 'pulse-outline', id: 'vibe' },
  { icon: 'file-tray-full-outline', id: 'pantryMix' },
  { icon: 'repeat-outline', id: 'staples' },
  { icon: 'home-outline', id: 'households' },
  { icon: 'sparkles-outline', id: 'recap' },
];

export function PlusCard({ freeWeeks }: { freeWeeks: number }) {
  const { colors } = useTheme();
  const t = useT();
  const { requirePlus } = usePlusGate();
  const [open, setOpen] = useState(false);

  const toggle = () => {
    haptics.tick();
    // Before the state change, so the expansion and everything sliding down
    // beneath it animate as one movement.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View style={[styles.frame, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {/* The gradient is a hairline along the top edge, not a fill. A fully
          coloured card would shout over the user's own figures directly above
          it; a seam is enough to mark this as a different kind of thing. */}
      <LinearGradient
        colors={[colors.plusFrom, colors.plusTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.seam}
      />

      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <LinearGradient
          colors={[colors.plusFrom, colors.plusTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.mark}
        >
          <Ionicons name="sparkles" size={16} color="#FFFFFF" />
        </LinearGradient>
        <View style={styles.grow}>
          <Text style={[type.body, { color: colors.ink }]}>{t('plus.title')}</Text>
          <Text style={[type.sub, { color: colors.muted }]}>{t('plus.tagline')}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.muted}
        />
      </Pressable>

      {!open && (
        <>
          {/* Four proofs, two columns. Enough to be worth a tap; not so much
              that the collapsed state is already the whole pitch. */}
          <View style={styles.chips}>
            {PERKS.slice(0, 4).map((p) => (
              <View key={p.id} style={[styles.chip, { backgroundColor: colors.plusSoft }]}>
                <Ionicons name={p.icon} size={13} color={colors.plusInk} />
                <Text style={[type.label, { color: colors.plusInk }]} numberOfLines={1}>
                  {t(`plus.chip.${p.id}`)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[type.sub, { color: colors.muted }]}>
            {t('plus.showingWeeks', { count: freeWeeks })}
          </Text>
        </>
      )}

      {open && (
        <View style={styles.detail}>
          {PERKS.map((p) => (
            <View
              key={p.id}
              style={[styles.sub, { backgroundColor: colors.plusSoft, borderColor: colors.line }]}
            >
              <View style={[styles.subIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name={p.icon} size={17} color={colors.plusInk} />
              </View>
              <View style={styles.grow}>
                <Text style={[type.body, { color: colors.ink }]}>
                  {t(`plus.detail.${p.id}Title`)}
                </Text>
                <Text style={[type.sub, { color: colors.muted }]}>
                  {t(`plus.detail.${p.id}Body`)}
                </Text>
              </View>
            </View>
          ))}

          {/* Held apart from the sub-cards so it reads as a fact about the
              product, not one more thing being sold. If somebody is unsure
              whether stopping costs them their history, they will not start. */}
          <Text style={[type.sub, { color: colors.muted }]}>{t('plus.nothingLost')}</Text>
        </View>
      )}

      {billingAvailable() && (
        <Pressable onPress={requirePlus} accessibilityRole="button" style={styles.ctaWrap}>
          <LinearGradient
            colors={[colors.plusFrom, colors.plusTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            <Text style={[type.body, { color: '#FFFFFF' }]}>{t('plus.see')}</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  frame: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    // Clips the gradient seam to the rounded top corners.
    overflow: 'hidden',
    padding: spacing.lg,
    paddingTop: spacing.lg + 3,
    gap: spacing.sm,
  },
  seam: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  detail: { gap: spacing.sm },
  sub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWrap: { marginTop: spacing.xs },
  cta: { paddingVertical: spacing.md, borderRadius: radii.pill, alignItems: 'center' },
});
