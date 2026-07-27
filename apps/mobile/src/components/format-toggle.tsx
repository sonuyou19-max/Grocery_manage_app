import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardFormat } from '@/lib/barcode';
import { useT } from '@/store/locale';
import { radii, spacing, type, useTheme } from '@/theme';

/**
 * Barcode ⟷ QR, for a loyalty card.
 *
 * This has to be the user's choice, not ours. Which *linear* symbology to use is
 * inferable from the digits (length plus a valid check digit is a strong
 * signal), but 1D-vs-2D is not inferable at all — the same twelve digits are a
 * barcode on one chain's card and a QR on another's. Colruyt issues QR, Delhaize
 * issues a barcode, and nothing in the number says which.
 *
 * Deliberately two options rather than the six symbologies the encoder supports.
 * "Is it a square or a set of lines?" is a question anyone can answer by looking
 * at their card; "is it Code 128 or ITF-14?" is not.
 */

interface FormatToggleProps {
  value: CardFormat;
  onChange: (format: CardFormat) => void;
  /** Shown above the control; omit inside an already-labelled section. */
  label?: string;
}

export function FormatToggle({ value, onChange, label }: FormatToggleProps) {
  const { colors } = useTheme();
  const t = useT();

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[type.label, { color: colors.muted }]}>{label}</Text> : null}
      <View style={styles.row}>
        <Option
          icon="barcode-outline"
          text={t('cards.formatBarcode')}
          active={value === 'barcode'}
          onPress={() => onChange('barcode')}
        />
        <Option
          icon="qr-code-outline"
          text={t('cards.formatQr')}
          active={value === 'qr'}
          onPress={() => onChange('qr')}
        />
      </View>
    </View>
  );
}

function Option({
  icon,
  text,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[
        styles.option,
        {
          borderColor: active ? colors.accent : colors.line,
          backgroundColor: active ? colors.accentSoft : colors.surface,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.muted} />
      {/* Icon plus word: the two formats must never be distinguished by shape
          alone, and the words are what a user matches against their card. */}
      <Text style={[type.sub, { color: active ? colors.accent : colors.ink }]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    minWidth: 0,
  },
});
