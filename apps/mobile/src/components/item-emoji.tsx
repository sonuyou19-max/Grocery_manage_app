import { useSyncExternalStore } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { emojiFor } from '@/lib/item-emoji';
import { lexiconVersion, subscribeLexicon } from '@/lib/item-lexicon';

/**
 * The little picture in front of an item's name.
 *
 * Three things it does that a bare `<Text>{emoji}</Text>` wouldn't:
 *
 * - **Fixed width.** Emoji glyphs vary in advance width, so rendered inline the
 *   names below each other would sit at ragged left edges. A fixed, centred box
 *   keeps the column straight however wide the glyph is.
 * - **Hidden from screen readers.** It is decoration: the item's name is right
 *   next to it and already read out. Announcing "carrot emoji, Carrots" is
 *   noise, so this is skipped in the accessibility tree.
 * - **Repaints when the lexicon learns.** `emojiFor` reads a module-level map
 *   that the AI response fills in a second or two after an unknown item is
 *   added. Without a subscription the row would keep its generic category icon
 *   until something unrelated re-rendered it. useSyncExternalStore is the right
 *   shape here precisely because the map is not React state — it is read during
 *   render by pure code, and threading it through a context would mean changing
 *   every call site of a function that is meant to be callable from anywhere.
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
  useSyncExternalStore(subscribeLexicon, lexiconVersion, lexiconVersion);
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
