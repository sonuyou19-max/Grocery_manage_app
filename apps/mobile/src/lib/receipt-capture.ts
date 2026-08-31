/**
 * How big a photograph of a receipt should be.
 *
 * ---------------------------------------------------------------------------
 * Why this is a decision and not a default
 * ---------------------------------------------------------------------------
 *
 * A phone camera shoots twelve megapixels. Base64-encoded that is roughly five
 * megabytes per shot, four shots is twenty, and receipt-scan refuses anything
 * over 1.4MB an image — so the naive version fails on the first real receipt,
 * at the till, after the user has taken four photographs.
 *
 * Shrinking it is not a loss either, which is the part worth knowing: the vision
 * API resizes anything longer than about 1568px on its long edge before it looks
 * at it. Everything above that is bytes uploaded over a supermarket's wifi to be
 * thrown away at the other end.
 *
 * So the target is a little above that threshold — enough that the API's own
 * resize does the last step from a real image rather than from one already
 * softened — and the camera is asked to CAPTURE at that size rather than
 * capturing huge and shrinking afterwards. Shrinking afterwards would need
 * expo-image-manipulator, which is a native dependency, which means this whole
 * feature could no longer ship over the air.
 *
 * ---------------------------------------------------------------------------
 * Why not simply lower the quality
 * ---------------------------------------------------------------------------
 *
 * JPEG quality and pixel count are not interchangeable here. A receipt is small
 * high-contrast text, which survives compression well and does not survive
 * downsampling at all — the strokes are one or two pixels wide. So resolution
 * is chosen first and quality second, rather than shooting full-size and
 * squeezing until it fits.
 */

/**
 * Long edge to aim for, in pixels.
 *
 * Above the vision API's own 1568px ceiling by a small margin. Going higher
 * uploads bytes that get resized away; going lower hands the model an image
 * already softer than it needs to be, and the first thing to disappear from a
 * receipt is the decimal point.
 */
export const TARGET_LONG_EDGE = 1600;

/**
 * JPEG quality.
 *
 * ---------------------------------------------------------------------------
 * This was 0.6, and the reasoning for it was backwards
 * ---------------------------------------------------------------------------
 *
 * The old note said high-contrast black on white made 0.6 generous, because
 * "the artefacts JPEG produces at this quality are in gradients, and a receipt
 * has none". That has it exactly the wrong way round. Smooth gradients are what
 * the DCT encodes WELL; what it handles badly is a hard edge, which it
 * reconstructs with ringing either side and blocking around it. Till printing
 * is nothing but hard edges — thin strokes, one or two pixels wide at the
 * resolution this sends — so a receipt is close to the worst case for JPEG
 * rather than the best.
 *
 * The visible cost is small and specific: a comma smeared into a full stop, a 3
 * that reads as an 8, a decimal point that ringing has filled in. Every one of
 * those is a wrong number that looks like a right one.
 *
 * ---------------------------------------------------------------------------
 * The headroom was there the whole time
 * ---------------------------------------------------------------------------
 *
 * MAX_IMAGE_CHARS allows about 1.4MB per shot. At the resolution this captures,
 * 0.6 produces roughly a fifth of that — so the ceiling was never the binding
 * constraint and the compression was buying nothing anybody needed. 0.85 is
 * still comfortably inside it, and if a device does overshoot, the retry below
 * catches it.
 *
 * Raising it does not fix a photograph that is out of focus, badly lit, or
 * mostly table. Those cost far more than the codec does, and no setting here
 * reaches them.
 */
export const CAPTURE_QUALITY = 0.85;

/**
 * Quality for the second attempt, when the first came back over the ceiling.
 *
 * Reached only when `pickPictureSize` could not bound the resolution — a camera
 * whose smallest offer is enormous, or one that refused to list its sizes at
 * all. Low enough to make a real difference to the file, and still far above
 * where JPEG starts eating the thin strokes of till printing.
 */
export const FALLBACK_QUALITY = 0.6;

/** Sections of one receipt. Beyond four, the photographs are the problem. */
export const MAX_SHOTS = 4;

/**
 * The size the camera should capture at, from the list it says it supports.
 *
 * `getAvailablePictureSizesAsync` returns strings like "1920x1080". Picking the
 * SMALLEST one whose long edge still clears the target: the sizes a device
 * offers are arbitrary and unsorted, and the two obvious shortcuts are both
 * wrong. Taking the first is taking whatever the vendor happened to list first;
 * taking the largest is the twelve-megapixel problem this exists to avoid.
 *
 * Returns null when nothing clears the target, which means the caller should
 * leave `pictureSize` unset and let the camera use its own default — a device
 * whose best offer is below 1600px wants all the pixels it has.
 */
export function pickPictureSize(sizes: readonly string[], target = TARGET_LONG_EDGE): string | null {
  let best: { size: string; longEdge: number } | null = null;

  for (const size of sizes) {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
    // Anything unparseable is skipped rather than guessed at: a vendor string
    // this does not understand is not a size worth risking a failed upload on.
    if (!m) continue;
    const longEdge = Math.max(Number(m[1]), Number(m[2]));
    if (longEdge < target) continue;
    if (!best || longEdge < best.longEdge) best = { size, longEdge };
  }

  return best?.size ?? null;
}

/**
 * Is this encoded image small enough to send?
 *
 * The same ceiling receipt-scan enforces, checked before the upload rather than
 * after it. A refusal at the function is a round trip over supermarket wifi and
 * a message about a limit; a refusal here is an immediate "take that one
 * again", while the receipt is still in shot.
 */
export const MAX_IMAGE_CHARS = 1_900_000;

export function tooLarge(base64: string): boolean {
  return base64.length > MAX_IMAGE_CHARS;
}
