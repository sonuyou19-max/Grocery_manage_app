import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

/**
 * Pantry stays on-device for now (its shape doesn't map cleanly to the
 * consumption-events model yet). Persisted to AsyncStorage so it survives
 * restarts. Household-shared pantry comes in a later phase.
 */

export interface PantryItem {
  id: string;
  name: string;
  note: string;
  /** 0..1 estimated stock remaining. */
  left: number;
  eta: string;
}

interface PantryContext {
  pantry: PantryItem[];
  addPantryItem: (name: string) => void;
}

let counter = 0;
const uid = () => `p_${Date.now().toString(36)}_${counter++}`;

const SEED_PANTRY: PantryItem[] = [
  { id: uid(), name: 'Semi-skimmed milk', note: 'usually lasts 5 days', left: 0.12, eta: '~1 day left' },
  { id: uid(), name: 'Espresso beans', note: 'usually lasts 18 days', left: 0.26, eta: '~3 days left' },
  { id: uid(), name: 'Olive oil', note: '1 L · usually lasts 2 months', left: 0.7, eta: '~5 weeks left' },
];

const DATA_KEY = 'korb.pantry.v1';
const Ctx = createContext<PantryContext | null>(null);

export function PantryProvider({ children }: PropsWithChildren) {
  const [pantry, setPantry] = useState<PantryItem[]>(SEED_PANTRY);
  const hydrated = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(DATA_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as PantryItem[];
          if (Array.isArray(parsed)) setPantry(parsed);
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true;
      });
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(DATA_KEY, JSON.stringify(pantry)).catch(() => {});
  }, [pantry]);

  const value = useMemo<PantryContext>(
    () => ({
      pantry,
      addPantryItem: (name) => {
        const clean = name.trim();
        if (!clean) return;
        setPantry((prev) => [
          ...prev,
          { id: uid(), name: clean, note: 'learning your usage…', left: 1, eta: 'just added' },
        ]);
      },
    }),
    [pantry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePantry(): PantryContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePantry must be used within PantryProvider');
  return ctx;
}
