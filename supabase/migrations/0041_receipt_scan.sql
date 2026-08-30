-- ---------------------------------------------------------------------------
-- Keep the scan, so a receipt can be opened again.
--
-- 0038 stored the RESULT of an import — the shop, the total, what reconciled —
-- and threw the reading away. That was right while the review sheet was a
-- one-way door: you checked the lines, you imported, the paper went in the bin.
--
-- It stops being right the moment somebody wants to correct one. A price typed
-- wrong, a line matched to the wrong item, a line skipped that should not have
-- been — none of that is recoverable from `price_entries` alone, because
-- price_entries only holds the lines that were IMPORTED. Everything the shopper
-- left out, every line the matcher could not place, and the printed text of all
-- of them, is exactly the material a correction needs and exactly what was not
-- being kept.
--
-- ---------------------------------------------------------------------------
-- Why one jsonb column and not a receipt_lines table
-- ---------------------------------------------------------------------------
--
-- Nothing queries a line. Every read of this is "give me that whole receipt
-- back", because the only consumer is a screen that redraws the entire review.
-- A table would buy per-line indexes nobody would use, a second RLS policy to
-- keep in step with this one, and a join on every open — in exchange for a
-- normalisation whose benefit is zero here.
--
-- The client validates the blob on the way in (see lib/receipt-archive.ts): a
-- scan written by an older build must degrade to "cannot reopen this one"
-- rather than crash the screen, so the shape is checked rather than trusted.
-- That is also why `version` is inside the document.
-- ---------------------------------------------------------------------------

alter table receipts
  add column if not exists scan jsonb;

comment on column receipts.scan is
  'The parsed receipt and the shopper''s decisions, as one versioned document: '
  '{ version, receipt, purchases[], decisions[] }. Written on import and '
  'rewritten on every correction. Null on receipts imported before this '
  'column existed — those can be read but not reopened, and the client says so '
  'rather than showing an empty review.';

-- ---------------------------------------------------------------------------
-- Corrections need an mtime that is not the scan time.
--
-- `scanned_at` is when the photograph was taken and must stay that way — it is
-- evidence about the trip. Editing a receipt three weeks later is a different
-- event, and without somewhere to put it the list of receipts cannot show that
-- one of them has been touched since.
-- ---------------------------------------------------------------------------
alter table receipts
  add column if not exists edited_at timestamptz;

-- The receipts list reads "this household, newest shopping first", and the one
-- index from 0038 already serves it. Nothing here changes that shape.
