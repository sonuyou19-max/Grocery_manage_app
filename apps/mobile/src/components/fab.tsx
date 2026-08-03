import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/components/floating-tab-bar';
import { radii, spacing, type, useTheme } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

// Icon/label row height plus vertical padding, rounded up. Exported so Screen
// can reserve enough bottom clearance to actually clear the Fab — not just
// its offset above the tab bar — on short screens.
export const FAB_HEIGHT = 48;

/**
 * Air between the Fab and the floating tab bar below it.
 *
 * Was `spacing.md` — 12dp — which is less than the tab bar's own drop shadow
 * reaches, so the two elements read as one stacked blob rather than two things
 * that happen to float. 24 separates them without pushing the Fab up into the
 * content.
 *
 * Exported because `Screen` reserves the same value as bottom padding; if the
 * two drift, the last card slides under the Fab on a short list.
 */
export const FAB_GAP = spacing.xl;

interface FabProps {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  /**
   * Clear the floating tab bar. True on tab screens; set false on pushed
   * routes (which have no tab bar) so the Fab doesn't hover in empty space.
   */
  aboveTabBar?: boolean;
}

/** Floating primary action, bottom-right, hovering above the floating tab bar. */
export function Fab({ label, icon = 'add', onPress, aboveTabBar = true }: FabProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = aboveTabBar
    ? insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + FAB_GAP
    : insets.bottom + spacing.lg;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, { backgroundColor: colors.accent, bottom }]}
      android_ripple={{ color: colors.accentInk }}
    >
      <Ionicons name={icon} size={20} color={colors.accentInk} />
      <Text style={[type.body, { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    shadowColor: '#0A2A14',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
