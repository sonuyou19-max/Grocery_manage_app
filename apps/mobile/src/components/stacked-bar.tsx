import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { CHART_FADE, mixHex } from '@/lib/color-mix';
import { useTheme } from '@/theme';

/**
 * One weighted bar of coloured segments, shared by the two cards that draw one.
 *
 * "In your basket" (food groups) and "Your climate mix" (carbon tiers) were the
 * same twenty lines twice, and both were a flat `flex: count` per segment with
 * hard vertical joins. This is that idea done once, wearing the donut's
 * language: the same fade into the same saturated end, the same opaque
 * arithmetic, so the three charts in Insights read as three views of one system
 * rather than as three charts.
 *
 * They stay bars. A basket is a handful of items you are about to buy and reads
 * left to right; a pantry is a standing composition of a whole. Different
 * questions, different shapes — only the treatment is shared.
 *
 * ---------------------------------------------------------------------------
 * Rounded at both ends, and the overlap is a whole bar-height
 * ---------------------------------------------------------------------------
 *
 * Every segment is a pill, so the bar's two outer ends are round and every
 * internal joint is a curve. A pill's cap narrows away from full height over
 * its last half-height, so a neighbour has to lie underneath to fill what the
 * curve gives up — and how far under is the only number here that is easy to
 * get wrong.
 *
 * Half a height is the intuitive answer and it leaves a pinch. Two caps meeting
 * that way are two arcs crossing, not one filling the other: at the midpoint
 * each is at sin(60°) of full height, so the join is visibly waisted, top and
 * bottom, by about a pixel. It looks like a rendering fault.
 *
 * A FULL height is the answer. The next segment starts BAR_H before the
 * boundary, which puts its own left cap entirely behind the previous segment's
 * square middle, and leaves it at full height across the whole span the
 * previous segment's right cap curves through. Nothing is waisted anywhere.
 *
 * ---------------------------------------------------------------------------
 * Percentages for the shares, pixels for the overlap, and no measuring
 * ---------------------------------------------------------------------------
 *
 * The shares are fractions and the overlap is a fixed number of pixels, which
 * usually means measuring the bar to combine them. It does not here: each
 * segment is a percentage-positioned box holding a child that hangs BAR_H past
 * its left edge. The box carries the fraction, the child carries the pixels,
 * and neither needs to know the other's units.
 *
 * That matters more than saving a render pass. Measured, the bar draws empty on
 * its first frame and fills on the second — on a card that is itself arriving,
 * that reads as a glitch in the card.
 *
 * The flex version of the same trick — negative margins on `flex: share`
 * children — is the one thing that does NOT work. Flex distributes the space a
 * negative margin frees up in proportion to the shares, so every boundary moves
 * by a different amount: on three equal thirds the first join lands two thirds
 * of a bar-height late, about 3% of the width, silently.
 *
 * ---------------------------------------------------------------------------
 * Painted back to front
 * ---------------------------------------------------------------------------
 *
 * The earlier segment has to be on top, so what shows at a join is its
 * saturated cap over its neighbour's washed start. Forwards, each segment's
 * pale left end would be laid over the previous segment's darkest point — the
 * boundary would read as a light notch, and the fade would appear to run
 * backwards.
 */

/** Bar height, the cap diameter, and the overlap. All the same number. */
export const BAR_H = 16;

export interface BarSegment {
  key: string;
  /** 0..1. The caller has already decided the order; this does not sort. */
  share: number;
  color: string;
}

/** One segment's box, as percentages of the bar's width. */
export interface SegmentBox {
  /** Distance from the left edge, 0..100. */
  left: number;
  /** Distance from the right edge, 0..100. */
  right: number;
  /** Whether the pill hangs past its box to underlap the segment before it. */
  underlaps: boolean;
}

/**
 * Where each segment's box sits, as percentages.
 *
 * Pure and exported because it is the part that can be wrong without looking
 * wrong: a bar is read as proportions and nothing on screen states them, so a
 * boundary a few percent off is a chart lying quietly. check-stacked-bar
 * re-derives the visible extents from what this returns.
 *
 * The box is the segment's TRUE span. The underlap is added by the child in
 * pixels, and lands under the previous segment — so what a reader sees is
 * exactly the box, which is exactly the share.
 *
 * The last segment is pinned to the right edge rather than left where the
 * running total ends. Shares that ought to sum to 1 arrive as five rounded
 * fractions, and the few thousandths they are short would show as a sliver of
 * track inside a rounded corner — which reads as the bar failing to finish.
 */
export function barBoxes(shares: readonly number[]): SegmentBox[] {
  let start = 0;
  return shares.map((share, i) => {
    const left = start;
    start += share;
    return {
      left: left * 100,
      right: i === shares.length - 1 ? 0 : Math.max(0, (1 - start) * 100),
      underlaps: i > 0,
    };
  });
}

export function StackedBar({ segments }: { segments: readonly BarSegment[] }) {
  const { colors } = useTheme();
  const boxes = barBoxes(segments.map((s) => s.share));

  return (
    <View style={[styles.track, { backgroundColor: colors.line }]}>
      {/*
        Reversed, so the first segment ends up highest. See the note above: the
        saturated cap belongs on top of the washed start, not under it.
      */}
      {segments
        .map((seg, i) => ({ seg, box: boxes[i] }))
        .reverse()
        .map(({ seg, box }) => (
          <View
            key={seg.key}
            pointerEvents="none"
            style={[styles.box, { left: `${box.left}%`, right: `${box.right}%` }]}
          >
            <LinearGradient
              colors={[mixHex(seg.color, colors.line, CHART_FADE), seg.color]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.pill, { left: box.underlaps ? -BAR_H : 0 }]}
            />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: BAR_H,
    borderRadius: BAR_H / 2,
    /*
     * Clips nothing in the ordinary case — the outer segments' caps have the
     * same radius as the track, so they land on it exactly. It is here for the
     * case where they do not: a share that rounds a hair past 1 would otherwise
     * poke a square corner out of a rounded bar.
     */
    overflow: 'hidden',
  },
  box: { position: 'absolute', top: 0, bottom: 0 },
  /*
   * The pill, hanging past its box's left edge by a whole bar-height. `right:
   * 0` keeps its own end pinned to the box's, so the underlap lengthens it
   * backwards rather than sliding it.
   */
  pill: { position: 'absolute', top: 0, bottom: 0, right: 0, borderRadius: BAR_H / 2 },
});
