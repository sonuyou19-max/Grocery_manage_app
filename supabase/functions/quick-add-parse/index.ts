// Supabase Edge Function: quick-add-parse
// Turns a free-text (or transcribed voice) utterance into structured grocery
// items via Claude. The Anthropic key lives server-side only — the mobile app
// never talks to the AI provider directly.
//
// Deploy:  supabase functions deploy quick-add-parse
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import { z } from 'npm:zod@3.24.1';

import { rateLimit } from '../_shared/rate-limit.ts';

// Keep in sync with packages/shared/src/schemas.ts. Lenient on purpose: bad
// units/quantities become null rather than failing the whole parse.
const itemCategorySchema = z.enum([
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other',
]);

const quickAddResultSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: itemCategorySchema.catch('other'),
        quantity: z.coerce.number().positive().nullable().catch(null),
        unit: z.enum(['g', 'kg', 'ml', 'L', 'pcs']).nullable().catch(null),
      }),
    )
    .min(1)
    .max(30),
  language: z.string().min(2).max(12).catch('en'),
});

const SYSTEM_PROMPT = `You convert casual grocery utterances (any European language) into structured shopping list items.
Return ONLY a JSON object, no prose, no code fences: {"items": [{"name", "category", "quantity", "unit"}], "language"}.
- name: singular, capitalized, in the user's language ("we're out of milk" -> "Milk").
- category: one of fruit_veg, dairy_eggs, meat_fish, bakery, pantry, frozen, drinks, household, personal_care, other.
- quantity: a NUMBER when stated ("two" -> 2, "a dozen" -> 12); else null.
- unit: one of g, kg, ml, L, pcs. Map words: kilo/kilos/kilogram/kgs -> kg; gram/grams -> g; litre/liter/litres -> L; millilitre/ml -> ml; piece/pieces/count/dozen -> pcs. If no unit, null.
- language: BCP 47 tag of the utterance.
Never invent items that were not mentioned.`;

/** Pull the outermost JSON object out of a possibly-noisy model response. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || text.length === 0 || text.length > 1000) {
    return Response.json({ error: 'Body must be {"text": string} (1-1000 chars)' }, { status: 400 });
  }

  const limited = await rateLimit(req, 'quick-add-parse');
  if (limited) return limited;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  const rawText = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const jsonStr = extractJson(rawText);

  try {
    const parsed = quickAddResultSchema.parse(JSON.parse(jsonStr));
    return Response.json(parsed);
  } catch (_err) {
    return Response.json({ error: 'Could not parse items from that input' }, { status: 422 });
  }
});
