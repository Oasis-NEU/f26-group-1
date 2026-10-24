-- Photo metadata; the files live in the listing-photos storage bucket at
-- {owner_id}/{listing_id}/{uuid}.webp.
create table public.listing_photos (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  path text not null unique,
  position smallint not null check (position between 0 and 7),
  created_at timestamptz not null default now(),
  -- One photo per slot and only slots 0-7, so at most 8 photos per listing with
  -- no trigger or race. Deferrable so a single statement can swap two slots.
  constraint listing_photos_listing_position_key unique (listing_id, position) deferrable
);

alter table public.listing_photos enable row level security;

-- listings RLS applies inside these subqueries, so a plain exists() means
-- "the parent listing is readable by the current user".
create policy "photos are readable when the listing is"
  on public.listing_photos for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));

create policy "owners can add photos to their listings"
  on public.listing_photos for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
    and split_part(path, '/', 1) = (select auth.uid())::text
    and split_part(path, '/', 2) = listing_id::text
  );

create policy "owners can update photos on their listings"
  on public.listing_photos for update to authenticated
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
    and split_part(path, '/', 1) = (select auth.uid())::text
    and split_part(path, '/', 2) = listing_id::text
  );

create policy "owners can delete photos on their listings"
  on public.listing_photos for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = (select auth.uid())
    )
  );
