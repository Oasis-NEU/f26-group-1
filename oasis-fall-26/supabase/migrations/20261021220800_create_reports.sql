create type public.report_reason as enum ('out_of_date', 'other');

-- Flags on listings, reviewed by the team in the dashboard.
create table public.reports (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason public.report_reason not null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- One report per person per listing. Its index also serves lookups by listing_id.
  constraint reports_listing_reporter_key unique (listing_id, reporter_id)
);

alter table public.reports enable row level security;

-- The listing must be readable by the reporter (listings RLS applies in the
-- subquery) and not their own.
create policy "users can report listings they can see, except their own"
  on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id <> (select auth.uid())
    )
  );

-- No select/update/delete policies: only the team reads reports (dashboard).
