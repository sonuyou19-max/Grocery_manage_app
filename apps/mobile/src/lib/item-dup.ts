import { singularKey } from '@/lib/item-plural';
import { normalizeKey } from '@/lib/pantry-intel';

/**
 * "Is there already one of these on this list?" — asked in one place.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a one-liner at each call site
 * ---------------------------------------------------------------------------
 *
 * The database has an opinion about this and it is not advisory. Migration 0018
 * puts a unique index over `(list_id, item_key)` WHERE NOT checked, and
 * `item_key` is a stored generated column. So a second open row with the same
 * normalised name is not "a bit untidy" — it is an insert Postgres refuses with
 * 23505, and every write in this app is optimistic. The row appears, the server
 * says no, the store resyncs, and the user watches the thing they just added
 * disappear about a second later with nothing on screen to explain it.
 *
 * That exact sequence shipped three times, once per write path:
 *
 *   - the add bar, which checked with its own trim-and-lowercase and so missed
 *     "Olive  oil" with two spaces (fixed by normalizeKey — see 0018);
 *   - the item sheet's rename, which checked nothing at all, so renaming a
 *     typo'd "Oilve OLI" onto an existing "Olive Oil" produced a 409, a Sentry
 *     issue, and a rename that silently reverted;
 *   - AI quick-add, which correctly LABELLED the duplicates it found and then
 *     inserted them anyway when the user ticked one.
 *
 * Three call sites, three different amounts of care, one constraint. Hence one
 * function — and `store/groceries` routes its own add/rename/revive logic
 * through it too, so the check the UI makes and the check the store makes
 * cannot drift apart.
 *
 * ---------------------------------------------------------------------------
 * What counts as a duplicate
 * ---------------------------------------------------------------------------
 *
 * Any row on the list with the same key, ticked or not — because the two cases
 * are different but neither is "no match":
 *
 *   - an UNTICKED match is the one the index forbids. There is no "add anyway";
 *     the write cannot succeed, so the UI must not offer it.
 *   - a TICKED match is legal to duplicate (the index only covers open rows) and
 *     often correct: you bought milk this morning and need more. Adding is
 *     allowed, and reviving the ticked row is usually better still.
 *
 * Callers branch on `.checked`; this only finds the row.
 */

/** The fields identity depends on. Deliberately structural, so both the store's
 *  Item and anything list-shaped can be passed without adapting either. */
export interface DuplicateCandidate {
  id: string;
  name: string;
  checked: boolean;
}

/**
 * The row on `items` that collides with `name`, or null.
 *
 * `exceptId` is the rename path's whole reason for existing: an item is not its
 * own duplicate, and without the exclusion every rename that only changes case
 * or spacing ("olive oil" → "Olive Oil") would be refused by a check the
 * database would have been perfectly happy with.
 */
export function findDuplicate<T extends DuplicateCandidate>(
  items: readonly T[],
  name: string,
  exceptId?: string,
): T | null {
  const key = normalizeKey(name);
  if (!key) return null;
  return items.find((it) => it.id !== exceptId && normalizeKey(it.name) === key) ?? null;
}

/**
 * The row that is the same ITEM as `name`, allowing for plural form.
 *
 * ---------------------------------------------------------------------------
 * Why this is a second function and not a change to findDuplicate
 * ---------------------------------------------------------------------------
 *
 * The two are answering different questions and only one of them is the
 * database's. findDuplicate models the unique index exactly, which is what
 * makes it safe to decide whether an insert can succeed. This one models the
 * shopper: "Potatoes" typed onto a list that already says "Potato" is one
 * vegetable written twice, and Postgres will happily store both.
 *
 * That asymmetry decides where each is used. Anywhere the answer stops a write
 * — every add path — may use this one, because being loose here means an
 * insert that does not happen, and an insert that does not happen cannot fail.
 * The RENAME path must not: the constraint would allow "Potato" → "Potatoes",
 * so refusing it would be the app inventing a rule the database does not have
 * and blocking an edit the user is entitled to make.
 *
 * Exact matches are found first and returned first. A list holding both
 * "Potato" and "Potatoes" (which earlier versions allowed, and which existing
 * lists still contain) therefore still resolves "Potatoes" to the exact row
 * rather than to whichever came earlier in the array.
 */
export function findEquivalent<T extends DuplicateCandidate>(
  items: readonly T[],
  name: string,
  exceptId?: string,
): T | null {
  const exact = findDuplicate(items, name, exceptId);
  if (exact) return exact;

  const key = singularKey(name);
  if (!key) return null;
  return items.find((it) => it.id !== exceptId && singularKey(it.name) === key) ?? null;
}

/**
 * Collapse a batch of about-to-be-added items to one per name, keeping the
 * first.
 *
 * Needed because `addOrReviveItem` answers from the current RENDER's lists, and
 * a `for` loop adding ten things runs entirely within one render — so it cannot
 * see its own inserts. Ten distinct names is fine; a batch containing both
 * "olive oil" and "Olive Oil" is two inserts of one key, and the second is a
 * 23505 whose row vanishes a second later. Which batches can contain that is
 * not something the caller can promise: quick-add and the recipe importer both
 * get their names from a language model, and nothing makes a model say a thing
 * only once.
 *
 * First wins rather than last, so the item keeps the spelling nearest the top
 * of the review sheet — the one the user's eye settled on.
 *
 * Keyed on singularKey rather than normalizeKey, for the same reason
 * findEquivalent exists: a model asked for a recipe's ingredients has no
 * obligation to say "tomato" the same way twice, and "2 tomatoes" beside "1
 * tomato" is one ingredient listed twice, not two. Collapsing more here can
 * only ever mean fewer inserts, so it cannot create the 23505 this function was
 * written to avoid.
 */
export function dedupeByName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = singularKey(nameOf(it));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
