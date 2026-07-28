// Supabase Edge Function: weekly-recap
// Turns an aggregated snapshot of a household's shopping into a short, warm
// narrative for the Insights tab. The client caches the result for the week, so
// this runs ~once per household per week — cheap.
//
// Deploy:  supabase functions deploy weekly-recap
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

import { reserveBudget } from '../_shared/rate-limit.ts';

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

  // `language` steers the prose only — it is not part of the shopping data, so
  // pull it out before the payload is handed to the model.
  const { language, ...data } = payload as Record<string, unknown> & { language?: string };
  const languageName = LANGUAGE_NAMES[String(language ?? 'en')] ?? 'English';

  // This payload goes into the prompt verbatim, and until now nothing bounded
  // it: the other two endpoints cap their input (1 name, 1000 chars) but this
  // one accepted whatever JSON was posted. A megabyte of it is a megabyte of
  // billed input tokens, which made this the cheapest token-abuse vector in the
  // app despite having the smallest output ceiling. A real recap payload is a
  // few hundred bytes; 8 KB is generous and still bounds the damage.
  const serialized = JSON.stringify(data);
  if (serialized.length > 8192) {
    return Response.json({ error: 'Recap payload too large' }, { status: 413 });
  }

  const MAX_TOKENS = 220;
  const guard = await reserveBudget(req, 'weekly-recap', SYSTEM_PROMPT + serialized, MAX_TOKENS);
  if (guard.denied) return guard.denied;

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: MAX_TOKENS,
    system: `${SYSTEM_PROMPT}\n- Write the recap in ${languageName}. Output only ${languageName}.`,
    messages: [
      {
        role: 'user',
        content: `This week's shopping data as JSON:\n${serialized}\n\nWrite the recap in ${languageName}.`,
      },
    ],
  });

  await guard.settle(message.usage);

  const recap = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  if (!recap) return Response.json({ error: 'empty response' }, { status: 502 });

  return Response.json({ recap });
});
