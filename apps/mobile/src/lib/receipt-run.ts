import {
  applyAiMatches,
  claimedIds,
  groupLines,
  matchPurchases,
  matchResidue,
  residue,
  scanReceipt,
  type ListCandidate,
  type MatchOutcome,
  type ReceiptPurchase,
  type ScannedReceipt,
} from '@/lib/receipt';

/**
 * One scan, from photographs to a reviewable answer.
 *
 * ---------------------------------------------------------------------------
 * Why the whole sequence lives here rather than in the capture screen
 * ---------------------------------------------------------------------------
 *
 * There are six steps between a photograph and something a person can check,
 * two of them are network calls, and the ORDER of the last four is load-bearing:
 * the free rungs must run before the model is asked anything, the model must be
 * told which list rows the free rungs already took, and its answers must be
 * folded in without being allowed to overrule them. Written inline in a screen
 * that also owns a camera, that ordering is one careless edit from being wrong,
 * and wrong here is silent — a price on the wrong row of somebody's list.
 *
 * So the screen owns the camera and this owns the pipeline.
 */

/**
 * Where a scan has got to, for the screen that is waiting on it.
 *
 * Two, and only two, because two is how many round trips there are. It would be
 * easy to invent five and animate between them on a timer, and it would be a
 * lie the moment a receipt took twice as long as expected — the caption would
 * say "almost done" while nothing was happening. These fire when the work
 * actually moves.
 */
export type ScanPhase = 'reading' | 'matching';

export interface ScanRun {
  receipt: ScannedReceipt;
  purchases: ReceiptPurchase[];
  matches: Map<string, MatchOutcome>;
}

export async function runScan(
  images: { media: string; data: string }[],
  language: string,
  list: readonly ListCandidate[],
  onPhase?: (phase: ScanPhase) => void,
): Promise<ScanRun | null> {
  onPhase?.('reading');
  const receipt = await scanReceipt(images, language);
  if (!receipt) return null;

  const purchases = groupLines(receipt.lines);
  const offline = matchPurchases(purchases, list);

  /*
   * The model gets only what is left, and only the rows still free. Both halves
   * matter: asking about a settled line spends money to be told what
   * normalizeKey already proved, and offering a row that is spoken for invites
   * the one answer that cannot be shown to be wrong.
   *
   * matchResidue returns [] on every failure, so a matcher that is down or
   * refused by the rate cap leaves those lines unmatched. That is a review
   * sheet with more rows to correct, not a failed import.
   */
  const left = residue(purchases, offline);
  // Announced only when there is something to ask about. A receipt the free
  // rungs settled entirely never enters this phase, and saying it had would be
  // the same invention the phase list exists to avoid.
  if (left.length > 0) onPhase?.('matching');
  const answers = await matchResidue(left, list, claimedIds(offline), language);
  const matches = applyAiMatches(offline, answers, list);

  return { receipt, purchases, matches };
}

/* ------------------------------------------------------------ hand-off --- */

/**
 * The scan, in transit between the camera and the review sheet.
 *
 * A module holder rather than a route param because the run is a Map and a few
 * hundred fields deep — expo-router params are a URL, and serialising this
 * through one would be lossy in exactly the places that carry money.
 *
 * `takeRun` CONSUMES it. That is the whole reason this is a function and not an
 * exported variable: a run left lying about is a receipt somebody has already
 * imported, and the failure it invites — landing on the review sheet by a back
 * gesture and importing yesterday's shop a second time — is both plausible and
 * expensive. Read once, then gone.
 */
let pending: ScanRun | null = null;

export function stashRun(run: ScanRun): void {
  pending = run;
}

export function takeRun(): ScanRun | null {
  const run = pending;
  pending = null;
  return run;
}
