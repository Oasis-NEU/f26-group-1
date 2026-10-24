create type public.listing_status as enum ('open', 'filled', 'closed');

-- A lease with empty rooms. Shows neighborhood + building only, never a street address.
create table public.listings (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  neighborhood text not null check (char_length(btrim(neighborhood)) > 0),
  building_id bigint references public.buildings (id) on delete set null,
  total_bedrooms smallint not null check (total_bedrooms between 1 and 10),
  open_rooms smallint not null,
  rent_per_room integer not null check (rent_per_room > 0),
  utilities_included boolean not null default false,
  furnished boolean not null default false,
  start_date date not null,
  end_date date not null,
  fill_by date not null,
  description text check (char_length(description) <= 2000),
  status public.listing_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_dates_check check (end_date > start_date),
  constraint listings_fill_by_check check (fill_by <= end_date),
  constraint listings_open_rooms_check check (open_rooms between 0 and total_bedrooms),
  constraint listings_open_needs_room_check check (status <> 'open' or open_rooms >= 1)
);

comment on column public.listings.rent_per_room is 'Whole dollars per month';

create index listings_status_dates_idx on public.listings (status, start_date, end_date);
create index listings_owner_id_idx on public.listings (owner_id);
create index listings_building_id_idx on public.listings (building_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;

create policy "open listings and your own are readable"
  on public.listings for select to authenticated
  using (status = 'open' or owner_id = (select auth.uid()));

create policy "users can create their own listings"
  on public.listings for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "owners can update their listings"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners can delete their listings"
  on public.listings for delete to authenticated
  using (owner_id = (select auth.uid()));
