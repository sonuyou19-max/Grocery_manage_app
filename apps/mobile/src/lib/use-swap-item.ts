import { useCallback } from 'react';

import { asUnit, type ItemCategory } from '@korb/shared';

import { findEquivalent } from '@/lib/item-dup';
import { samePlural } from '@/lib/item-plural';
import { useGroceries, type Item, type List } from '@/store/groceries';

/**
 * Swapping one item for a lighter one, across every list it is open on.
 *
 * ---------------------------------------------------------------------------
 * Why the (+) on Your Climate Mix is not just an "add"
 * ---------------------------------------------------------------------------
 *
 * It used to be: tapping a lighter alternative filed it on its home list and
 * left the heavy item exactly where it was. So the one gesture the screen
 * exists for — "use this instead" — produced a list with BOTH on it, which is
 * the opposite of a swap and quietly increases the score the screen is there to
 * lower.
 *
 * ---------------------------------------------------------------------------
 * Why replacing is the exception rather than the rule
 * ---------------------------------------------------------------------------
 *
 * Heavy hitters are computed from the PURCHASE LOG, windowed to the range the
 * user picked — see climate.tsx. So the item is, by construction, something
 * already bought: checked off, and swept off its list some time after. For it
 * to still be open somewhere you must have re-added it since, which does happen
 * for the recurring staples that dominate this screen and is still the minority
 * case.
 *
 * That is why `plan()` returns a possibly-empty list of targets rather than a
 * yes/no, and why the caller treats empty as an ordinary add rather than as a
 * failure. The empty case is the common one.
 */

/** One open row that would be replaced. */
export interface SwapTarget {
  listId: string;
  listName: string;
  item: Item;
  /**
   * The replacement is already open on this list, so there is nothing to rename
   * onto — the swap is complete once the heavy item is gone.
   */
  replacementPresent: boolean;
}

export interface SwapPlan {
  from: string;
  to: string;
  toCategory: ItemCategory;
  targets: SwapTarget[];
  /** Rows somebody else has said they are getting. Empty on local lists. */
  claimedByOthers: SwapTarget[];
}

/**
 * How to put back what a swap changed.
 *
 * Captured BEFORE the edit rather than derived after it, because half of it is
 * gone by then: a renamed row no longer knows what it was called, and a deleted
 * one no longer exists to be asked.
 */
type UndoOp =
  | {
      kind: 'rename';
      listId: string;
      itemId: string;
      /** Everything the swap cleared, exactly as it stood. */
      was: Snapshot;
    }
  | {
      kind: 'restore';
      listId: string;
      was: Snapshot;
    };

interface Snapshot {
  name: string;
  category: ItemCategory;
  quantity: number | null;
  unit: string | null;
  priceCents: number | null;
  store: string | null;
  packs: number;
}

const snapshot = (item: Item): Snapshot => ({
  name: item.name,
  category: item.category,
  quantity: item.quantity,
  unit: item.unit,
  priceCents: item.priceCents,
  store: item.store,
  packs: item.packs,
});

export interface SwapItem {
  /** What a swap would do, without doing any of it. */
  planSwap: (from: string, to: string, toCategory: ItemCategory) => SwapPlan;
  /** Carry it out. Returns the inverse, for an Undo. */
  applySwap: (plan: SwapPlan) => UndoOp[];
  /** Put everything back. */
  undoSwap: (ops: UndoOp[]) => void;
}

/**
 * The decision, as a pure function over the lists.
 *
 * Separated from the hook because it is the part with judgement in it — which
 * rows count, whether the replacement is already there, whose trip is being
 * edited — and a hook that reaches into a React context can only be exercised
 * by rendering one. check-swap calls this directly with hand-built lists, so
 * the seven rules below are pinned by seven cases rather than by a comment.
 */
export function planSwapOver(
  lists: readonly List[],
  from: string,
  to: string,
  toCategory: ItemCategory,
): SwapPlan {
  const targets: SwapTarget[] = [];

  for (const list of lists) {
    /*
     * Unticked only, and that is not a filter for tidiness.
     *
     * A ticked row is a purchase that has already happened. Replacing it would
     * be the app editing history — claiming you bought lentils when you bought
     * beef — and the purchase log has already recorded the truth anyway. There
     * is nothing to swap; there is only something to buy differently next time.
     */
    const open = list.items.filter((it) => !it.checked);

    /*
     * ALL matches, not the first. The unique index permits only one row per
     * key, but "Potato" and "Potatoes" are two keys, and lists made before
     * lib/item-plural shipped still hold pairs like that. Swapping one and
     * leaving its twin is a worse outcome than doing both or doing neither.
     */
    const matches = open.filter((it) => samePlural(it.name, from));
    if (matches.length === 0) continue;

    /*
     * Every row, ticked included — which is deliberately WIDER than "is it
     * open" and exactly matches what renameItem will refuse.
     *
     * renameItem checks findDuplicate against the whole list, so a ticked
     * "Olive oil" blocks renaming onto that name even though the database's
     * index only covers open rows. Predicting that here rather than catching it
     * at apply time is what lets the plan say what will happen: findEquivalent
     * is a superset of findDuplicate, so finding nothing here guarantees the
     * rename succeeds, and finding something means we delete instead and never
     * attempt one.
     *
     * It is also the right answer on its own terms. If the list already says
     * you have the lighter item — bought or still to buy — then removing the
     * heavy one IS the swap.
     */
    const replacementPresent = findEquivalent(list.items, to) != null;

    for (const item of matches) {
      targets.push({ listId: list.id, listName: list.name, item, replacementPresent });
    }
  }

  return {
    from,
    to,
    toCategory,
    targets,
    // claimedBy is null on every local list, so this is empty unless the user
    // is in a household — which is exactly when it matters.
    claimedByOthers: targets.filter((t) => t.item.claimedBy != null),
  };
}

export function useSwapItem(): SwapItem {
  const { lists, renameItem, updateItem, deleteItem, addOrReviveItem } = useGroceries();

  const planSwap = useCallback(
    (from: string, to: string, toCategory: ItemCategory) =>
      planSwapOver(lists, from, to, toCategory),
    [lists],
  );

  const applySwap = useCallback(
    (plan: SwapPlan): UndoOp[] => {
      const undo: UndoOp[] = [];

      for (const target of plan.targets) {
        const was = snapshot(target.item);

        /*
         * The replacement is already on this list, so there is no rename to
         * make — removing the heavy item IS the swap.
         */
        if (target.replacementPresent) {
          deleteItem(target.listId, target.item.id);
          undo.push({ kind: 'restore', listId: target.listId, was });
          continue;
        }

        const result = renameItem(target.listId, target.item.id, plan.to);
        if (!result.ok) {
          /*
           * Unreachable by the plan's own reasoning: replacementPresent already
           * covers every row renameItem would object to. Reaching it means the
           * lists moved between planning and applying — a household member
           * adding the same item on their phone, arriving over realtime.
           *
           * So the row is left exactly as it is rather than deleted. A swap
           * that quietly does nothing to one list is recoverable by tapping
           * again; a swap that deletes the heavy item on a guess about what the
           * other person just did is not.
           */
          continue;
        }

        /*
         * Nothing carries over.
         *
         * The row survives the rename with all of its fields intact, and every
         * one of them is a fact about the OTHER product. "250 g" of butter is
         * not 250 g of olive oil; the price is what butter cost; the shop is
         * where butter was cheap. Leaving them is the same class of mistake as
         * the "you usually buy" prefill — an amount nobody entered, sitting in a
         * field the price history divides by.
         */
        updateItem(target.listId, target.item.id, {
          category: plan.toCategory,
          quantity: null,
          unit: null,
          priceCents: null,
          store: null,
          packs: 1,
        });
        undo.push({ kind: 'rename', listId: target.listId, itemId: target.item.id, was });
      }

      return undo;
    },
    [renameItem, updateItem, deleteItem],
  );

  const undoSwap = useCallback(
    (ops: UndoOp[]) => {
      for (const op of ops) {
        if (op.kind === 'rename') {
          // Name first: patching the fields of a row and then failing to rename
          // it would leave butter's price on a bottle of olive oil.
          const result = renameItem(op.listId, op.itemId, op.was.name);
          if (!result.ok) continue;
          updateItem(op.listId, op.itemId, {
            category: op.was.category,
            quantity: op.was.quantity,
            unit: op.was.unit,
            priceCents: op.was.priceCents,
            store: op.was.store,
            packs: op.was.packs,
          });
          continue;
        }

        /*
         * A deleted row comes back as a new one, and addOrReviveItem gives no id
         * back to patch — so the name, category, quantity and unit return and
         * the price, shop and pack count do not.
         *
         * Left as a known loss rather than papered over. It needs the
         * replacement to have already been on the same list, which is the rare
         * branch of an uncommon path; the alternative is threading an id back
         * through both backends' add path for this one caller, and a partial
         * undo that says what it did beats a wider API that no other screen
         * wants.
         */
        addOrReviveItem(op.listId, {
          name: op.was.name,
          category: op.was.category,
          quantity: op.was.quantity,
          // asUnit, not a cast: Item.unit is plain text and ParsedItem's is the
          // closed set, so a row holding something unexpected comes back with
          // no unit rather than smuggling an unknown one into the picker.
          unit: asUnit(op.was.unit),
        });
      }
    },
    [renameItem, updateItem, addOrReviveItem],
  );

  return { planSwap, applySwap, undoSwap };
}
