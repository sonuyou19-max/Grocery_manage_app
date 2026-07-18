import type { ParsedItem } from '@korb/shared';

import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

/**
 * Turn a free-text (typed or dictated) utterance into structured grocery items
 * via the quick-add-parse edge function. Output is validated server-side
 * before it reaches us.
 */
export async function parseQuickAdd(
  text: string,
): Promise<{ items?: ParsedItem[]; error?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/quick-add-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ text }),
    });
    if (res.status === 422) {
      return { error: 'Couldn’t find any groceries in that — try naming the items plainly.' };
    }
    if (!res.ok) {
      return { error: 'The AI had trouble with that. Please try again.' };
    }
    const data = (await res.json()) as { items?: ParsedItem[] };
    if (!data.items || data.items.length === 0) {
      return { error: 'Couldn’t find any groceries in that — try again.' };
    }
    return { items: data.items };
  } catch {
    return { error: 'Couldn’t reach the AI. Check your connection and try again.' };
  }
}
