import * as ImagePicker from 'expo-image-picker';

import { CAPTURE_QUALITY, MAX_SHOTS, tooLarge } from '@/lib/receipt-capture';

/**
 * Where a receipt comes from, now that it is not always a piece of paper.
 *
 * ---------------------------------------------------------------------------
 * Why there are three
 * ---------------------------------------------------------------------------
 *
 * The camera was the whole feature, and it assumed a till printed something.
 * Increasingly one does not: Colruyt, Carrefour and Aldi will all email a PDF
 * instead, and a shopper who chose the paperless option has a receipt they
 * cannot photograph. Pointing a camera at a phone screen is not a workaround —
 * it is a moiré pattern with prices in it.
 *
 *   CAMERA   The till printed one and it is in your hand. Unchanged.
 *   PHOTOS   Somebody already photographed it, or the shop's app exported a
 *            screenshot. Same pipeline as the camera from the moment the
 *            images exist — including the confirm strip, because a screenshot
 *            of a receipt can be just as unreadable as a bad photograph.
 *   FILE     The emailed PDF, straight through. No confirm step: there is
 *            nothing to judge about a PDF's legibility that looking at a
 *            thumbnail would tell you.
 *
 * ---------------------------------------------------------------------------
 * The two pickers live here rather than in the screen
 * ---------------------------------------------------------------------------
 *
 * Both have the same three outcomes — picked, cancelled, too big — and all
 * three have to be distinguishable by the caller: cancelled means "go back
 * quietly", too big means "say something", and only picked continues. Returning
 * a discriminated result rather than a nullable keeps the screen from having to
 * infer which of the three happened from an empty array.
 */
export type ReceiptSource = 'camera' | 'photos' | 'file';

export const RECEIPT_SOURCES: readonly ReceiptSource[] = ['camera', 'photos', 'file'];

/** Whether a route param names a source. Params are strings from anywhere. */
export function isReceiptSource(value: unknown): value is ReceiptSource {
  return typeof value === 'string' && (RECEIPT_SOURCES as readonly string[]).includes(value);
}

/**
 * How much PDF the scanner will take, as base64 characters.
 *
 * Four megabytes of base64 is about three of file, which is a large emailed
 * receipt and a long way short of what the model will accept. The bound is not
 * about the model: it is about a phone on a supermarket's wifi uploading
 * something it will wait two minutes for, and about an endpoint that anybody
 * with an account can call.
 */
export const MAX_PDF_CHARS = 4_000_000;

export const PDF_MEDIA = 'application/pdf';

export type PickedImages =
  | { status: 'picked'; images: { uri: string; base64: string }[] }
  | { status: 'cancelled' }
  | { status: 'tooLarge' }
  /** The library was refused, or the picker threw. Both need saying. */
  | { status: 'denied' }
  | { status: 'failed' };

export type PickedDocument =
  | { status: 'picked'; name: string; data: string }
  | { status: 'cancelled' }
  | { status: 'tooLarge' }
  | { status: 'wrongType' }
  /** This binary has no document picker in it. See `documentPicker` below. */
  | { status: 'unavailable' }
  /** The picker threw. Silence here was a dead screen. */
  | { status: 'failed' };

/**
 * The two NATIVE modules the PDF path needs, loaded only if this binary has
 * them — the same shape, and for the same reason, as lib/push's notifications().
 *
 * ---------------------------------------------------------------------------
 * Why not a top-level import
 * ---------------------------------------------------------------------------
 *
 * The app ships JavaScript over the air and these arrived with a feature, so
 * there is a window — every time somebody skips a build — where a new bundle
 * runs on an older binary that has neither. A static import in that situation
 * does not degrade: it throws while the module graph is still being evaluated,
 * and this module is reached from the receipt screen's import chain. The app
 * fails to start, taking every other fix in the same update with it.
 *
 * The existing Android APK is exactly that binary: SDK 54, built before either
 * package existed. A feature that cannot work there is fine; one that stops it
 * opening is not.
 *
 * Resolved once, on first use. `require` rather than `await import()`, which is
 * what this was: a dynamic import is still a static edge to Metro, so it buys
 * nothing at runtime and cannot be caught this way.
 */
type PickerModule = typeof import('expo-document-picker');
type FsModule = typeof import('expo-file-system');

let native: { picker: PickerModule; fs: FsModule } | null | undefined;
function documentPicker(): { picker: PickerModule; fs: FsModule } | null {
  if (native !== undefined) return native;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const picker = require('expo-document-picker') as PickerModule;
    const fs = require('expo-file-system') as FsModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    native = { picker, fs };
  } catch {
    native = null;
  }
  return native;
}

/**
 * Receipt photographs already on the phone.
 *
 * Multi-select, capped at the same MAX_SHOTS the camera allows — a long receipt
 * photographed in sections is the case this exists for, and the reason for the
 * cap is what the model is asked to read, not where the pictures came from.
 *
 * `quality` matters as much here as at the camera. The picker re-encodes, and
 * the default is low enough to lose the decimal point on a thermal print — see
 * CAPTURE_QUALITY, which is the same number for the same reason.
 */
export async function pickReceiptPhotos(): Promise<PickedImages> {
  /*
   * Asked for explicitly, rather than left to the picker to raise.
   *
   * On Android the library needs permission and `launchImageLibraryAsync`
   * THROWS without it — which, from the screen, is indistinguishable from the
   * picker never opening. Asking first turns that into an answer the caller can
   * put on screen.
   */
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
  } catch {
    // Some platforms have nothing to ask. Not a refusal — carry on and let the
    // picker itself be the thing that fails, if anything does.
  }

  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_SHOTS,
      quality: CAPTURE_QUALITY,
      base64: true,
    });
  } catch {
    /*
     * A throw here was a SILENT DEAD SCREEN. The call sat in an unawaited async
     * IIFE, so a rejection went nowhere and the person was left looking at a
     * screen that had not opened anything and could not say why.
     */
    return { status: 'failed' };
  }
  if (picked.canceled) return { status: 'cancelled' };

  const images: { uri: string; base64: string }[] = [];
  for (const asset of picked.assets) {
    if (!asset.base64) continue;
    // The same ceiling the camera path enforces. A 12-megapixel library photo
    // is comfortably over it, and the scanner refuses what it cannot upload.
    if (tooLarge(asset.base64)) return { status: 'tooLarge' };
    images.push({ uri: asset.uri, base64: asset.base64 });
  }
  // Every asset lacking base64 is not "cancelled" — something was chosen and
  // none of it survived, which the caller must be able to say out loud.
  return images.length > 0 ? { status: 'picked', images } : { status: 'tooLarge' };
}

/**
 * A PDF receipt, from Files, Drive, or wherever the email was saved.
 *
 * Type-checked twice over. `type: 'application/pdf'` asks the OS picker to
 * offer only PDFs, and the extension is checked afterwards because that filter
 * is a hint on Android — a provider is free to hand back anything, and the
 * scanner would spend a vision call finding out.
 */
export async function pickReceiptDocument(): Promise<PickedDocument> {
  const mod = documentPicker();
  // An older binary running a newer bundle. Everything else in this update
  // works; this one source waits for a build, and says so.
  if (!mod) return { status: 'unavailable' };

  /*
   * Wrapped, because `require` succeeding is not the same as the NATIVE module
   * being there. Metro bundles the JS wrapper either way, so a binary without
   * the native side gets past documentPicker() and throws HERE instead — which
   * was a screen that opened nothing and said nothing.
   */
  let picked: Awaited<ReturnType<PickerModule['getDocumentAsync']>>;
  try {
    picked = await mod.picker.getDocumentAsync({
      type: PDF_MEDIA,
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    return { status: 'failed' };
  }
  if (picked.canceled) return { status: 'cancelled' };

  const asset = picked.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const named = asset.name ?? 'receipt.pdf';
  const looksPdf =
    asset.mimeType === PDF_MEDIA || named.toLowerCase().endsWith('.pdf');
  if (!looksPdf) return { status: 'wrongType' };

  let data: string;
  try {
    data = await new mod.fs.File(asset.uri).base64();
  } catch {
    return { status: 'failed' };
  }
  if (!data || data.length > MAX_PDF_CHARS) return { status: 'tooLarge' };

  return { status: 'picked', name: named, data };
}
