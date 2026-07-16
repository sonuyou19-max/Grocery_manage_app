// Supabase Edge Function: categorize
// Classifies a single grocery item name into one of Korb's fixed categories.
// Called only for items the on-device keyword map + cache couldn't resolve, so
// the client caches the answer and never asks twice for the same word.
//
// Deploy:  supabase functions deploy categorize
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

const CATEGORIES = [
  'fruit_veg',
  'dairy_eggs',
  'meat_fish',
  'bakery',
  'pantry',
  'frozen',
  'drinks',
  'household',
  'personal_care',
  'other',
] as const;

type Category = (typeof CATEGORIES)[number];

const SYSTEM_PROMPT = `You classify a single grocery item into exactly one category.
Reply with ONLY the category slug, nothing else.
Categories: ${CATEGORIES.join(', ')}.
Guidance: produce/herbs -> fruit_veg; milk/cheese/eggs -> dairy_eggs; fresh meat/fish -> meat_fish;
bread/pastries -> bakery; dry/canned/staples/condiments -> pantry; frozen goods -> frozen;
beverages -> drinks; cleaning/paper/kitchen -> household; toiletries/cosmetics -> personal_care.
If genuinely unclear, reply other.`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'Body must be {"name": string}' }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: name.trim() }],
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  const category: Category = (CATEGORIES as readonly string[]).includes(raw)
    ? (raw as Category)
    : 'other';

  return Response.json({ category });
});
