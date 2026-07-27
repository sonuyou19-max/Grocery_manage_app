import { StyleSheet, Text } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { emojiFor } from '@/lib/item-emoji';

/**
 * The little picture in front of an item's name.
 *
 * Two things it does that a bare `<Text>{emoji}</Text>` wouldn't:
 *
 * - **Fixed width.** Emoji glyphs vary in advance width, so rendered inline the
 *   names below each other would sit at ragged left edges. A fixed, centred box
 *   keeps the column straight however wide the glyph is.
 * - **Hidden from screen readers.** It is decoration: the item's name is right
 *   next to it and already read out. Announcing "carrot emoji, Carrots" is
 *   noise, so this is skipped in the accessibility tree.
 */
export function ItemEmoji({
  name,
  category,
  size = 17,
  /** Dimmed for items already ticked off, matching the muted row text. */
  dim = false,
}: {
  name: string;
  category: ItemCategory;
  size?: number;
  dim?: boolean;
}) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.glyph,
        { fontSize: size, width: size * 1.45, lineHeight: size * 1.3 },
        dim && styles.dim,
      ]}
    >
      {emojiFor(name, category)}
    </Text>
  );
}

const styles = StyleSheet.create({
  glyph: { textAlign: 'center' },
  dim: { opacity: 0.45 },
});
