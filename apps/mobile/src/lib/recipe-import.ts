import { asUnit } from '@korb/shared';

import { aiFunctionHeaders, supabaseUrl } from '@/lib/supabase';

import type { ParsedRecipe } from '@/lib/recipe';

/**
 * The client half of recipe import: one call, three outcomes.
 *
 * The failures are named rather than collapsed into "something went wrong",
 * because they need different sentences on screen. "We couldn't reach that
 * page" and "that page has no ingredient list" lead a user to different next
 * actions, and this feature lives or dies on whether the failure path is
 * survivable — scraping the open web fails often and normally.
 */
export type ImportOutcome =
  | { status: 'ok'; recipe: ParsedRecipe }
  /** Fetched nothing: blocked, offline, not a page, too many redirects. */
  | { status: 'unreachable' }
  /** Got the page, found no ingredients in it. */
  | { status: 'noRecipe' }
  /** Rate limited or the AI budget is spent — worth saying, and try later. */
  | { status: 'busy' }
  | { status: 'failed' };

export async function importRecipe(input: { url?: string; text?: string }): Promise<ImportOutcome> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/recipe-import`, {
      method: 'POST',
      headers: await aiFunctionHeaders(),
      body: JSON.stringify(input),
    });

    if (res.status === 429 || res.status === 503) return { status: 'busy' };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'unreachable') return { status: 'unreachable' };
      if (body.error === 'no_recipe') return { status: 'noRecipe' };
      return { status: 'failed' };
    }

    const data = (await res.json()) as {
      name?: string;
      servings?: number | null;
      items?: Array<{ name?: string; quantity?: number | null; unit?: string | null }>;
    };
    const items = (data.items ?? [])
      .map((it) => ({
        name: String(it.name ?? '').trim(),
        quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : null,
        // asUnit, not a cast: the function validates too, but a client that
        // trusts a server's contract is one that breaks when the contract does.
        unit: asUnit(it.unit),
      }))
      .filter((it) => it.name);

    // The function already refuses to return an empty list, but a client that
    // trusts a server's contract is a client that crashes when the contract
    // changes.
    if (items.length === 0) return { status: 'noRecipe' };

    return {
      status: 'ok',
      recipe: {
        name: String(data.name ?? '').trim(),
        servings: typeof data.servings === 'number' ? data.servings : null,
        items,
      },
    };
  } catch {
    return { status: 'unreachable' };
  }
}
