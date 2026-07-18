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

// v2: start empty (no demo seeds).
const DATA_KEY = 'korb.pantry.v2';
const Ctx = createContext<PantryContext | null>(null);

export function PantryProvider({ children }: PropsWithChildren) {
  const [pantry, setPantry] = useState<PantryItem[]>([]);
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
