-- ---------------------------------------------------------------------------
-- What the receipt called it.
--
-- A matched purchase is filed under the SHOPPER's word — "Coffee" — because
-- item_key is the normalised name and the burn-rate model learns from the gaps
-- between purchases of one key. That is right, and it throws something away:
-- the receipt knew this was Douwe Egberts oploskoffie, dessert glas, 200g, and
-- after the import nobody could find that out again.
--
-- So the product's own description rides on the PURCHASE, next to `brand` and
-- for the same reason. Both are facts about one trip to one shop, neither is
-- part of what the item IS, and putting either into the name would fragment
-- that item's history into one thread per brand and per pack size.
--
-- It is deliberately not on list_items. A list row is reused every week and
-- would go stale the moment you bought a different coffee; the purchase log is
-- where "what did I actually buy that time" is answerable, and it already
-- carries the price, the packs, the store and the date to sit beside it.
-- ---------------------------------------------------------------------------

alter table price_entries
  /*
   * The expansion, not the raw printing.
   *
   * The raw line is what the till emitted — abbreviated, and carrying whatever
   * the camera got wrong ("DOUNE EGBERTS opiosk"). It is the right thing to
   * show WHILE reviewing a scan, beside the interpretation, so the reader can
   * check one against the other. It is the wrong thing to keep afterwards: six
   * months on, nobody can tell a store's abbreviation from a scanning slip, and
   * the string is no longer evidence of anything because the photograph is
   * gone.
   *
   * Null on every purchase logged by hand, which is nearly all of them.
   */
  add column if not exists description text;

-- No index. It is read as part of a row already being fetched by household and
-- date, and never searched on.
