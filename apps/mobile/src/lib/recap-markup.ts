/**
 * The one piece of markup the weekly recap is allowed to carry.
 *
 * ---------------------------------------------------------------------------
 * Why the recap has markup at all
 * ---------------------------------------------------------------------------
 *
 * It shipped as one unbroken paragraph — "You picked up 13 items this week with
 * a nice spread across your pantry — produce and other staples are taking up
 * most of the space, which is solid. Your top categories were…" — six lines of
 * even grey text on the first card of the tab. Every figure in it was worth
 * knowing and none of them could be found without reading the whole thing,
 * which is the opposite of what a summary is for.
 *
 * The prompt now asks for two or three short sentences with the numbers and
 * item names wrapped in `**`, and this turns those into bold runs. Nothing
 * else: no links, no headings, no italics. A recap is prose with a few facts
 * in it, and every additional syntax is another thing the model can get wrong
 * in seven languages.
 *
 * ---------------------------------------------------------------------------
 * The parser assumes the model will misbehave
 * ---------------------------------------------------------------------------
 *
 * A language model asked for `**` will sometimes produce one, or three, or none
 * at all, and older recaps cached on the device and in `household_recaps` were
 * written before the prompt asked for any. All of those must render as ordinary
 * text rather than as an error or as visible asterisks, so an unpaired marker
 * is simply left in the run it opened and the text survives intact.
 */

export interface RecapRun {
  text: string;
  bold: boolean;
}

/**
 * Split recap prose into plain and bold runs.
 *
 * Empty runs are dropped so a `**` at the very start or two markers back to
 * back cannot produce a zero-width <Text>, which React Native renders as a
 * stray line-height bump rather than as nothing.
 */
export function recapRuns(text: string): RecapRun[] {
  const parts = text.split('**');
  const runs: RecapRun[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    // Odd indices sit between a pair of markers — but only when a closing
    // marker actually followed. A trailing unpaired `**` leaves the final part
    // at an odd index with nothing after it, and that text is not bold, it is
    // text the model forgot to close.
    const closed = i % 2 === 1 && i < parts.length - 1;
    runs.push({ text: part, bold: closed });
  }

  return runs;
}
