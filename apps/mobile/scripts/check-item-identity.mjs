/**
 * One rule for "is this the same item", implemented once.
 *
 * ---------------------------------------------------------------------------
 * What this is protecting
 * ---------------------------------------------------------------------------
 *
 * Item identity is decided in three places that must agree:
 *
 *   1. `normalizeKey` in lib/pantry-intel — the client's answer, used by the
 *      pantry, the purchase log, item-memory and the home-list map;
 *   2. `item_key` on list_items — a STORED GENERATED column (migration 0018),
 *      with a unique index over the unticked rows;
 *   3. every duplicate check in the UI.
 *
 * When 3 uses its own trim-and-lowercase, it is not merely a bit laxer than 1.
 * It lets an insert through that 2 will reject — and the insert is optimistic,
 * so the user watches the row they just added quietly vanish. That is exactly
 * what "Olive  oil" with two spaces did: the client saw no duplicate, Postgres
 * saw one, and nothing on screen explained it.
 *
 * So this asserts two different things:
 *
 *   - no file re-implements the rule with an ad-hoc `.trim().toLowerCase()`
 *     comparison against an item name;
 *   - `normalizeKey` and the SQL expression in migration 0018 produce the same
 *     answer, checked by running the JS and reading the SQL rather than by
 *     trusting that two people wrote the same thing twice.
 *
 * Run with `pnpm --filter mobile check:item-identity`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const MIGRATION = join(HERE, '..', '..', '..', 'supabase', 'migrations', '0018_no_duplicate_items.sql');

let failures = 0;
const fail = (title, lines = []) => {
  failures += 1;
  console.log(`FAIL ${title}`);
  for (const line of lines) console.log(`  ${line}`);
};
const check = (title, actual, expected) => {
  if (Object.is(actual, expected)) console.log(`ok   ${title}`);
  else fail(title, [`expected ${JSON.stringify(expected)}`, `actual   ${JSON.stringify(actual)}`]);
};

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = walk(SRC).map((full) => ({
  rel: relative(SRC, full).split('\\').join('/'),
  src: code(readFileSync(full, 'utf8')),
}));

/* ------------------------- 1. nobody re-implements the rule -------------- */

/*
 * Files allowed their own normaliser, and why. Each is a DIFFERENT question,
 * not a looser version of this one:
 *
 *   pantry-intel  defines normalizeKey itself.
 *   item-emoji    `fold` is deliberately STRONGER — it strips accents too, for
 *                 lexicon lookup, where "crème" and "creme" should hit one row.
 *   nutrition     splits a name into words and looks each up in a keyword
 *                 table; it never compares two item names to each other.
 */
const EXEMPT = new Set(['lib/pantry-intel.ts', 'lib/item-emoji.ts', 'lib/nutrition.ts']);

/**
 * An ad-hoc normalisation applied to something that looks like an item name.
 * Deliberately narrow: `query.trim().toLowerCase()` for a SEARCH box is fine
 * and common, so the match requires the receiver to be name-ish.
 */
const AD_HOC = /\b(?:it|item|p|entry|row)\.name\s*\.\s*trim\(\)\s*\.\s*toLowerCase\(\)/;

const offenders = files.filter((f) => !EXEMPT.has(f.rel) && AD_HOC.test(f.src));
if (offenders.length) {
  fail(`${offenders.length} file(s) normalise an item name by hand`, [
    ...offenders.map((f) => `  ${f.rel}`),
    'Use normalizeKey from lib/pantry-intel. A local trim-and-lowercase does',
    'not collapse runs of whitespace, so it disagrees with item_key in the',
    'database — and the insert it lets through is rejected there, which the',
    'user sees as the row silently disappearing.',
  ]);
} else {
  console.log('ok   no file normalises an item name by hand');
}

/* ------------------- 2. the client rule and the SQL agree ---------------- */

const js = ts.transpileModule(readFileSync(join(SRC, 'lib', 'pantry-intel.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { normalizeKey } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

const sql = readFileSync(MIGRATION, 'utf8');

/*
 * Read the generated column's expression out of the migration and re-implement
 * THAT, rather than hard-coding what it is supposed to say. If someone edits
 * the SQL, this reads the edit.
 */
const generated = sql.match(/generated always as \(([\s\S]*?)\) stored/i)?.[1];
if (!generated) {
  fail('could not find item_key\'s expression in migration 0018', [
    'This check compares it against normalizeKey. If the column moved to a',
    'later migration, point MIGRATION at it.',
  ]);
} else {
  const flat = generated.replace(/\s+/g, ' ').trim();
  const expected = "lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))";
  if (flat !== expected) {
    fail('item_key is no longer the expression this check knows how to model', [
      `  sql: ${flat}`,
      `  had: ${expected}`,
      'Update the Postgres model below to match, then re-run — do not just',
      'widen this string, or the two rules drift silently again.',
    ]);
  } else {
    console.log('ok   item_key still reads as the expression modelled here');
    /*
     * `[[:space:]]` resolves through glibc's iswspace, NOT through JavaScript's
     * `\s`. Measured against Postgres 16 (UTF8), the two agree on every
     * whitespace codepoint except four — every one of them a NON-BREAKING
     * space, which iswspace rejects and `\s` accepts:
     *
     *   U+00A0  U+2007  U+202F  U+FEFF
     *
     * That is not a detail: U+00A0 is everywhere in text copied from a web
     * page, and the recipe importer's whole input is pasted text.
     *
     * `btrim` with no second argument strips ' ' only, not all whitespace —
     * hence the plain-space trim rather than \s, applied AFTER the collapse,
     * matching the nesting in the SQL.
     */
    const pgItemKey = (name) =>
      name
        .replace(/[\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/g, ' ')
        .replace(/^ +| +$/g, '')
        .toLowerCase();

    const CASES = [
      'Milk',
      'milk',
      '  Milk  ',
      'Olive  oil',
      'Olive\toil',
      'Olive \t oil',
      'olive oil',
      'Crème fraîche',
      'CRÈME FRAÎCHE',
      'Śliwki',
      'Vollmilch  3,5%',
      'a\nb',
      '   ',
      '',
      'Ben & Jerry’s',
      'pão de queijo',
      // The four that disagree with JS `\s`. Each must survive as itself.
      'Olive\u00a0oil',
      'Olive\u2007oil',
      'Olive\u202foil',
      'Olive\ufeffoil',
      // Representatives of the ones that DO collapse, so the class cannot be
      // narrowed to ASCII and quietly pass.
      'Olive\u2009oil',
      'Olive\u3000oil',
      'Olive\u1680oil',
      'Olive\u2028oil',
      // Zero-width space is not whitespace to either, and must not be eaten.
      'Olive\u200boil',
    ];
    let mismatch = null;
    for (const c of CASES) {
      if (normalizeKey(c) !== pgItemKey(c)) {
        mismatch = { c, js: normalizeKey(c), pg: pgItemKey(c) };
        break;
      }
    }
    if (mismatch) {
      fail('normalizeKey and item_key disagree', [
        `  input     ${JSON.stringify(mismatch.c)}`,
        `  client    ${JSON.stringify(mismatch.js)}`,
        `  postgres  ${JSON.stringify(mismatch.pg)}`,
        'The client would let this through and the unique index would reject it.',
      ]);
    } else {
      console.log(`ok   ...and agrees with normalizeKey on all ${CASES.length} cases`);
    }
  }
}

/* ---------------- 3. the cases that motivated the fix -------------------- */

// The exact bug: two spaces read as one item by Postgres, two by the old check.
check('a double space collapses', normalizeKey('Olive  oil'), 'olive oil');
/*
 * And the subtler one underneath it. normalizeKey used `\s`, which collapses
 * a no-break space; Postgres does not. A name pasted from a web page was
 * therefore one item to the pantry and another to the unique index.
 */
check('a no-break space is NOT collapsed, as in Postgres', normalizeKey('Olive\u00a0oil'), 'olive\u00a0oil');
check('a thin space IS collapsed, as in Postgres', normalizeKey('Olive\u2009oil'), 'olive oil');
check('an ideographic space IS collapsed', normalizeKey('Olive\u3000oil'), 'olive oil');
check('a BOM survives', normalizeKey('Olive\ufeffoil'), 'olive\ufeffoil');
check('a tab collapses', normalizeKey('Olive\toil'), 'olive oil');
check('case folds', normalizeKey('MILK'), 'milk');
check('edges trim', normalizeKey('  Milk  '), 'milk');
// And the cases it must NOT merge — normalizeKey is not accent-folding, which
// is item-emoji's `fold`. Merging these would silently join two real items.
check('accents are preserved', normalizeKey('Crème'), 'crème');
check('a plural stays its own item', normalizeKey('Tomaten'), 'tomaten');

/* ---------------- 4. every write that can collide is checked ------------- */

/*
 * Agreeing on what a duplicate IS (sections 1–3) is only half of it. The other
 * half is that every write which can create one actually asks — and the app
 * shipped three paths, each with a different amount of care:
 *
 *   - the add bar, which asked (with its own normaliser — section 1);
 *   - the item sheet's rename, which asked nothing at all and wrote on every
 *     keystroke, so renaming "Oilve OLI" onto an existing "Olive Oil" returned
 *     409, resynced, and undid itself with only a Sentry issue to show for it;
 *   - AI quick-add, which LABELLED the duplicates it found and then inserted
 *     them anyway the moment the user ticked one — the row appeared and
 *     vanished about a second later.
 *
 * All three are the same defect: an optimistic write the unique index refuses,
 * with nothing on screen to explain the disappearance. So the checks below are
 * about WHERE the question gets asked, not how.
 */

const need = (rel) => {
  const f = files.find((x) => x.rel === rel);
  if (!f) fail(`${rel} is missing`, ['Nothing to check — this guard is now vacuous.']);
  return f;
};

const dup = need('lib/item-dup.ts');
const store = need('store/groceries.tsx');
const sheet = need('components/item-sheet.tsx');
const quick = need('components/quick-add-sheet.tsx');

/* 4a. the shared answer exists and is the same answer as everything above. */
if (dup) {
  if (!/normalizeKey/.test(dup.src) || !/export function findDuplicate/.test(dup.src)) {
    fail('lib/item-dup no longer exports a normalizeKey-based findDuplicate', [
      'This is the one place that decides "is there already one of these on',
      'this list". Deriving it from anything but normalizeKey re-opens the gap',
      'between what the client believes and what the unique index enforces.',
    ]);
  } else {
    console.log('ok   lib/item-dup answers with normalizeKey');
  }
}

/*
 * 4b. `updateItem` cannot rename. This is the load-bearing one, because it is
 * enforced by the compiler rather than by anybody remembering: with `name` off
 * ItemPatch, `patch({ name })` does not typecheck, and the only route left is
 * renameItem — which cannot skip the check because the check is inside it.
 */
if (store) {
  const pick = store.src.match(/export type ItemPatch = Partial<\s*Pick<Item,([^>]*)>/)?.[1];
  if (pick == null) {
    fail('could not find ItemPatch\'s field list in store/groceries', [
      'This check reads it to prove `name` is not settable through updateItem.',
    ]);
  } else if (/'name'/.test(pick)) {
    fail('ItemPatch can set `name` again', [
      'Renaming is the one edit that collides with migration 0018, so it must',
      'not be a field on an optional bag every caller may set and no caller is',
      'obliged to think about — that is exactly how the item sheet came to',
      'write names with no check on the path. Use renameItem.',
    ]);
  } else {
    console.log('ok   ItemPatch cannot set a name — renaming has one entry point');
  }

  /* 4c. ...and that entry point checks, in BOTH backends. */
  const renames = [...store.src.matchAll(/renameItem: \([^)]*\) => \{/g)];
  if (renames.length !== 2) {
    fail(`renameItem is implemented ${renames.length} time(s), expected 2`, [
      'One per backend (LOCAL and CLOUD). A backend without it does not fail',
      'to compile — it fails at runtime, on the device, for the users who are',
      'signed in.',
    ]);
  } else {
    const unchecked = renames.filter(
      (m) => !store.src.slice(m.index, m.index + 900).includes('findDuplicate('),
    );
    if (unchecked.length) {
      fail(`${unchecked.length} renameItem implementation(s) do not check first`, [
        'A rename onto a name already open on the list is refused by the unique',
        'index (0018). Unchecked, the write returns 409, the store resyncs, and',
        'the rename silently undoes itself.',
      ]);
    } else {
      console.log('ok   both backends check before renaming');
    }
  }
}

/*
 * 4d. `addParsedItem` is only reached from a screen that just made the list.
 *
 * It inserts unconditionally, and that is right in exactly one situation: the
 * list was created moments ago, so nothing can already be on it. Reaching for
 * it from a screen adding to an EXISTING list is the bug two screens had —
 * quick-add, and the dashboard's weekly builder, whose list is chosen by the
 * user from the ones they already have. Both showed the same thing: the item
 * appears, the unique index rejects the insert, the row vanishes a second later.
 *
 * "Also calls addList" is the structural stand-in for "made the list itself".
 * It is coarse, and it is the property that actually matters.
 */
const rawInserters = files.filter(
  (f) => f.rel !== 'store/groceries.tsx' && /\baddParsedItem\(/.test(f.src),
);
const unsafe = rawInserters.filter((f) => !/\baddList\(/.test(f.src));
if (unsafe.length) {
  fail(`${unsafe.length} screen(s) insert into a list they did not create`, [
    ...unsafe.map((f) => `  ${f.rel}`),
    'addParsedItem is an unconditional insert. On a list that already holds the',
    'item, the unique index rejects it and the row the user just watched appear',
    'disappears a second later. Use addOrReviveItem, which inserts, revives a',
    'ticked row, or does nothing — every branch a write the database accepts.',
  ]);
} else if (rawInserters.length === 0) {
  fail('nothing calls addParsedItem any more', [
    'Then this check proves nothing. Either it was renamed — point this at the',
    'new name — or the unconditional insert is gone and this can go with it.',
  ]);
} else {
  console.log(`ok   addParsedItem is only called where the list was just created (${rawInserters.length})`);
}

/* ...and quick-add specifically still labels and adds by the shared rules. */
if (quick) {
  // Either shared matcher satisfies this: what is being checked is that the
  // labelling comes from lib/item-dup at all rather than a local
  // trim-and-lowercase. findEquivalent is the right one HERE — the label
  // decides whether a row is offered for insert, so matching a plural means an
  // insert that does not happen — while the rename paths keep findDuplicate.
  // check-item-plural enforces that split; this only enforces that one of them
  // is used.
  if (!/addOrReviveItem\(/.test(quick.src) || !/find(?:Duplicate|Equivalent)\(/.test(quick.src)) {
    fail('quick-add no longer routes adds through the shared rules', [
      'It needs addOrReviveItem to write, and findDuplicate or findEquivalent',
      'to label — not a local trim-and-lowercase.',
    ]);
  } else if (!/dedupeByName\(/.test(quick.src)) {
    fail('quick-add adds a batch without deduping it', [
      'One parse can return "milk" and "Milk". Those collide with each other,',
      'not with the list, and the loop runs inside a single render — so',
      'addOrReviveItem cannot see the first when it judges the second.',
    ]);
  } else {
    console.log('ok   quick-add adds through addOrReviveItem, deduped');
  }
}

/*
 * 4e. The item sheet renames once, when the field is finished — not per
 * keystroke. The old handler fired an UPDATE per character, which is not just
 * wasteful: it means there is no moment at which the name is complete and can
 * be checked, so a duplicate check there could not have worked either.
 */
if (sheet) {
  const calls = (sheet.src.match(/renameItem\(/g) ?? []).length;
  if (calls !== 1) {
    fail(`the item sheet calls renameItem ${calls} time(s), expected 1`, [
      'One call, from commitName. More than one means a second, unreviewed',
      'commit point; none means the name field writes nothing at all.',
    ]);
  } else if (!/onBlur=\{commitName\}/.test(sheet.src) || !/onChangeText=\{setName\}/.test(sheet.src)) {
    fail('the item sheet name field no longer commits on blur', [
      'onChangeText must hand the raw setter and onBlur must commit. Renaming',
      'from onChangeText sends one UPDATE per character and leaves no point at',
      'which the name is finished enough to check.',
    ]);
  } else {
    console.log('ok   the item sheet commits a rename once, on blur');
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
