/**
 * Lightening a palette colour without making it translucent.
 *
 * Every chart in this app fades a slice from a wash of its colour into the full
 * colour. That wash used to be alpha — one hex per group, 45% opacity at the
 * start — and it is why the donut's tips read as discs stuck onto the ring:
 * translucency does not overwrite, it accumulates, so anywhere a shape overlaps
 * another the same colour was composited over itself and came out darker. Every
 * join had one.
 *
 * So the wash is computed instead. `mixHex` is the sum the compositor would
 * have done, performed once and baked into a hex, which means nothing on a
 * chart is see-through and an overlap is simply the top colour winning.
 *
 * The alternative — a second, lighter hex per group in the palette — is what
 * this exists to avoid. It would be five more colours to keep in step with the
 * five that already mean something on the list screen, and a tint chosen
 * against white goes muddy on a dark card. Mixing against whatever the slice
 * actually sits on gets both: one palette, and a start colour that is correct
 * in whichever theme is running.
 */

/** How much of a group's own colour survives at the start of its slice. */
export const CHART_FADE = 0.45;

/**
 * `color` laid over `onto` at `amount`, resolved to a hex.
 *
 * Exact at both ends by construction, and checked there: at 1 it must be the
 * palette colour itself, or the saturated end of every slice drifts quietly
 * off-palette and nothing on screen says so.
 */
export function mixHex(color: string, onto: string, amount: number): string {
  const a = channels(color);
  const b = channels(onto);
  const t = Math.max(0, Math.min(1, amount));
  return (
    '#' +
    a
      .map((v, i) => Math.round(v * t + b[i] * (1 - t)).toString(16).padStart(2, '0'))
      .join('')
  );
}

function channels(hex: string): number[] {
  const h = hex.replace('#', '');
  /*
   * Three-digit hex expands by DOUBLING each nibble — #abc is #aabbcc, not
   * #0a0b0c. Handled rather than assumed: the palette is six-digit today, and a
   * shorthand slipping in later would otherwise mix against something close to
   * black and look like a rendering fault rather than a parsing one.
   */
  const full =
    h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
