import Svg, { G, Path } from 'react-native-svg';

/**
 * The basket, drawn rather than loaded.
 *
 * ---------------------------------------------------------------------------
 * Why a vector and not the PNG
 * ---------------------------------------------------------------------------
 *
 * The boot screen used to render `splash-icon.png` at 128dp. That is fine for
 * one fixed size on one screen, and wrong for a mark the app is now going to
 * use at several: a raster sized down to a tab bar's 24dp is soft in exactly
 * the places this shape has no margin for, and a white-on-transparent PNG can
 * only ever be white. This inherits a colour and stays crisp at any size.
 *
 * ---------------------------------------------------------------------------
 * The asymmetry is the mark
 * ---------------------------------------------------------------------------
 *
 * The handle does not arch symmetrically and meet the rim on both sides. It
 * rises on the left, goes over, and comes down THROUGH the rim to a rounded
 * terminal below it. That single detail is what stops this reading as a bucket
 * with a bar across it, and it is the thing a first attempt at this drops —
 * mine did, along with the slats, and the result was recognisably a basket and
 * recognisably not THIS basket.
 *
 * The two slats down the left are the other half of it. They are the most
 * fragile part at small sizes and they are kept anyway, because without them
 * the left of the basket is empty and the whole mark leans right.
 *
 * ---------------------------------------------------------------------------
 * Where it is legible, and where it is not
 * ---------------------------------------------------------------------------
 *
 * Drawn at 96 and rendered down: crisp at 128 and 56, muddy by 28. Every
 * current use is large — the icon, the adaptive foreground, the splash and the
 * boot screen — so it is drawn whole everywhere it appears today. `parts` is
 * how a small use would drop the slats rather than shipping mud; nothing needs
 * it yet, and inventing a second silhouette before something does is how a
 * brand ends up with two marks.
 *
export const KORB_PATHS = {
  /**
   * Up from the rim, over, and down THROUGH it to a rounded terminal. See
   * above: this stroke is the difference between the mark and a bucket.
   */
  handle: 'M32 41 C32 22 37.5 15.5 46 15.5 C55 15.5 61 22 60.5 31 L59.5 46',
  rim: 'M10 41 H86',
  /** Squat and wide with a narrow base — a basket seen from slightly above. */
  body: 'M17 41 L23.5 67 C24.6 73 28.5 76 34.5 76 H61.5 C67.5 76 71.4 73 72.5 67 L79 41',
  /** Weave down the left. Short of both ends, so they read as slats not walls. */
  slatA: 'M28 46 L31 70',
  slatB: 'M39.5 46 L41 72',
  /**
   * The app's one recurring gesture, sized to be the second thing seen. It
   * sits right of centre, which is where the slats are not — the basket's
   * middle is already spoken for.
   */
  check: 'M43.5 60 L50.5 67 L66.5 50.5',
} as const;

/** Stroke weight on the 96-unit grid. Scales with the mark. */
export const KORB_STROKE = 6.2;

export function KorbMark({
  size = 96,
  color = 'currentColor',
  /**
   * Which strokes to draw. Left undefined it draws whole, which is what every
   * caller wants today; see the note above on why a reduced variant is not
   * invented before something needs one.
   */
  parts,
}: {
  size?: number;
  color?: string;
  parts?: (keyof typeof KORB_PATHS)[];
}) {
  const keys = parts ?? (Object.keys(KORB_PATHS) as (keyof typeof KORB_PATHS)[]);
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      {/* One group carries the stroke settings, so a path added later cannot
          arrive with square caps and a different weight. */}
      <G
        fill="none"
        stroke={color}
        strokeWidth={KORB_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {keys.map((k) => (
          <Path key={k} d={KORB_PATHS[k]} />
        ))}
      </G>
    </Svg>
  );
}
