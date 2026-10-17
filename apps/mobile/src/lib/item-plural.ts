import { fold } from '@/lib/item-emoji';

/**
 * "Potato" and "Potatoes" are one thing to buy.
 *
 * ---------------------------------------------------------------------------
 * Why this cannot be normalizeKey
 * ---------------------------------------------------------------------------
 *
 * normalizeKey is not a style choice — it is a transcription of a Postgres
 * generated column, character for character, and check-item-identity asserts
 * that it stays one (including, explicitly, that "Tomaten" stays its own item).
 * Teaching it about plurals would mean either changing the generated column and
 * re-keying every row in every household's list, or letting the client and the
 * database disagree about what an item IS — which is the exact failure mode
 * lib/item-dup exists to prevent.
 *
 * So this is a SECOND, looser question, asked only by the UI and never stored:
 * not "will Postgres reject this insert" but "did the shopper already write
 * this down". It is allowed to be fuzzy precisely because being wrong here
 * costs an insert that does not happen, never one that fails.
 *
 * ---------------------------------------------------------------------------
 * What it handles, and what it does not
 * ---------------------------------------------------------------------------
 *
 * The -s family (English, French, Spanish, and the Dutch words that take -s)
 * and the -en family (German, and the Dutch words that take -en without
 * changing their stem). Between them that is five of the seven locales the app
 * ships in, though Dutch only in part: "tomaat" pluralises to "tomaten", and
 * getting from one to the other means undoing the open/closed-syllable vowel
 * doubling as well as the suffix. That is left alone — a rule that turns "omat"
 * back into "omaat" has to be willing to do it everywhere, and everywhere is
 * where it starts merging unrelated words.
 *
 * Italian and Polish are NOT handled and are not attempted. Italian pluralises
 * by changing the final vowel — pomodoro/pomodori, mela/mele — so the plural
 * marker is a vowel that is also the singular ending of thousands of other
 * words, and any rule that catches pomodori also merges words that have nothing
 * to do with each other. Polish inflects for seven cases on top of number.
 * Neither is a suffix problem, and a bad stemmer here does not fail loudly: it
 * silently refuses to let someone add a real second item to their list. A miss
 * is a duplicate row the shopper can delete; a false merge is the app arguing
 * with them about what they just typed. So the rules below only fire where the
 * plural marker is unambiguous, and everything else is left alone.
 *
 * ---------------------------------------------------------------------------
 * Why fold() and not a bare lowercase
 * ---------------------------------------------------------------------------
 *
 * The same folding the emoji table, the category tables and the lexicon all key
 * on, so "Tomate" and "tomaté" reach these rules identically. normalizeKey
 * deliberately preserves accents because Postgres does; this is not the
 * database's question, and an accent is not a different vegetable.
 */

/**
 * Minimum length before a suffix may be stripped.
 *
 * Short words are where stemming does its damage: "gas" would become "ga",
 * "bus" "bu", and either could then collide with something real. Four
 * characters is the shortest that leaves a stem worth comparing, and it still
 * covers the plurals that actually matter — "eggs" is exactly four.
 */
const MIN_S = 4;

/** The -en rule needs one more, so "oven" and "hen" are left intact. */
const MIN_EN = 5;

function singularizeWord(word: string): string {
  let w = word;

  // -ies → -y. "berries" → "berry", "cherries" → "cherry".
  if (w.length >= MIN_EN && w.endsWith('ies')) {
    w = `${w.slice(0, -3)}y`;
  }
  // -oes → -o. Ahead of the general -es rule because "potatoes" would otherwise
  // fall through to the -s rule and stem to "potatoe", which matches nothing —
  // the plural and the singular would end up on opposite sides of the compare,
  // which is the one outcome worse than not trying.
  else if (w.length >= MIN_EN && w.endsWith('oes')) {
    w = w.slice(0, -2);
  }
  // -es after a sibilant, where the "e" is part of the plural rather than the
  // stem: "dishes" → "dish", "boxes" → "box", "glasses" → "glass".
  else if (w.length >= MIN_EN && w.endsWith('es') && /(?:s|x|z|ch|sh)$/.test(w.slice(0, -2))) {
    w = w.slice(0, -2);
  }
  // Plain -s. Not after "ss" (glass, dress) and not after "us" (hummus,
  // asparagus, couscous) — both are singular endings that the rule would
  // otherwise chew into a stem no singular form produces.
  else if (w.length >= MIN_S && w.endsWith('s') && !/(?:ss|us)$/.test(w)) {
    w = w.slice(0, -1);
  }

  // -en → -e, applied AFTER the -s rules rather than instead of them, and to
  // their output. German and Dutch build plurals this way (Tomate/Tomaten,
  // Banane/Bananen), but the reason it runs second is English: "chickens"
  // stems to "chicken" above, and if that were the final answer it would never
  // meet the singular "chicken", which this rule takes to "chicke". Running
  // both in sequence means every word reaches the same place from either side.
  if (w.length >= MIN_EN && w.endsWith('en')) {
    w = w.slice(0, -1);
  }

  return w;
}

/**
 * The key two names share when they are the same item in different numbers.
 *
 * Word by word, so a qualifier pluralises independently of its head — "spring
 * onions" and "spring onion" agree without the phrase needing to be in any
 * table.
 */
export function singularKey(name: string): string {
  const folded = fold(name);
  if (!folded) return '';
  return folded
    .split(' ')
    .map((word) => {
      const stem = singularizeWord(word);
      return KNOWN_PLURALS.get(stem) ?? stem;
    })
    .join(' ');
}

/*
 * ---------------------------------------------------------------------------
 * The plurals no suffix rule can reach, listed by hand
 * ---------------------------------------------------------------------------
 *
 * Italian, Polish and the Dutch plurals that change their stem are left out of
 * the rules above for a reason that still holds: a RULE broad enough to catch
 * pomodori would also merge unrelated words. A LIST cannot over-reach. It
 * merges exactly the pairs written here, all of them groceries, and nothing
 * else — a word missing from it behaves exactly as it did before.
 *
 * [singular, plural], spelled as people type them; fold() takes the accents
 * and ł off on the way in. Polish is nominative plural only ("jabłka"), not
 * the genitive after a number ("5 jabłek").
 */
const PLURAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Italian
  ['pomodoro', 'pomodori'], ['mela', 'mele'], ['pera', 'pere'], ['banana', 'banane'],
  ['arancia', 'arance'], ['limone', 'limoni'], ['patata', 'patate'], ['carota', 'carote'],
  ['cipolla', 'cipolle'], ['zucchina', 'zucchine'], ['zucchino', 'zucchini'],
  ['melanzana', 'melanzane'], ['peperone', 'peperoni'], ['uovo', 'uova'],
  ['fragola', 'fragole'], ['pesca', 'pesche'], ['albicocca', 'albicocche'],
  ['prugna', 'prugne'], ['ciliegia', 'ciliegie'], ['fagiolo', 'fagioli'],
  ['pisello', 'piselli'], ['cece', 'ceci'], ['fungo', 'funghi'], ['carciofo', 'carciofi'],
  ['cetriolo', 'cetrioli'], ['broccolo', 'broccoli'], ['cavolfiore', 'cavolfiori'],
  ['cavolo', 'cavoli'], ['porro', 'porri'], ['mandarino', 'mandarini'], ['melone', 'meloni'],
  ['anguria', 'angurie'], ['oliva', 'olive'], ['noce', 'noci'], ['mandorla', 'mandorle'],
  ['nocciola', 'nocciole'], ['biscotto', 'biscotti'], ['cornetto', 'cornetti'],
  ['panino', 'panini'], ['salsiccia', 'salsicce'], ['petto', 'petti'], ['coscia', 'cosce'],
  ['filetto', 'filetti'], ['gambero', 'gamberi'], ['cozza', 'cozze'], ['vongola', 'vongole'],
  ['lampone', 'lamponi'], ['mirtillo', 'mirtilli'], ['ravanello', 'ravanelli'],
  ['peperoncino', 'peperoncini'], ['scalogno', 'scalogni'], ['sedano', 'sedani'],
  ['finocchio', 'finocchi'], ['asparago', 'asparagi'], ['dattero', 'datteri'],
  ['fico', 'fichi'], ['pompelmo', 'pompelmi'], ['tovagliolo', 'tovaglioli'],
  ['rotolo', 'rotoli'], ['sacchetto', 'sacchetti'],
  // Polish
  ['jabłko', 'jabłka'], ['gruszka', 'gruszki'], ['śliwka', 'śliwki'],
  ['truskawka', 'truskawki'], ['malina', 'maliny'], ['borówka', 'borówki'],
  ['wiśnia', 'wiśnie'], ['czereśnia', 'czereśnie'], ['pomarańcza', 'pomarańcze'],
  ['cytryna', 'cytryny'], ['limonka', 'limonki'], ['mandarynka', 'mandarynki'],
  ['brzoskwinia', 'brzoskwinie'], ['morela', 'morele'], ['banan', 'banany'],
  ['winogrono', 'winogrona'], ['pomidor', 'pomidory'], ['ogórek', 'ogórki'],
  ['ziemniak', 'ziemniaki'], ['marchewka', 'marchewki'], ['cebula', 'cebule'],
  ['papryka', 'papryki'], ['pieczarka', 'pieczarki'], ['grzyb', 'grzyby'],
  ['jajko', 'jajka'], ['jajo', 'jaja'], ['bułka', 'bułki'], ['rogal', 'rogale'],
  ['rogalik', 'rogaliki'], ['cukinia', 'cukinie'], ['dynia', 'dynie'],
  ['kiełbasa', 'kiełbasy'], ['parówka', 'parówki'], ['udko', 'udka'], ['pierś', 'piersi'],
  ['orzech', 'orzechy'], ['migdał', 'migdały'], ['rzodkiewka', 'rzodkiewki'],
  ['burak', 'buraki'], ['szparag', 'szparagi'], ['ciastko', 'ciastka'],
  ['herbatnik', 'herbatniki'], ['jogurt', 'jogurty'], ['serek', 'serki'],
  ['baton', 'batony'], ['chusteczka', 'chusteczki'], ['worek', 'worki'],
  ['rolka', 'rolki'], ['puszka', 'puszki'], ['butelka', 'butelki'],
  // Dutch: the -en plurals that change their stem, and the 's plurals
  ['tomaat', 'tomaten'], ['peer', 'peren'], ['boon', 'bonen'], ['ui', 'uien'], ['ei', 'eieren'],
  ['kaas', 'kazen'], ['brood', 'broden'], ['noot', 'noten'], ['druif', 'druiven'],
  ['appel', 'appelen'], ['aardappel', 'aardappelen'], ['sinaasappel', 'sinaasappelen'],
  ['wortel', 'wortelen'], ['citroen', 'citroenen'], ['meloen', 'meloenen'],
  ['limoen', 'limoenen'], ['pompoen', 'pompoenen'], ['aardbei', 'aardbeien'],
  ['framboos', 'frambozen'], ['perzik', 'perziken'], ['pruim', 'pruimen'],
  ['olijf', 'olijven'], ['erwt', 'erwten'], ['biet', 'bieten'], ['radijs', 'radijzen'],
  ['garnaal', 'garnalen'], ['mossel', 'mosselen'], ['amandel', 'amandelen'],
  ['walnoot', 'walnoten'], ['hazelnoot', 'hazelnoten'], ['mandarijn', 'mandarijnen'],
  ['ananas', 'ananassen'], ['sjalot', 'sjalotten'], ['worst', 'worsten'],
  ['gehaktbal', 'gehaktballen'], ['bes', 'bessen'], ['vis', 'vissen'], ['fles', 'flessen'],
  ['zak', 'zakken'], ['paprika', "paprika's"], ['avocado', "avocado's"],
  ['mango', "mango's"], ['kiwi', "kiwi's"],
];

/**
 * Every listed form, stemmed, mapped to one representative per group.
 *
 * Keyed on the RULES' output, not the raw word, because the rules run first and
 * other languages reach the same stems: German "Tomaten" stems to "tomate"
 * just as Dutch "tomaten" does, and German "Bananen" to "banane", which is also
 * the Italian plural. Mapping raw words would have pulled "Tomaten" away from
 * German "Tomate". Mapping stems keeps every pair the rules already merged and
 * joins the listed ones to them.
 *
 * Grouped rather than paired, since a stem can sit in more than one pair —
 * Dutch peren and Italian pere both stem to "pere" — and both pears must land
 * on one key. Built once, at load.
 */
const KNOWN_PLURALS: ReadonlyMap<string, string> = (() => {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const [one, many] of PLURAL_PAIRS) {
    const a = find(singularizeWord(fold(one)));
    const b = find(singularizeWord(fold(many)));
    parent.set(a, a);
    if (a !== b) parent.set(b, a);
  }
  const out = new Map<string, string>();
  for (const stem of parent.keys()) {
    const root = find(stem);
    if (root !== stem) out.set(stem, root);
  }
  return out;
})();

/**
 * Whether two names are the same item up to plural form.
 *
 * Exact equality is not special-cased: two identical names fold and stem
 * identically, so they arrive here true anyway.
 */
export function samePlural(a: string, b: string): boolean {
  const ka = singularKey(a);
  return ka !== '' && ka === singularKey(b);
}
