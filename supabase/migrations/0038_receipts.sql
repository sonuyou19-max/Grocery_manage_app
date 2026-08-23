-- ---------------------------------------------------------------------------
-- Receipt scanning: where a purchase came from, and what brand it was.
--
-- The shopper ticks items off as they go round, which already logs purchases —
-- so scanning the receipt afterwards is an AMENDMENT, not an import. It fills
-- in the price, the pack count and the brand that nobody was going to type
-- standing at a till.
--
-- Two things this has to make impossible:
--
--   1. **Scanning the same receipt twice.** People re-scan when they are not
--      sure it worked. Without an identity for the receipt itself, the second
--      scan doubles a week's spending, and the damage is invisible until the
--      "cheaper elsewhere" figures start lying.
--
--   2. **Brand fragmenting item identity.** See the note on `brand` below. This
--      is the one that would quietly ruin the pantry.
-- ---------------------------------------------------------------------------

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,

  /*
   * What makes this receipt THIS receipt.
   *
   * Store, printed total and printed timestamp, normalised into one string by
   * the client. Not a hash of the parsed lines: two scans of the same paper can
   * legitimately parse slightly differently — a blurrier photo, one line the
   * model split differently — and a fingerprint that changed with the parse
   * would let exactly the case it exists to prevent straight through.
   *
   * The three fields chosen are the ones printed ON the receipt and therefore
   * identical across scans. A household buying the same total twice at the same
   * shop in the same MINUTE is not a case worth engineering for.
   */
  fingerprint text not null,

  /** As printed. Free text, because independents are not in SUPERMARKETS. */
  store text,
  /** Matched to lib/supermarkets, or null for a shop we do not know. */
  store_id text,

  /*
   * The receipt's own timestamp, not when it was scanned.
   *
   * This is what the amendment window is measured from. Scanning yesterday's
   * shop this morning has to amend yesterday's purchases; a window anchored on
   * now() would insert duplicates instead, which is the first bug on this list
   * arriving through a different door.
   */
  purchased_at timestamptz,
  scanned_at timestamptz not null default now(),

  /*
   * What was actually paid, in the smallest unit.
   *
   * Kept even when the parsed lines do not add up to it. It is the ground
   * truth — the number the bank saw — and holding it lets Insights say
   * "receipt €47,60, logged €43,12" rather than silently reporting the smaller
   * figure as fact.
   */
  total_cents integer,
  currency char(3) not null default 'EUR',

  /*
   * Did the parsed lines reconcile against the printed total?
   *
   * False is not an error state — the user is allowed to import a receipt that
   * did not add up, with a warning. It is recorded so the mismatch can be shown
   * later, and so the reconciliation RATE across real receipts is measurable
   * rather than guessed at. That rate is the quality signal for the whole
   * feature: it decides which model is worth paying for.
   */
  reconciled boolean not null default false,

  /*
   * Deposits (Pfand, statiegeld, leeggoed) and discounts, kept out of the item
   * lines and out of the pantry.
   *
   * A deposit is not a grocery. Imported as one it becomes a tracked staple
   * called PFAND that comes due every fortnight. But it IS money that left the
   * account, so dropping it entirely would make the totals stop reconciling —
   * it lives here instead, where spending can see it and prediction cannot.
   */
  deposit_cents integer not null default 0,
  discount_cents integer not null default 0,

  unique (household_id, fingerprint)
);

alter table receipts enable row level security;

create policy "members manage receipts"
  on receipts for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- Every read is "this household's receipts, newest first" — the ledger showing
-- where a purchase came from, and the re-scan check looking a fingerprint up.
create index if not exists idx_receipts_household
  on receipts (household_id, purchased_at desc);

alter table price_entries
  /*
   * The brand, on the PURCHASE and never on the item.
   *
   * This is the whole reason the column is here rather than on pantry_items.
   * The pantry keys on the normalised item name, and the burn-rate model learns
   * from the gaps between purchases of that key. Make the brand part of the
   * identity and "milk every six days" fragments into Alpro-milk, Oatly-milk
   * and own-brand-milk — three entries with a third of the history each, none
   * of which ever comes due. A brand switch would silently reset the learning.
   *
   * As a fact about one purchase it costs nothing and pays later: it is what
   * lets the app eventually say "you usually buy Alpro; the own-brand was €0.40
   * less" — a comparison that only means anything while both are the same item.
   */
  add column if not exists brand text,

  /*
   * The receipt this purchase was read from, or null for one logged by hand.
   *
   * `on delete set null` rather than cascade, deliberately: deleting a receipt
   * must not delete the shopping. The purchase happened whether or not we still
   * hold the paperwork, and the price history is the thing this app is for.
   */
  add column if not exists receipt_id uuid references receipts(id) on delete set null;

-- The amendment path looks purchases up by "this household, this item, near
-- this time" — see SESSION_WINDOW_MS. Without an index that is a scan of the
-- household's whole history on every line of every receipt.
create index if not exists idx_prices_amend
  on price_entries (household_id, item_key, recorded_at desc);
