import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * "I'll get this" on a list item, and who has already said it.
 *
 * Shown only when it can matter: somebody else has the app open right now, or
 * the item is already claimed. A solo shopper never sees it at all, which is the
 * point — this is the one Wave 3 feature that is meaningless without a second
 * person, so it stays invisible rather than adding a control that would never do
 * anything.
 *
 * A claim is a hint, not a lock, so **any** member can release one: if someone's
 * phone died holding a claim, the household has to be able to take the item back.
 */

interface ClaimChipProps {
  /** Display name of the claimer, or null when unclaimed. */
  claimedByName: string | null;
  /** True when the claim is the current user's own. */
  mine: boolean;
  onPress: () => void;
}

export function ClaimChip({ claimedByName, mine, onPress }: ClaimChipProps) {
  const { colors } = useTheme();
  const t = useT();

  const claimed = claimedByName != null;
  const label = mine
    ? t('claim.yours')
    : claimed
      ? t('claim.taken', { name: claimedByName })
      : t('claim.take');

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: claimed }}
      accessibilityLabel={claimed ? t('claim.releaseA11y', { label }) : t('claim.takeA11y')}
      style={[
        styles.chip,
        {
          borderColor: claimed ? colors.accent : colors.line,
          backgroundColor: claimed ? colors.accentSoft : 'transparent',
        },
      ]}
    >
      <Ionicons
        name={claimed ? 'hand-left' : 'hand-left-outline'}
        size={13}
        color={claimed ? colors.accent : colors.muted}
      />
      <Text
        style={[type.sub, { color: claimed ? colors.accent : colors.muted }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Anna is shopping too" — live presence for the current household.
 *
 * Renders nothing when nobody else is around, rather than a "nobody here"
 * state: an empty presence list is also what you get offline or on a local
 * list, and asserting solitude from missing data would be wrong.
 */
export function ShoppersBadge({ names }: { names: string[] }) {
  const { colors } = useTheme();
  const t = useT();
  if (names.length === 0) return null;

  return (
    <View style={styles.presence}>
      {/* A filled dot reads as "live" — paired with the sentence, never alone. */}
      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      <Text style={[type.sub, { color: colors.accent }]} numberOfLines={1}>
        {names.length === 1
          ? t('claim.oneShopping', { name: names[0] })
          : t('claim.manyShopping', { count: names.length })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
