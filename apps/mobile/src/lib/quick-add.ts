import type { ParsedItem } from '@korb/shared';

import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

/**
 * Machine-readable failure reasons. The caller maps these to a localized
 * message (via the translation catalog) so this network layer stays free of
 * UI strings.
 */
export type QuickAddError = 'noItems' | 'rateLimited' | 'aiError' | 'noItemsRetry' | 'network';

/**
 * Turn a free-text (typed or dictated) utterance into structured grocery items
 * via the quick-add-parse edge function. Output is validated server-side
 * before it reaches us.
 */
export async function parseQuickAdd(
  text: string,
): Promise<{ items?: ParsedItem[]; error?: QuickAddError }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/quick-add-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ text }),
    });
    if (res.status === 422) return { error: 'noItems' };
    if (res.status === 429) return { error: 'rateLimited' };
    if (!res.ok) return { error: 'aiError' };
    const data = (await res.json()) as { items?: ParsedItem[] };
    if (!data.items || data.items.length === 0) return { error: 'noItemsRetry' };
    return { items: data.items };
  } catch {
    return { error: 'network' };
  }
}
