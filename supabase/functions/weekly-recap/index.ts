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

WHAT THE FIELDS MEAN. Read this before writing anything; several of them are
easy to confuse and getting one wrong makes the recap say something untrue:
- boughtCount: how many things they actually BOUGHT in the last 7 days. This is
  the only field you may describe with words like bought, got, picked up.
- basketCount: how many things are still ON A LIST, NOT yet bought. Waiting to
  be bought. Never describe these as bought, grabbed or got.
- spendEuros / pricedCount: money actually spent on those purchases.
- balance / topCategories: what the BASKET is made of — the things still to buy.
- staples: what this household buys most often. lowItems: what is running low.
- listCount: how many separate shopping lists they keep. Rarely worth a mention
  and never a stand-in for how much they bought.
- members: how many people share this household. 1 means they shop alone — do
  not write "you and your household" at somebody shopping on their own.
- seasonalSuggestions: produce that is in season where they live RIGHT NOW.
  These are NOT their items and may be things they have never bought. Never
  imply they are in their basket or that they bought them.
- ecoScore / ecoLowPercent: how light the week's purchases were for the climate.

Rules:
- Exactly 2 or 3 sentences. Each one under 16 words. Stop there.
- Wrap the key facts — numbers, amounts, item names — in ** **, like **13 items**
  or **€43**. Two to four of them in the whole recap, never a whole sentence.
- No other formatting: no bullets, no headings, no italics, no line breaks.
- At most one emoji, and only if it fits naturally.
- Ground every claim in the JSON you're given — never invent items or numbers.
- Never add two counts together, and never report one as the other. If both
  boughtCount and basketCount are worth a mention, they are two separate facts.
- A count of 0 is a fact, not a gap. "Nothing bought yet this week" is fine;
  inventing a number is not.
- Mention the basket/pantry balance and a staple or two if present.
- If lowItems are provided, end with ONE friendly heads-up to restock them.
- If there's little data, keep it brief and encouraging.
- Mention the climate side in at most ONE clause, only when ecoScore is not
  null, and only as an observation — never advice, never a target, never a
  comparison to other people. "A lighter week than usual" is right; "try eating
  less meat" is not, and neither is any figure in kilograms of CO2.
- You may name one or two seasonalSuggestions warmly, clearly as what is in
  season now rather than as something they have. Do not instruct anyone to buy
  them.
- Never say the score is good or bad. It is their shopping, not a grade.`;

/**
 * Why the length rule is a count and not an adjective.
 *
 * It used to say "2 to 4 short sentences" and got back a single 60-word
 * paragraph with three clauses joined by dashes — technically obeying, since
 * the model reads "short" as relative to what it might otherwise have written.
 * A word cap per sentence is a rule it cannot satisfy while rambling.
 *
 * The ** markers are the only markup the app renders (see lib/recap-markup.ts),
 * and the parser there treats an unpaired or absent marker as ordinary text, so
 * a model that ignores this rule produces a plain recap rather than a broken
 * one. Recaps written before this prompt existed, still cached on devices and
 * in household_recaps, render the same way.
 */

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
