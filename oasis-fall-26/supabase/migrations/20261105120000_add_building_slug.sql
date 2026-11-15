-- Stable text id shared with scraping/ (the "id" in nusublet_buildings.json), so scraped
-- comparison specs can be matched to rows without relying on display names.
-- Nullable: team-written buildings that aren't in the scraped list don't need one.
alter table public.buildings
  add column slug text unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80);
