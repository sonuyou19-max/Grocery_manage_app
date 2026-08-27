import { Image } from 'expo-image';

/**
 * The basket, from the artwork rather than from a drawing of it.
 *
 * ---------------------------------------------------------------------------
 * Why this is a raster and not a vector
 * ---------------------------------------------------------------------------
 *
 * It was a vector, three times, and all three were wrong. I redrew the mark as
 * bezier paths from looking at it and produced three baskets that were
 * recognisably not the one in the brief — each attempt missing a different
 * detail, each one convinced by the last correction. Redrawing a logo is
 * tracing it badly, and "close enough" is a judgement the person who owns the
 * brand makes, not the person approximating it.
 *
 * So the artwork is the source: assets/brand/korb-source.png, traced by
 * scripts/gen-brand into a white-on-transparent PNG at 1024. Every place the
 * mark appears is 128dp or smaller, so a 1024 source is between eight and forty
 * times the pixels it is drawn at — a raster is only soft when it is stretched,
 * and this is only ever shrunk.
 *
 * ---------------------------------------------------------------------------
 * White, and tinted from there
 * ---------------------------------------------------------------------------
 *
 * The asset is white so `tintColor` can make it anything: tint replaces the
 * colour and keeps the alpha, so a white source tints cleanly to any hue while
 * a coloured one would muddy. It also means the untinted default is exactly
 * what the splash needs, which is where it is used most.
 */
export function KorbMark({
  size = 96,
  color,
}: {
  size?: number;
  /** Anything but white; left off, the artwork's own white is used. */
  color?: string;
}) {
  return (
    <Image
      source={require('../../assets/images/korb-mark.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      tintColor={color}
      // No fade. On the boot screen this picks up exactly where the native
      // splash left off, and the same mark dissolving back in reads as a
      // flicker at the one seam nobody should notice.
      transition={0}
    />
  );
}

/**
 * The wordmark, from the same artwork and by the same argument.
 *
 * Set rather than drawn: the reference letterforms are a specific face at a
 * specific tracking, and approximating them with the system font at weight 800
 * is the same mistake as redrawing the basket — near enough to look like a
 * mistake rather than a choice.
 *
 * Sized by HEIGHT, because that is what has to agree with the mark beside it.
 * The width follows from the artwork's own aspect, so the lockup cannot end up
 * with a stretched name.
 */
export function KorbWord({ height, color }: { height: number; color?: string }) {
  return (
    <Image
      source={require('../../assets/images/korb-word.png')}
      style={{ height, aspectRatio: WORD_ASPECT }}
      contentFit="contain"
      tintColor={color}
      transition={0}
    />
  );
}

/**
 * The wordmark's width over its height, measured from the traced artwork.
 *
 * A constant rather than a measurement: the lockup animates the row's offset by
 * half this width, and reading it from onLayout would mean the first frame of
 * that animation is a guess. gen-brand prints the piece's dimensions when it
 * runs, and check-brand asserts this still matches them.
 */
export const WORD_ASPECT = 325 / 103;
