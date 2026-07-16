import { StyleSheet, Text, View } from 'react-native';

import { customInitials, getSupermarket } from '@/lib/supermarkets';
import { useTheme } from '@/theme';

/**
 * Brand-colored monogram badge for a store. Known chains use their brand color;
 * custom store names fall back to a neutral badge with derived initials.
 */
export function SupermarketBadge({ store, size = 22 }: { store: string; size?: number }) {
  const { colors } = useTheme();
  const known = getSupermarket(store);

  const bg = known?.color ?? colors.line;
  const initials = known?.initials ?? customInitials(store);
  const fg = known ? (known.darkText ? '#1B2417' : '#FFFFFF') : colors.muted;

  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={[styles.text, { color: fg, fontSize: size * 0.42 }]} numberOfLines={1}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800' },
});
