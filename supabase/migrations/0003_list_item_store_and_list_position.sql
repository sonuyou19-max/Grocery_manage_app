-- Per-item supermarket and explicit list ordering, to back the app's
-- "Buy at" store picker and drag-to-reorder of lists.

alter table list_items add column if not exists store text;
alter table shopping_lists add column if not exists position integer not null default 0;

create index if not exists idx_lists_position on shopping_lists (household_id, position);
