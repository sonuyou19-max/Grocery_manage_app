-- Korb initial schema
-- Household-scoped grocery lists, pantry tracking, optional price logging.
-- All user data isolates per household via RLS; pricing columns are nullable
-- by design (logging costs is always optional).

create type household_role as enum ('owner', 'member');

create type item_category as enum (
  'fruit_veg', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
  'frozen', 'drinks', 'household', 'personal_care', 'other'
);

create type consumption_kind as enum ('purchased', 'ran_out', 'adjusted');

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role household_role not null default 'member',
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  store text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  category item_category not null default 'other',
  quantity numeric,
  unit text check (unit in ('g', 'kg', 'ml', 'L', 'pcs')),
  -- Pricing is optional: null = user chose not to log a price.
  price_cents integer check (price_cents >= 0),
  currency char(3) not null default 'EUR',
  note text,
  checked boolean not null default false,
  position integer not null default 0,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  category item_category not null default 'other',
  stock_level real not null default 1 check (stock_level between 0 and 1),
  avg_purchase_interval_days real,
  last_purchased_at timestamptz,
  predicted_out_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

-- Raw signal feed for the restock prediction job.
create table consumption_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  kind consumption_kind not null,
  quantity numeric,
  unit text,
  occurred_at timestamptz not null default now()
);

-- Price history per item name and store; only written when users opt to log.
create table price_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  item_name text not null,
  store text,
  price_cents integer not null check (price_cents >= 0),
  currency char(3) not null default 'EUR',
  recorded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index idx_members_user on household_members (user_id);
create index idx_lists_household on shopping_lists (household_id) where not archived;
create index idx_items_list on list_items (list_id, position);
create index idx_pantry_household on pantry_items (household_id);
create index idx_pantry_predicted_out on pantry_items (household_id, predicted_out_at);
create index idx_events_item_time on consumption_events (pantry_item_id, occurred_at desc);
create index idx_prices_lookup on price_entries (household_id, item_name, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: every row is reachable only by members of its household
-- ---------------------------------------------------------------------------

alter table households enable row level security;
alter table household_members enable row level security;
alter table shopping_lists enable row level security;
alter table list_items enable row level security;
alter table pantry_items enable row level security;
alter table consumption_events enable row level security;
alter table price_entries enable row level security;

-- Helper: is the current user a member of the given household?
create or replace function is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create policy "members read household"
  on households for select
  using (is_household_member(id));

create policy "authenticated users create households"
  on households for insert
  with check (auth.uid() is not null);

create policy "owners update household"
  on households for update
  using (exists (
    select 1 from household_members
    where household_id = id and user_id = auth.uid() and role = 'owner'
  ));

create policy "members read membership"
  on household_members for select
  using (is_household_member(household_id));

create policy "users join or owners add"
  on household_members for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from household_members m
      where m.household_id = household_members.household_id
        and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

create policy "members manage lists"
  on shopping_lists for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "members manage list items"
  on list_items for all
  using (exists (
    select 1 from shopping_lists l
    where l.id = list_items.list_id and is_household_member(l.household_id)
  ))
  with check (exists (
    select 1 from shopping_lists l
    where l.id = list_items.list_id and is_household_member(l.household_id)
  ));

create policy "members manage pantry"
  on pantry_items for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "members manage consumption events"
  on consumption_events for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "members manage price entries"
  on price_entries for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Realtime: shared lists sync live between household members
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table list_items;
alter publication supabase_realtime add table shopping_lists;
