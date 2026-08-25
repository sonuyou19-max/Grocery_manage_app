import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { DUE_MARK, type StockGeometry, type StockTone } from '@/lib/pantry-intel';
import { useTheme } from '@/theme';

/**
 * How much of an item's usual interval has gone, drawn as a gauge.
 *
 * ---------------------------------------------------------------------------
 * A gauge, not a progress bar
 * ---------------------------------------------------------------------------
 *
 * The bar this replaces was a coloured fill whose LENGTH carried the reading
 * and whose colour was picked from the same number — so the colour said nothing
 * the length had not already said, and both ran out together at zero.
 *
 * Here the two are separated, and that is the whole idea. The track carries a
 * fixed colour SCALE — green early, amber approaching, red past due — painted
 * at the same place on every row in the list. The marker carries the reading.
 * Because the scale does not move, the marker's position means the same thing
 * on every row, and a column of rows can be read down at a glance: everything
 * still in the green is fine, everything past the notch is late.
 *
 * The obvious version is a gradient poured into the fill itself, which is what
 * the reference screenshot does. It looks the same on one row and is not the
 * same thing: a fill gradient is stretched to whatever length the fill happens
 * to be, so amber sits at a different real value on every row, and a full bar
 * and an empty one both go green→red. It is decoration wearing the costume of
 * a scale.
 *
 * ---------------------------------------------------------------------------
 * The notch
 * ---------------------------------------------------------------------------
 *
 * The track runs to one and a half intervals (see OVERDUE_ROOM), so "due" is a
 * point at DUE_MARK rather than the end of the bar, and there is room to the
 * right of it. That room is the point: a fill that stops dead at zero cannot
 * distinguish a day late from a fortnight late, and those want different
 * reactions. Here the marker keeps travelling and how far past the notch it has
 * gone is the answer.
 *
 * The notch is a tick UNDER the track, not a line across it. Across it, the
 * marker and the notch look like the same kind of object and the eye has to
 * work out which one is the value; below it, one is plainly a scale mark and
 * the other plainly a reading.
 *
 * ---------------------------------------------------------------------------
 * Nothing animates
 * ---------------------------------------------------------------------------
 *
 * A pantry is a long list and this draws once per row. A bar that grew on mount
 * would be forty bars growing at once, which is not delight, it is a screen
 * that will not settle — and the value it animates towards changes on the scale
 * of days, so there is no transition to show. The row's own swipe is the only
 * thing here that moves.
 */

/** The track's thickness. */
const TRACK_H = 8;
/**
 * Every other measurement is derived from those two, so the marker stays
 * centred on the track and the tick stays clear of it however the thickness is
 * tuned. Written out once here rather than as literals in the stylesheet: the
 * first version had the marker's box starting at the root's top edge, which
 * left it straddling nothing and hanging 8px below the track.
 */
const MARKER_OVERHANG = 3;
const MARKER_H = TRACK_H + MARKER_OVERHANG * 2;
const MARKER_W = 3;
/** Scale tick, below the track rather than across it. */
const TICK_H = 5;
const TICK_W = 2;
const TICK_GAP = 2;
const TRACK_TOP = MARKER_OVERHANG;
const TICK_TOP = TRACK_TOP + TRACK_H + TICK_GAP;
const ROOT_H = TICK_TOP + TICK_H;

/**
 * A hair of fill even at zero elapsed, so a just-bought item reads as "measured
 * and full" rather than as a row whose bar failed to draw.
 */
const MIN_POSITION = 0.02;

/**
 * Where the scale changes colour, in TRACK coordinates.
 *
 * The thresholds are stated in intervals elapsed — low at 0.65, critical at
 * 0.85, due at 1.0 — and the track spans 1.5 intervals, so each divides by 1.5:
 * 0.433, 0.567 and 0.667. The stops below are placed to blend ACROSS those
 * boundaries rather than to land on them, so each threshold falls in the middle
 * of its transition instead of at a visible seam. The exact boundary is carried
 * by the marker's own colour and by the words beside it, both of which come
 * from stockGeometry — this is the continuous reading, not the verdict.
 */
const SCALE_STOPS: readonly [number, number, ...number[]] = [0, 0.38, 0.5, 0.62, 1];

export function StockBar({ geo }: { geo: StockGeometry }) {
  const { colors } = useTheme();

  const toneColor: Record<StockTone, string> = {
    learning: colors.muted,
    ok: colors.accent,
    low: colors.warn,
    crit: colors.crit,
  };

  /*
   * Learning: a flat, quiet track and nothing else. See stockGeometry — an item
   * with no purchases has no reading, and the bar's job here is to look like an
   * empty instrument rather than to report a value it does not have.
   */
  if (geo.position == null) {
    return (
      <View style={styles.root}>
        <View style={[styles.track, { backgroundColor: colors.line, opacity: 0.5 }]} />
      </View>
    );
  }

  const p = Math.max(geo.position, MIN_POSITION);

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={[styles.track, { backgroundColor: colors.line }]}>
        {/*
         * The clip is the reading; the gradient inside it is the scale.
         *
         * The gradient is drawn at 100/p percent of the CLIP, which is exactly
         * 100% of the track — so it is always the full scale, cropped. That
         * ratio is why this needs no onLayout: the same result from a measured
         * pixel width, without a measurement pass per row and without the frame
         * of zero-width bars before it arrives.
         */}
        <View style={[styles.clip, { width: `${p * 100}%` }]}>
          <LinearGradient
            colors={[colors.accent, colors.accent, colors.warn, colors.crit, colors.crit]}
            locations={SCALE_STOPS}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.scale, { width: `${100 / p}%` }]}
          />
        </View>
      </View>

      {/* Due. */}
      <View style={[styles.tick, { left: `${DUE_MARK * 100}%`, backgroundColor: colors.muted }]} />

      {/*
       * The marker wears the row's tone and a surface-coloured outline, so it
       * stays visible where it sits on a band of its own colour — which is
       * where it sits most of the time, the scale and the tone being two
       * readings of the same number.
       */}
      <View
        style={[
          styles.marker,
          {
            // Clamped off the right edge: at exactly 100% half the marker hangs
            // outside the row's rounded corner and reads as clipped rather than
            // as pinned.
            left: `${Math.min(p, 0.985) * 100}%`,
            backgroundColor: toneColor[geo.tone],
            borderColor: colors.surface,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: ROOT_H },
  track: {
    height: TRACK_H,
    marginTop: TRACK_TOP,
    borderRadius: TRACK_H / 2,
    overflow: 'hidden',
  },
  clip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  scale: { height: '100%' },
  tick: {
    position: 'absolute',
    top: TICK_TOP,
    width: TICK_W,
    height: TICK_H,
    marginLeft: -TICK_W / 2,
    borderRadius: TICK_W / 2,
    opacity: 0.55,
  },
  marker: {
    position: 'absolute',
    top: 0,
    width: MARKER_W,
    height: MARKER_H,
    marginLeft: -MARKER_W / 2,
    borderRadius: MARKER_W / 2,
    borderWidth: 1,
  },
});
