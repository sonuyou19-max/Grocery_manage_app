// Supabase Edge Function: categorize
// Classifies a single grocery item name into one of Korb's fixed categories,
// and (in the same call, so it's ~free) a coarse food group for the basket
// balance insight. Called only for items the on-device keyword map + cache
// couldn't resolve, so the client caches the answer and never asks twice.
//
// Deploy:  supabase functions deploy categorize
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

const CATEGORIES = [
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
] as const;
type Category = (typeof CATEGORIES)[number];

const GROUPS = ['protein', 'carbs', 'produce', 'fats', 'other', 'nonfood'] as const;
type Group = (typeof GROUPS)[number];

const SYSTEM_PROMPT = `You classify a single grocery item.
Return ONLY a JSON object, no prose, no code fences: {"category": "...", "group": "..."}.
category is one of: ${CATEGORIES.join(', ')}.
- produce/herbs -> fruit_veg; milk/cheese/eggs -> dairy_eggs; fresh meat/fish -> meat_fish;
  bread/pastries -> bakery; dry/canned/staples/condiments -> pantry; frozen goods -> frozen;
  beverages -> drinks; cleaning/paper/kitchen -> household; toiletries/cosmetics -> personal_care;
  if genuinely unclear, other.
group is the coarse food group, one of: ${GROUPS.join(', ')}.
- meat/fish/eggs/tofu/beans/lentils/high-protein dairy -> protein;
  bread/pasta/rice/cereal/potato/sugar/flour -> carbs;
  fresh fruit & vegetables -> produce;
  oils/butter/nuts/seeds/avocado -> fats;
  drinks/snacks/sweets/condiments or unclear food -> other;
  cleaning/toiletries/anything not eaten -> nonfood.`;

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'Body must be {"name": string}' }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 40,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: name.trim() }],
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let category: Category = 'other';
  let group: Group | null = null;
  try {
    const parsed = JSON.parse(extractJson(raw)) as { category?: string; group?: string };
    if (parsed.category && (CATEGORIES as readonly string[]).includes(parsed.category)) {
      category = parsed.category as Category;
    }
    if (parsed.group && (GROUPS as readonly string[]).includes(parsed.group)) {
      group = parsed.group as Group;
    }
  } catch {
    // leave defaults
  }

  return Response.json({ category, group });
});
