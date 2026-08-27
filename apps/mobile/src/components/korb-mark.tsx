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
 * Four strokes, and the count is the design
 * ---------------------------------------------------------------------------
 *
 * The reference art has ribs down the inside of the basket. They are the first
 * thing to turn to mud: at 28dp they cross the check and the mark reads as a
 * scribble. What survives shrinking is the silhouette — a handle, a rim, a
 * taper — and one gesture inside it. So the ribs are gone, deliberately, and
 * the check is what the extra ink is spent on: it is the app's one recurring
 * shape, on every ticked row and every imported line.
 *
 * ---------------------------------------------------------------------------
 * These strings are the brand
 * ---------------------------------------------------------------------------
 *
 * The same `d` values are in assets/brand/*.svg, which is what the app icon,
 * the Android adaptive icon and the splash PNG are rasterised from. Two copies
 * of a logo drift, and a logo that drifts is one the icon and the app disagree
 * about — so check-brand asserts every path here appears in every one of those
 * files, and fails the build rather than letting them part company.
 */
export const KORB_PATHS = {
  /** Rises from the rim and returns to it, so the two read as one object. */
  handle: 'M33 40 C33 20 39.5 14 48 14 C56.5 14 63 20 63 40',
  rim: 'M12 40 H84',
  /** Sides tapering into a base with real corner radius: a basket, not a bucket. */
  body: 'M20.5 40 L26.5 70 C27.6 76 31.5 79 37.5 79 H58.5 C64.5 79 68.4 76 69.5 70 L75.5 40',
  /**
   * Centred in the BODY's width rather than the viewBox's — the taper moves the
   * middle down here, and a check centred on 48 sits visibly left of the space
   * it is in.
   */
  check: 'M37.5 56.5 L44.5 63.5 L59 49',
} as const;

/** Stroke weight on the 96-unit grid. Scales with the mark. */
export const KORB_STROKE = 6.5;

export function KorbMark({
  size = 96,
  color = 'currentColor',
  /**
   * Fraction of the mark to draw, 0..1, in stroke order: handle, rim, body,
   * check. Left undefined it draws whole — the animated lockup is the only
   * caller that wants anything else.
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
