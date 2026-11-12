-- Buildings may now show a street address (the MVP no-address rule was lifted
-- for buildings). Listings still show only neighborhood + building.
alter table public.buildings
  add column address text check (char_length(btrim(address)) between 1 and 200);

comment on column public.buildings.address is 'Street address of the building, e.g. "123 Example St, Boston, MA 02115"';
