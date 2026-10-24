-- One housing info page per building/complex, written by the team.
-- Summaries are in the team's own words; original posts go in sources.
create table public.buildings (
  id bigint generated always as identity primary key,
  name text not null unique,
  neighborhood text not null,
  management_company text,
  walk_minutes_to_campus smallint check (walk_minutes_to_campus >= 0),
  rent_range text,
  laundry text,
  heat_ac text,
  amenities text[] not null default '{}',
  summary text,
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  updated_at date not null default current_date
);

comment on column public.buildings.sources is '[{"title": "...", "url": "..."}]';

alter table public.buildings enable row level security;

create policy "buildings are readable by logged-in users"
  on public.buildings for select to authenticated
  using (true);

-- No write policies: the team maintains buildings through the Supabase dashboard.
