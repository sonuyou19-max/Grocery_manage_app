// Canonicalisation, the layer above fold().
//
// fold() makes "Café" and "cafe" one key. This makes "Sharp Cheddar", "Mature
// Cheddar" and "Organic Cheddar" one key — "cheddar" — so the FIRST shopper to
// tap any of those spellings warms a cache row the rest of them hit for free.
// fold only lowercases and strips accents; it leaves every word in place, so
// today those three are three paid AI calls and three cache rows for one food.
//
// Like fold, this is a two-implementation invariant: the client canonicalises a
// name before its device cache lookup, the edge function canonicalises before
// its server cache lookup and storage, and if the two ever disagree the caches
// simply stop lining up and the feature quietly stops paying off. The mirror
// lives in the client's lib/item-emoji.ts and scripts/check-canonical.mjs loads
// BOTH and asserts they agree character for character.
//
// It takes an ALREADY-FOLDED string, exactly as this file's sibling fold.ts
// hands back, so it needs no imports and the check script can transpile it bare.

// Words that change neither a food's carbon footprint nor the FORM it is bought
// in: store-tier marketing, provenance, salt level, and cheese maturity. These
// are the only things removed.
//
// Two lines are deliberately NOT crossed, and both hold because the words are
// simply absent here — check-canonical.mjs asserts each so a careless addition
// fails CI rather than production:
//
//   FORM words stay. "grated", "sliced", "block", "mince", "whole", "fillet",
//   "spread" are the steak-isn't-mince distinction the swap ladder is built on;
//   a key that dropped them would serve a sauce where a solid was asked for.
//
//   PLANT qualifiers stay. "plant", "vegan", "oat", "soya" are what tell the eco
//   score a substitute IS the substitute (see lib/eco.ts). Strip them and the
//   score stops moving exactly when the shopper does the right thing.
//
// Bias is toward UNDER-stripping. "fresh" (fresh vs hard cheese), "smoked",
// "dried" (dried fruit), "double"/"single" (cream), "light" (light spread),
// "skimmed"/"semi" (milk), "virgin" (olive oil grade) all encode a real product
// and are kept. Missing a collapse costs one cache row; a wrong collapse serves
// the wrong food.
const NOISE = new Set<string>([
  // organic / eco, across the seven languages
  'organic', 'bio', 'biologico', 'biologisch', 'ecologico', 'ekologiczny',
  // store-tier marketing
  'premium', 'finest', 'deluxe', 'extra', 'value', 'economy', 'basic',
  // provenance — free-range, grass-fed, farm, in each language
  'free', 'range', 'grass', 'fed', 'farm', 'farmhouse', 'local',
  'freiland', 'weide', 'fermier', 'fattoria', 'granja', 'boerderij', 'wiejski',
  // salt level: same footprint, same form
  'unsalted', 'salted', 'ungesalzen', 'gesalzen', 'salato', 'salado',
  'niesolony', 'solony', 'ongezouten', 'gezouten',
  // cheese maturity / flavour strength — the shopper's own example, "sharp cheddar"
  'sharp', 'mature', 'mild', 'strong',
  'wurzig', 'gereift', 'affine', 'doux', 'fort', 'stagionato', 'dolce',
  'piccante', 'suave', 'fuerte', 'belegen', 'pittig', 'lagodny', 'ostry',
]);

/**
 * Drop the noise words from an already-folded name.
 *
 * If every word is noise ("extra premium"), the original folded string is kept
 * rather than an empty one: a non-food string that then fails isShareableTerm
 * downstream is a fine outcome, but an empty term that silently matches other
 * empty terms is a cache poisoned across unrelated inputs.
 */
export function canonicalize(folded: string): string {
  if (!folded) return folded;
  const kept = folded.split(' ').filter((w) => w && !NOISE.has(w));
  return kept.length ? kept.join(' ') : folded;
}
