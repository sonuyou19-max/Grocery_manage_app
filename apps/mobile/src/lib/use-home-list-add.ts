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
  /** Add to a list the user picked; that list becomes the item's new home. */
  addToChosenList: (listId: string, name: string, category: ItemCategory) => void;
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

  const addToChosenList = useCallback(
    (listId: string, name: string, category: ItemCategory) => {
      const list = lists.find((l) => l.id === listId);
      if (!list) return;
      commit(list.id, list.name, name, category);
    },
    [lists, commit],
  );

  return { addToHomeList, addToChosenList };
}
