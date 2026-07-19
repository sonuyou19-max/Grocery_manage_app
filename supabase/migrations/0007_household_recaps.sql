-- ---------------------------------------------------------------------------
-- Shared weekly recap: one AI recap per household per week, so every member
-- sees the same text (and it's generated once, not once per device). Realtime
-- pushes it live when whoever opens Insights first generates it.
-- ---------------------------------------------------------------------------

create table household_recaps (
  household_id uuid primary key references households(id) on delete cascade,
  week text not null,
  text text not null,
  updated_at timestamptz not null default now()
);

alter table household_recaps enable row level security;

create policy "members manage recaps"
  on household_recaps for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

alter publication supabase_realtime add table household_recaps;
