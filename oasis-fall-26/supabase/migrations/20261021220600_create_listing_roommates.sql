-- Roommates who are staying. They may not have accounts (user_id is optional);
-- the UI reminds owners to get their OK before listing them.
create table public.listing_roommates (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index listing_roommates_listing_id_idx on public.listing_roommates (listing_id);

alter table public.listing_roommates enable row level security;

-- listings RLS applies inside these subqueries (see listing_photos).
create policy "roommates are readable when the listing is"
  on public.listing_roommates for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));

create policy "owners can add roommates to their listings"
  on public.listing_roommates for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "owners can update roommates on their listings"
  on public.listing_roommates for update to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );

create policy "owners can delete roommates on their listings"
  on public.listing_roommates for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );
