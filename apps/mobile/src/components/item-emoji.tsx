import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '@korb/shared';

import { emojiFor } from '@/lib/item-emoji';
import { lexiconVersion, subscribeLexicon } from '@/lib/item-lexicon';
import { radii, useTheme } from '@/theme';

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
  /**
   * An explicit glyph, skipping the name lookup.
   *
   * For the callers that already KNOW the emoji and would only lose by asking —
   * the seasonal grid holds a table keyed by produce key, which is right in all
   * seven languages, while `emojiFor` matches translated words and has none of
   * them (every seasonal row used to draw the generic leaf). They still want the
   * fixed width, the hidden-from-screen-readers behaviour and the shared sizing,
   * which is the whole reason this is a prop rather than a second component.
   */
  glyph,
  /**
   * Draw it on a soft tile instead of bare — the leading column of a row.
   *
   * ---------------------------------------------------------------------------
   * Why the tile is a NEUTRAL wash and not the accent
   * ---------------------------------------------------------------------------
   *
   * Every coloured thing on a pantry or list row already means something: green
   * is on track or ticked off, amber is due soon or already on a list, red is
   * overdue. A tinted tile behind the glyph either repeats one of those facts or
   * borrows a hue that had a job. So the tile is the muted ink at low opacity —
   * a wash with no meaning, which is exactly what is wanted underneath a picture
   * whose whole purpose is to say WHICH item this is.
   *
   * It also gives a column of rows a straight rail to follow. Bare glyphs vary
   * in advance width and in how much ink they carry, so a list of them reads as
   * a ragged left edge however carefully the box is sized.
   *
   * `size` stays the GLYPH's size; the tile is derived from it, so a caller asks
   * for the picture it wants and gets a proportionate frame.
   */
  tile = false,
}: {
  name: string;
  category: ItemCategory;
  size?: number;
  dim?: boolean;
  glyph?: string;
  tile?: boolean;
}) {
  useSyncExternalStore(subscribeLexicon, lexiconVersion, lexiconVersion);
  const { colors } = useTheme();

  const mark = (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.glyph,
        { fontSize: size, width: size * 1.45, lineHeight: size * 1.3 },
        dim && styles.dim,
      ]}
    >
      {glyph ?? emojiFor(name, category)}
    </Text>
  );

  if (!tile) return mark;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.tile,
        {
          width: size * 1.8,
          height: size * 1.8,
          borderRadius: radii.md,
          // The muted ink at a low alpha rather than a token of its own: it has
          // to sit on `surface` in light and dark, and a fixed pale green works
          // on one of those only.
          backgroundColor: colors.muted + '1F',
        },
        dim && styles.dim,
      ]}
    >
      {mark}
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { textAlign: 'center' },
  dim: { opacity: 0.45 },
  tile: { alignItems: 'center', justifyContent: 'center' },
});
