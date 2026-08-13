/**
 * A stable colour per list, for the tags that say where an item lives.
 *
 * ---------------------------------------------------------------------------
 * Why the colour is derived, not stored
 * ---------------------------------------------------------------------------
 *
 * The tags exist to be told apart at a glance — "this is on the weekly shop AND
 * the gnocchi recipe" is a two-second read only if the two chips look different.
 * That could be done by cycling a palette by position, but position is not
 * stable: the same list is the first tag on one item and the second on another,
 * so the weekly shop would keep changing colour as you moved between items and
 * the colour would carry no meaning at all.
 *
 * Hashing the list id instead makes the colour a property OF THE LIST. It is
 * the same everywhere the list appears, for as long as the list exists, with
 * nothing to store, migrate, or keep in step across devices. Two lists can
 * collide onto one hue — with six hues that is not rare — but the tag also
 * carries the list's name, so a collision costs a little scanning speed and
 * never any information.
 *
 * FNV-1a, not a sum of char codes. List ids are UUIDs that share long common
 * substrings, and a plain sum maps anagrams and near-identical strings to
 * neighbouring buckets — which is exactly the input this gets.
 */

import type { ColorScheme } from '@/theme';

export interface ListTint {
  bg: string;
  fg: string;
}

/**
 * Six hues, each defined for both schemes.
 *
 * Deliberately desaturated. These sit inside a sheet next to body copy, so they
 * have to read as labels rather than compete with the accent colour that marks
 * the things you can actually press.
 */
const TINTS: Record<ColorScheme, ListTint[]> = {
  light: [
    { bg: '#DCEBDF', fg: '#2E6B3F' },
    { bg: '#D9E6F2', fg: '#2B5F8A' },
    { bg: '#E4DDF0', fg: '#5B4593' },
    { bg: '#F3E6CC', fg: '#8A5F0F' },
    { bg: '#D6EBE8', fg: '#1F6B63' },
    { bg: '#F4DCDF', fg: '#98394A' },
  ],
  dark: [
    { bg: '#1E3A28', fg: '#8FD3A3' },
    { bg: '#1C3244', fg: '#8CC0E8' },
    { bg: '#2B2440', fg: '#B8A6E8' },
    { bg: '#3A2E14', fg: '#E0BC6A' },
    { bg: '#12332F', fg: '#7FCFC4' },
    { bg: '#3A2126', fg: '#E39AA6' },
  ],
};

export const LIST_TINT_COUNT = TINTS.light.length;

/** FNV-1a, 32-bit. Cheap, and it scatters strings that share long prefixes —
 *  which UUIDs from the same generator very often do. */
const hash = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export function listTint(listId: string, scheme: ColorScheme): ListTint {
  const palette = TINTS[scheme];
  return palette[hash(listId) % palette.length];
}
