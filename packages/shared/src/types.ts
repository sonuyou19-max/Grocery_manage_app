/**
 * Domain types shared between the mobile app and Supabase edge functions.
 * Mirrors the SQL schema in supabase/migrations — keep the two in sync.
 */

export type HouseholdRole = 'owner' | 'member';

export interface Household {
  id: string;
  name: string;
  created_at: string;
}

export interface HouseholdMember {
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  display_name: string;
  joined_at: string;
}

export interface ShoppingList {
  id: string;
  household_id: string;
  name: string;
  store: string | null;
  archived: boolean;
  created_at: string;
}

export type ItemCategory =
  | 'fruit_veg'
  | 'dairy_eggs'
  | 'meat_fish'
  | 'bakery'
  | 'pantry'
  | 'frozen'
  | 'drinks'
  | 'household'
  | 'personal_care'
  | 'other';

export interface ListItem {
  id: string;
  list_id: string;
  name: string;
  category: ItemCategory;
  quantity: number | null;
  unit: string | null; // metric: g, kg, ml, L, pcs
  /** Pricing is always optional — null means the user chose not to log it. */
  price_cents: number | null;
  currency: string; // ISO 4217, default EUR
  note: string | null;
  checked: boolean;
  position: number;
  added_by: string | null;
  created_at: string;
}

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: ItemCategory;
  /** 0..1 estimated stock remaining. */
  stock_level: number;
  /** Learned average days between purchases; null until enough data. */
  avg_purchase_interval_days: number | null;
  last_purchased_at: string | null;
  /** Predicted date the household runs out; recomputed by the backend job. */
  predicted_out_at: string | null;
  created_at: string;
}

/** One purchase/consumption signal — the raw feed for restock predictions. */
export interface ConsumptionEvent {
  id: string;
  household_id: string;
  pantry_item_id: string;
  kind: 'purchased' | 'ran_out' | 'adjusted';
  quantity: number | null;
  unit: string | null;
  occurred_at: string;
}

export interface PriceEntry {
  id: string;
  household_id: string;
  item_name: string;
  store: string | null;
  price_cents: number;
  currency: string;
  recorded_at: string;
}
