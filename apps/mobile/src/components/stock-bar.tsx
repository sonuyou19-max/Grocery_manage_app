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
 * Here the two are separated, and that is still the whole idea. The MARKER
 * carries the reading and the notch marks due, so a marker's position means the
 * same thing on every row and a column of rows can be read straight down.
 *
 * ---------------------------------------------------------------------------
 * Why the track no longer paints the scale
 * ---------------------------------------------------------------------------
 *
 * It used to. The track held a fixed colour SCALE — green early, amber
 * approaching, red past due — drawn as a gradient sized to the whole track and
 * then cropped to the reading, so that amber always sat at the same real value
 * rather than being stretched to whatever length the fill happened to be. On
 * one row that is a genuinely better instrument than a coloured progress bar,
 * and the argument for it was right as far as it went.
 *
 * It went as far as one row. Cropping the full scale to the reading means an
 * OVERDUE item is cropped at about 95% and therefore paints nearly all of it —
 * green through amber to red, at full saturation, every time. A pantry that has
 * not been shopped has thirty-three of those, and thirty-three identical
 * rainbows carry no information at all: the scale can only be compared between
 * rows when the rows differ, and here they do not. What it does carry is the
 * bar's area in saturated colour, roughly ten times the red ink of the words
 * beside it. Reported, accurately, as "the red colour is bothering me".
 *
 * So the geometry stays and the paint goes. The track is neutral, the travelled
 * part is the tone at FILL_ALPHA — enough to see the reading without the eye
 * being called to it — and the marker is the one saturated object on the row.
 * The verdict was never the bar's job anyway: the words next to it say it, and
 * they are what a reader actually reads.
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
 * How much of the tone the travelled part of the track gets, as a hex alpha.
 *
 * 0x38 is 22%. The number is doing one job: make the fill legible as a length
 * without letting it register as a colour. Anything much higher and a list of
 * overdue rows is back to being a wall of red — which is the fault this
 * replaced, so treating the fill as somewhere to restore contrast would undo
 * it. The reading is legible because it is a LENGTH against a neutral track,
 * and the marker at its end is at full strength.
 *
 * Suffixed onto the token rather than given a token of its own: it has to work
 * over `surface` in both palettes, and a fixed pale red is right on one of them
 * at most. Same reasoning, and the same idiom, as the emoji tile's wash.
 */
const FILL_ALPHA = '38';

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
         * The reading, as a length. A percentage of the track rather than a
         * measured width, which is why this needs no onLayout: no measurement
         * pass per row, and no frame of zero-width bars before it arrives.
         *
         * The tone at FILL_ALPHA, never at full strength — see the note there.
         * The saturated copy of this colour is the marker at its end.
         */}
        <View
          style={[
            styles.fill,
            { width: `${p * 100}%`, backgroundColor: toneColor[geo.tone] + FILL_ALPHA },
          ]}
        />
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
  // In flow inside the track, which already clips and rounds — so the fill's
  // leading end takes the track's radius and its trailing end stays square,
  // which is what makes it read as a level rather than as a pill.
  fill: { height: '100%' },
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
