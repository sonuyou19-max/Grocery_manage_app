import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import type { ItemCategory } from '@korb/shared';

import { categorize } from '@/lib/categorize';

/**
 * In-memory grocery store. Holds the app's lists, items and pantry so the UI
 * is fully interactive on-device before the Supabase backend is wired in.
 * State lives for the session only — replaced by realtime queries next phase.
 */

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  quantity: number | null;
  unit: string | null;
  /** null = user chose not to log a price (pricing is always optional). */
  priceCents: number | null;
  checked: boolean;
}

export interface List {
  id: string;
  name: string;
  store: string | null;
  items: Item[];
}

export interface PantryItem {
  id: string;
  name: string;
  note: string;
  /** 0..1 estimated stock remaining. */
  left: number;
  eta: string;
}

interface GroceriesContext {
  lists: List[];
  pantry: PantryItem[];
  addList: (name: string) => string;
  addItem: (listId: string, name: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
  setItemPrice: (listId: string, itemId: string, priceCents: number | null) => void;
  addPantryItem: (name: string) => void;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${counter++}`;

const item = (
  name: string,
  category: ItemCategory,
  opts: Partial<Item> = {},
): Item => ({
  id: uid('i'),
  name,
  category,
  quantity: null,
  unit: null,
  priceCents: null,
  checked: false,
  ...opts,
});

const SEED_LISTS: List[] = [
  {
    id: uid('l'),
    name: 'Weekly groceries',
    store: 'Lidl',
    items: [
      item('Potatoes', 'fruit_veg', { quantity: 2, unit: 'kg', priceCents: 229 }),
      item('Tomatoes', 'fruit_veg', { quantity: 500, unit: 'g', priceCents: 179 }),
      item('Semi-skimmed milk', 'dairy_eggs', { quantity: 2, unit: 'L', priceCents: 218, checked: true }),
      item('Gouda, young', 'dairy_eggs', { quantity: 400, unit: 'g', priceCents: 428 }),
      item('Eggs, free-range', 'dairy_eggs', { quantity: 10, unit: 'pcs', checked: true }),
      item('Sourdough loaf', 'bakery', { quantity: 1 }),
    ],
  },
  {
    id: uid('l'),
    name: 'Saturday market',
    store: null,
    items: [
      item('Apples', 'fruit_veg', { quantity: 1, unit: 'kg' }),
      item('Basil', 'fruit_veg'),
      item('Sourdough loaf', 'bakery'),
    ],
  },
];

const SEED_PANTRY: PantryItem[] = [
  { id: uid('p'), name: 'Semi-skimmed milk', note: 'usually lasts 5 days', left: 0.12, eta: '~1 day left' },
  { id: uid('p'), name: 'Espresso beans', note: 'usually lasts 18 days', left: 0.26, eta: '~3 days left' },
  { id: uid('p'), name: 'Olive oil', note: '1 L · usually lasts 2 months', left: 0.7, eta: '~5 weeks left' },
];

const Ctx = createContext<GroceriesContext | null>(null);

export function GroceriesProvider({ children }: PropsWithChildren) {
  const [lists, setLists] = useState<List[]>(SEED_LISTS);
  const [pantry, setPantry] = useState<PantryItem[]>(SEED_PANTRY);

  const value = useMemo<GroceriesContext>(
    () => ({
      lists,
      pantry,
      addList: (name) => {
        const id = uid('l');
        setLists((prev) => [...prev, { id, name, store: null, items: [] }]);
        return id;
      },
      addItem: (listId, name) => {
        const clean = name.trim();
        if (!clean) return;
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? { ...l, items: [...l.items, item(clean, categorize(clean))] }
              : l,
          ),
        );
      },
      toggleItem: (listId, itemId) => {
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((it) =>
                    it.id === itemId ? { ...it, checked: !it.checked } : it,
                  ),
                }
              : l,
          ),
        );
      },
      setItemPrice: (listId, itemId, priceCents) => {
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((it) =>
                    it.id === itemId ? { ...it, priceCents } : it,
                  ),
                }
              : l,
          ),
        );
      },
      addPantryItem: (name) => {
        const clean = name.trim();
        if (!clean) return;
        setPantry((prev) => [
          ...prev,
          { id: uid('p'), name: clean, note: 'learning your usage…', left: 1, eta: 'just added' },
        ]);
      },
    }),
    [lists, pantry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGroceries(): GroceriesContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGroceries must be used within GroceriesProvider');
  return ctx;
}

/** Convenience selector for a single list. */
export function useList(listId: string | undefined): List | undefined {
  const { lists } = useGroceries();
  return lists.find((l) => l.id === listId);
}
