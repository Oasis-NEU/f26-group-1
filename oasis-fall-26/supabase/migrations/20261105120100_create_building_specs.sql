-- Comparison specs per building (cost, rooms, amenities, location, city records), produced
-- by scraping/building_specs.py and reviewed by the team before loading. Field keys and value
-- types are defined in scraping/data/field_catalog.json; the build step validates values
-- against it. Rows are replaced wholesale on each load, so team-written content stays in
-- public.buildings.
create table public.building_specs (
  building_id bigint primary key references public.buildings on delete cascade,
  specs jsonb not null default '{}'
    check (jsonb_typeof(specs) = 'object')
    -- every field is {"value": ..., "source": "...", ...}
    check (not jsonb_path_exists(specs, '$.* ? (@.type() != "object" || !(exists(@.value)))')),
  catalog_version smallint not null check (catalog_version > 0),
  scraped_at date not null
);

comment on column public.building_specs.specs is
  '{"<field key>": {"value": ..., "source": "...", "url": "...", "status": "verified"}}';

alter table public.building_specs enable row level security;

create policy "building specs are readable by logged-in users"
  on public.building_specs for select to authenticated
  using (true);

-- No write policies: loaded from the SQL that `building_specs.py build --sql` generates
-- (seed.sql locally, the SQL editor in production).
grant select on public.building_specs to authenticated;
