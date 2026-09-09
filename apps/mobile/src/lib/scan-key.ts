import type { ScanInput } from '@/lib/receipt';

/**
 * A name for the scan you are about to send, decided before you send it.
 *
 * ---------------------------------------------------------------------------
 * What it is for
 * ---------------------------------------------------------------------------
 *
 * A read takes the better part of a minute and the phone locks after thirty
 * seconds. The upload dies with the JS thread; the model call it abandoned runs
 * to completion on the server and is billed. Without a name agreed in advance
 * there is no way to ask for that answer afterwards, so the shopper starts
 * again and pays twice for one read.
 *
 * With one, the server files the finished read under it and the client can come
 * back: on wake, on foreground, or on a second press of Scan. The retry is free
 * because the answer is already there, and the wait survives interruption
 * because the answer outlives the request.
 *
 * ---------------------------------------------------------------------------
 * Why it is a description and not a hash
 * ---------------------------------------------------------------------------
 *
 * Two constraints, and between them they rule out the obvious answer.
 *
 * It must exist BEFORE the read. That rules out `fingerprint()` — store, total
 * and printed time, none of which are known until the model has answered.
 *
 * And it must be computable on a phone with no native crypto module. There is
 * no expo-crypto in this app, and adding one would need a new binary — for a
 * fix whose whole point is reaching people over the air. Hashing four megabytes
 * of base64 in JavaScript instead would cost a visible pause at exactly the
 * moment the shopper pressed a button.
 *
 * So it describes the payload rather than digesting it: what the file is called
 * and how big it is. Two attempts at the same receipt agree because the same
 * file is the same length; two different receipts disagree because they are not.
 *
 * ---------------------------------------------------------------------------
 * What a collision would cost
 * ---------------------------------------------------------------------------
 *
 * Two DIFFERENT files, of byte-identical length, with the same name, scanned by
 * the same account, within the row's lifetime. The second would be answered
 * with the first one's read.
 *
 * That is worth stating plainly rather than waving away, and it is why the key
 * carries the length rather than the name alone — an emailed receipt is named
 * after its ticket number, and two of those differing only in content is not a
 * thing a till produces. The blast radius is one account's own receipt, and the
 * review sheet is a screen whose entire purpose is that a person checks the
 * lines before anything is written.
 */
export function scanKey(input: ScanInput, language: string): string {
  /*
   * The language is part of the key because it is part of the ANSWER: the read
   * carries `translated`, written for the reader. The same PDF scanned by a
   * Dutch reader and an English one are two different results, and serving one
   * to the other would be a receipt in a language nobody asked for.
   */
  const what =
    input.kind === 'images'
      ? // Sizes in order. The uris are not usable: the picker copies into the
        // cache with a fresh name every time, so the same photograph chosen
        // twice has two uris and would never match itself.
        `img:${input.images.map((i) => i.data.length).join(',')}`
      : `doc:${input.name ?? '?'}:${input.data.length}`;

  return `${what}|${language}`;
}
