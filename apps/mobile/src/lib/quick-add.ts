import type { ParsedItem } from '@korb/shared';

import { fold } from '@/lib/item-emoji';
import { learnLexiconEntry } from '@/lib/item-lexicon';
import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

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
      headers: await aiFunctionHeaders(),
      body: JSON.stringify({ text }),
    });
    if (res.status === 422) return { error: 'noItems' };
    if (res.status === 429) return { error: 'rateLimited' };
    if (!res.ok) return { error: 'aiError' };
    const data = (await res.json()) as { items?: (ParsedItem & { emoji?: string | null })[] };
    if (!data.items || data.items.length === 0) return { error: 'noItemsRetry' };

    /*
     * File each glyph on THIS device immediately.
     *
     * The server offers them to the shared dictionary too, but publication waits
     * for three unrelated households to type the same term (migration 0019). So
     * without this the person who actually paid for the call would keep seeing
     * the generic category icon until two strangers happened to say the same
     * thing — which is how quick-add ended up the only route that used AI every
     * time and learned nothing from it.
     *
     * The response may predate this field: `emoji` is optional above and skipped
     * when absent, so a client running ahead of the deployed function behaves
     * exactly as it did before rather than erroring.
     */
    for (const item of data.items) {
      if (typeof item.emoji === 'string' && item.emoji.length > 0 && item.emoji.length <= 8) {
        learnLexiconEntry(fold(item.name), item.emoji, item.category, item.unit, null, null);
      }
    }
    return { items: data.items };
  } catch {
    return { error: 'network' };
  }
}
