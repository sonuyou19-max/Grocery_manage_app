import { useCallback } from 'react';

import type { ItemCategory } from '@korb/shared';

import { useToast } from '@/components/toast';
import { recallItemList } from '@/lib/item-home-list';
import { useGroceries } from '@/store/groceries';
import { useT } from '@/store/locale';

/**
 * Single-item "add to list" routing, shared by the Pantry tab swipe and the
 * Vibe Check deck so both behave identically.
 *
 * An item goes back to its **home list** — the list it was last added to —
 * without asking, confirmed by a soft toast so you still know where it landed.
 * Only when there's no usable home do we interrupt with the list picker.
 *
 * A remembered id can be unusable for three reasons, all handled the same way:
 * the item is new, its list was deleted, or you signed in and household lists
 * are a different id space from the local ones. Resolving the id against the
 * live lists covers all three without needing to tell them apart.
 *
 * Scope is deliberately single-item: the weekly-list builder keeps its own
 * one-destination picker, because a generated weekly shop belongs on one list
 * rather than scattered across each item's home.
 */

export interface HomeListAdd {
  /**
   * File the item on its home list. Returns false if there is no usable home —
   * the caller should then open the list picker and call `addToChosenList`.
   */
  addToHomeList: (name: string, category: ItemCategory) => boolean;
  /**
   * Add to a list the user picked; that list becomes the item's new home.
   *
   * The list's NAME is passed in rather than looked up, and that is the whole
   * point of this signature. It used to resolve the id against `lists` and
   * return silently when it found nothing — which is exactly what happens when
   * the list was created a moment ago in the picker: `addList` returns the new
   * id synchronously, but `lists` is still the array from the last render. So
   * "New list…" from the Pantry created the list and dropped the item, and
   * swiping again worked, because by then the render had caught up.
   *
   * The lookup only ever existed to fill in the toast. The caller already knows
   * the name — it either read it off the row it tapped or just typed it — so it
   * says so, and there is nothing left to fail.
   */
  addToChosenList: (
    listId: string,
    listName: string,
    name: string,
    category: ItemCategory,
  ) => void;
}

export function useHomeListAdd(): HomeListAdd {
  const { lists, addOrReviveItem } = useGroceries();
  const { showToast } = useToast();
  const t = useT();

  const commit = useCallback(
    (listId: string, listName: string, name: string, category: ItemCategory) => {
      // addOrReviveItem records the home list on every branch, so simply adding
      // an item somewhere else re-homes it.
      addOrReviveItem(listId, { name, category, quantity: null, unit: null });
      showToast(t('toast.addedTo', { item: name, list: listName }));
    },
    [addOrReviveItem, showToast, t],
  );

  const addToHomeList = useCallback(
    (name: string, category: ItemCategory) => {
      const homeId = recallItemList(name);
      const home = homeId ? lists.find((l) => l.id === homeId) : undefined;
      if (!home) return false;
      commit(home.id, home.name, name, category);
      return true;
    },
    [lists, commit],
  );

  // No lookup, and so no way to fail. See the interface for what the lookup
  // used to cost.
  const addToChosenList = useCallback(
    (listId: string, listName: string, name: string, category: ItemCategory) =>
      commit(listId, listName, name, category),
    [commit],
  );

  return { addToHomeList, addToChosenList };
}
