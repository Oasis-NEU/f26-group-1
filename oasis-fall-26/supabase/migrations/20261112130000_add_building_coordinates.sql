-- Map pins for the buildings page. Coordinates are looked up once (scraper or
-- dashboard) from the building's address, never geocoded in the browser.
alter table public.buildings
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint buildings_coordinates_pair_check
    check ((latitude is null) = (longitude is null));

comment on column public.buildings.latitude is 'WGS84 latitude; set together with longitude, or both null (no map pin)';
comment on column public.buildings.longitude is 'WGS84 longitude; set together with latitude, or both null (no map pin)';
