// Supabase Edge Function: weekly-recap
// Turns an aggregated snapshot of a household's shopping into a short, warm
// narrative for the Insights tab. The client caches the result for the week, so
// this runs ~once per household per week — cheap.
//
// Deploy:  supabase functions deploy weekly-recap
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

import { rateLimit } from '../_shared/rate-limit.ts';

const SYSTEM_PROMPT = `You write a short weekly grocery recap for a household grocery app.
Voice: warm, casual, second person, like a friendly check-in text — never corporate.
Use the informal second person where the language distinguishes it (du, tu, tú, ty).
Rules:
- 2 to 4 short sentences. No markdown, no bullet points, no headings.
- At most one emoji, and only if it fits naturally.
- Ground every claim in the JSON you're given — never invent items or numbers.
- Mention the basket/pantry balance and a staple or two if present.
- If lowItems are provided, end with ONE friendly heads-up to restock them.
- If there's little data, keep it brief and encouraging.`;

/**
 * Languages the app ships. The recap is prose, so it has to be written in the
 * reader's language; anything unrecognised falls back to English.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pl: 'Polish',
  nl: 'Dutch',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return Response.json({ error: 'Body must be a recap payload object' }, { status: 400 });
  }

  const limited = await rateLimit(req, 'weekly-recap');
  if (limited) return limited;

  // `language` steers the prose only — it is not part of the shopping data, so
  // pull it out before the payload is handed to the model.
  const { language, ...data } = payload as Record<string, unknown> & { language?: string };
  const languageName = LANGUAGE_NAMES[String(language ?? 'en')] ?? 'English';

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 220,
    system: `${SYSTEM_PROMPT}\n- Write the recap in ${languageName}. Output only ${languageName}.`,
    messages: [
      {
        role: 'user',
        content: `This week's shopping data as JSON:\n${JSON.stringify(data)}\n\nWrite the recap in ${languageName}.`,
      },
    ],
  });

  const recap = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  if (!recap) return Response.json({ error: 'empty response' }, { status: 502 });

  return Response.json({ recap });
});
