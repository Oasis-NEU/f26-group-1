-- Local dev data only. Runs on `supabase db reset`.
-- Log in as any seed user locally: enter their email on the sign-in page and
-- read the code from Mailpit at http://127.0.0.1:54324.
-- Dates are relative to current_date so matching keeps working over time.

-- Users ---------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'alex@example.com'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'priya@example.com'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'jordan@example.com'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'sam@example.com'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'taylor@example.com')
) as u (id, email);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@example.com';

insert into public.profiles (id, full_name, year, major, bio) values
  ('11111111-1111-4111-8111-111111111111', 'Alex Rivera', '3rd year', 'Computer Science',
   'Two roommates staying, one leaving for co-op in Seattle.'),
  ('22222222-2222-4222-8222-222222222222', 'Priya Shah', '4th year', 'Bioengineering',
   'Quiet apartment near the Museum of Fine Arts.'),
  ('33333333-3333-4333-8333-333333333333', 'Jordan Lee', '2nd year', 'Mechanical Engineering',
   'Back in Boston for a spring co-op.'),
  ('44444444-4444-4444-8444-444444444444', 'Sam Okafor', '1st year', 'Business',
   'Taking summer classes.'),
  ('55555555-5555-4555-8555-555555555555', 'Taylor Nguyen', '5th year', 'Data Science',
   'Summer internship downtown.');

insert into public.lifestyle (user_id, sleep, cleanliness, guests, noise, smokes, has_pets, dealbreakers) values
  ('11111111-1111-4111-8111-111111111111', 4, 3, 3, 3, false, false, '{}'),
  ('33333333-3333-4333-8333-333333333333', 2, 4, 2, 2, false, false, '{smoking}');
-- Priya, Sam and Taylor have no lifestyle row on purpose: matching must still work.

-- Buildings (fictional placeholders; replace with the team's real list) -----

insert into public.buildings (
  id, name, neighborhood, management_company, walk_minutes_to_campus, rent_range,
  laundry, heat_ac, amenities, summary, sources
)
overriding system value
values
  (1, 'Fenway Commons (sample)', 'Fenway', 'Sample Property Co.', 8, '$1,100–$1,400/room',
   'In-building', 'Heat included, window AC', '{bike room,elevator}',
   'Fictional building for local development.',
   '[{"title": "Example source", "url": "https://example.com/fenway-commons"}]'),
  (2, 'Mission Hill Lofts (sample)', 'Mission Hill', 'Sample Realty', 12, '$950–$1,250/room',
   'Coin-op in basement', 'Radiator heat, no AC', '{}',
   'Fictional building for local development.', '[]'),
  (3, 'Back Bay Towers (sample)', 'Back Bay', 'Example Management', 15, '$1,500–$1,900/room',
   'In-unit', 'Central heat and AC', '{gym,doorman,elevator}',
   'Fictional building for local development.', '[]'),
  (4, 'South End Row (sample)', 'South End', null, 18, '$1,300–$1,600/room',
   'Laundromat nearby', 'Heat included', '{roof deck}',
   'Fictional building for local development.', '[]'),
  (5, 'Roxbury Crossing Flats (sample)', 'Roxbury', 'Sample Property Co.', 10, '$850–$1,100/room',
   'In-building', 'Heat included, no AC', '{}',
   'Fictional building for local development.', '[]'),
  (6, 'Symphony Place (sample)', 'Symphony', 'Example Management', 5, '$1,200–$1,500/room',
   'In-building', 'Central heat and AC', '{elevator}',
   'Fictional building for local development.', '[]');

select setval(pg_get_serial_sequence('public.buildings', 'id'), (select max(id) from public.buildings));

-- Building comparison specs (fictional, same shape as scraping/building_specs.py output).
-- To load real scraped data locally, run `python3 building_specs.py build --sql --with-buildings`
-- in scraping/ and run output/specs/building_specs.sql against the local database.

update public.buildings set slug = v.slug
from (values
  (1, 'fenway-commons-sample'), (2, 'mission-hill-lofts-sample'), (3, 'back-bay-towers-sample'),
  (4, 'south-end-row-sample'), (5, 'roxbury-crossing-flats-sample'), (6, 'symphony-place-sample')
) as v (id, slug)
where public.buildings.id = v.id;

insert into public.building_specs (building_id, specs, catalog_version, scraped_at) values
  (1, '{
    "overview.kind": {"value": "apartment_building", "source": "building_list", "status": "verified"},
    "overview.campus": {"value": "off", "source": "building_list", "status": "verified"},
    "overview.neighborhood": {"value": "Fenway", "source": "building_list", "status": "verified"},
    "overview.year_built": {"value": 1925, "source": "boston_open_data", "status": "verified"},
    "cost.rent_pp_month_min": {"value": 1100, "source": "manual", "status": "verified"},
    "cost.rent_pp_month_max": {"value": 1400, "source": "manual", "status": "verified"},
    "amenities.laundry": {"value": "in_building", "source": "manual", "status": "verified"},
    "amenities.elevator": {"value": true, "source": "manual", "status": "verified"},
    "unit.ac": {"value": "unit", "source": "boston_open_data", "status": "verified"},
    "location.walk_min_campus": {"value": 8, "source": "boston_open_data", "status": "verified"},
    "location.t_stations": {"value": [{"name": "Fenway", "detail": "Green Line D", "walk_minutes": 6, "distance_m": 450}],
                            "source": "boston_open_data", "status": "verified"},
    "record.complaints_pests": {"value": 2, "source": "boston_open_data", "status": "verified"}
  }', 1, current_date),
  (2, '{
    "overview.kind": {"value": "address", "source": "building_list", "status": "verified"},
    "overview.campus": {"value": "off", "source": "building_list", "status": "verified"},
    "overview.neighborhood": {"value": "Mission Hill", "source": "building_list", "status": "verified"},
    "overview.year_built": {"value": 1905, "source": "boston_open_data", "status": "verified"},
    "cost.rent_pp_month_min": {"value": 950, "source": "manual", "status": "verified"},
    "cost.rent_pp_month_max": {"value": 1250, "source": "manual", "status": "verified"},
    "amenities.laundry": {"value": "in_building", "source": "manual", "status": "verified"},
    "amenities.elevator": {"value": false, "source": "manual", "status": "verified"},
    "unit.ac": {"value": "none", "source": "boston_open_data", "status": "verified"},
    "location.walk_min_campus": {"value": 12, "source": "boston_open_data", "status": "verified"},
    "location.t_stations": {"value": [{"name": "Brigham Circle", "detail": "Green Line E", "walk_minutes": 5, "distance_m": 380}],
                            "source": "boston_open_data", "status": "verified"},
    "record.complaints_pests": {"value": 7, "source": "boston_open_data", "status": "verified"}
  }', 1, current_date),
  (6, '{
    "overview.kind": {"value": "apartment_building", "source": "building_list", "status": "verified"},
    "overview.campus": {"value": "off", "source": "building_list", "status": "verified"},
    "overview.neighborhood": {"value": "Symphony", "source": "building_list", "status": "verified"},
    "cost.rent_pp_month_min": {"value": 1200, "source": "manual", "status": "verified"},
    "cost.rent_pp_month_max": {"value": 1500, "source": "manual", "status": "verified"},
    "amenities.laundry": {"value": "in_unit", "source": "manual", "status": "verified"},
    "amenities.elevator": {"value": true, "source": "manual", "status": "verified"},
    "amenities.fitness_center": {"value": true, "source": "manual", "status": "verified"},
    "unit.ac": {"value": "central", "source": "manual", "status": "verified"},
    "location.walk_min_campus": {"value": 5, "source": "boston_open_data", "status": "verified"},
    "location.t_stations": {"value": [{"name": "Symphony", "detail": "Green Line E", "walk_minutes": 3, "distance_m": 220}],
                            "source": "boston_open_data", "status": "verified"}
  }', 1, current_date),
  -- Uses every value type (rates, list, places, semester money, an unverified value) so the
  -- compare page can be checked locally.
  (3, '{
    "overview.kind": {"value": "apartment_building", "source": "building_list", "status": "verified"},
    "overview.campus": {"value": "affiliated", "source": "building_list", "status": "verified"},
    "overview.housing_style": {"value": "apartment", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "overview.neighborhood": {"value": "Back Bay", "source": "building_list", "status": "verified"},
    "overview.management": {"value": "Example Management", "source": "manual", "status": "verified"},
    "overview.year_built": {"value": 1968, "source": "boston_open_data", "status": "verified"},
    "overview.stories": {"value": 14, "source": "boston_open_data", "status": "verified"},
    "cost.rent_pp_month_min": {"value": 1500, "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.rent_pp_month_max": {"value": 1900, "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.nu_semester_min": {"value": 6000, "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.nu_semester_max": {"value": 7600, "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.nu_rates": {"value": [
        {"chart": "upperclass", "style": "apartment", "tier": "standard", "room_type": "single_room", "semester_usd": 7600, "accommodation_only": false},
        {"chart": "upperclass", "style": "apartment", "tier": "standard", "room_type": "double_room", "semester_usd": 6000, "accommodation_only": false}
      ], "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.rate_year": {"value": "2026–27", "source": "nu_rates", "url": "https://housing.northeastern.edu/rates/", "status": "verified"},
    "cost.lease_type": {"value": "nu_housing", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "cost.broker_fee": {"value": false, "source": "manual", "status": "verified"},
    "unit.bedroom_types": {"value": ["Standard single bedrooms", "Standard double bedrooms"], "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "unit.kitchen": {"value": "full", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "unit.furnished": {"value": true, "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "unit.ac": {"value": "central", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "amenities.laundry": {"value": "in_unit", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "amenities.elevator": {"value": true, "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "amenities.security": {"value": "staffed_24h", "source": "nu_housing", "url": "https://housing.northeastern.edu/", "status": "verified"},
    "amenities.fitness_center": {"value": true, "source": "official_site", "status": "unverified"},
    "location.walk_min_campus": {"value": 15, "source": "boston_open_data", "status": "verified"},
    "location.t_stations": {"value": [
        {"name": "Hynes Convention Center", "detail": "Green Line B, C, D", "walk_minutes": 4, "distance_m": 300},
        {"name": "Back Bay", "detail": "Orange Line", "walk_minutes": 9, "distance_m": 700}
      ], "source": "boston_open_data", "status": "verified"},
    "location.supermarket": {"value": [{"name": "Example Market", "walk_minutes": 5, "distance_m": 380}], "source": "boston_open_data", "status": "verified"},
    "location.bluebikes_m": {"value": 140, "source": "boston_open_data", "status": "verified"},
    "location.basis": {"value": "building", "source": "boston_open_data", "status": "verified"},
    "record.complaints_pests": {"value": 1, "source": "boston_open_data", "status": "verified"},
    "record.violations": {"value": 3, "source": "boston_open_data", "status": "verified"},
    "record.violations_open": {"value": 0, "source": "boston_open_data", "status": "verified"}
  }', 1, current_date);

-- Listings ------------------------------------------------------------------

insert into public.listings (
  id, owner_id, title, neighborhood, building_id, total_bedrooms, open_rooms, rent_per_room,
  utilities_included, furnished, start_date, end_date, fill_by, description, status
)
overriding system value
values
  (1, '11111111-1111-4111-8111-111111111111', 'Two rooms in a Fenway 4-bed', 'Fenway', 1,
   4, 2, 1150, true, true, current_date + 55, current_date + 245, current_date + 40,
   'Two of us are leaving for co-op. Furnished rooms, close to the Fenway T stop.', 'open'),
  (2, '11111111-1111-4111-8111-111111111111', 'Sunny room on Mission Hill', 'Mission Hill', 2,
   3, 1, 1300, false, false, current_date + 60, current_date + 200, current_date + 45,
   'Big window, quiet street.', 'open'),
  (3, '22222222-2222-4222-8222-222222222222', 'Back Bay room for the summer', 'Back Bay', 3,
   2, 1, 1600, true, true, current_date + 30, current_date + 150, current_date + 20,
   'Doorman building, in-unit laundry.', 'open'),
  (4, '22222222-2222-4222-8222-222222222222', 'Cheap rooms near Roxbury Crossing', 'Roxbury', 5,
   5, 2, 950, false, true, current_date + 20, current_date + 130, current_date + 10,
   'Five-bed house, three of us staying.', 'open'),
  (5, '55555555-5555-4555-8555-555555555555', 'South End room while I intern', 'South End', 4,
   3, 1, 1400, false, true, current_date + 40, current_date + 140, current_date + 30,
   null, 'open'),
  (6, '11111111-1111-4111-8111-111111111111', 'Allston room (old)', 'Allston/Brighton', null,
   3, 1, 1000, false, false, current_date - 200, current_date - 20, current_date - 210,
   'This one is over.', 'closed'),
  (7, '22222222-2222-4222-8222-222222222222', 'JP room (taken)', 'Jamaica Plain', null,
   2, 0, 1100, true, false, current_date + 10, current_date + 100, current_date,
   null, 'filled');

select setval(pg_get_serial_sequence('public.listings', 'id'), (select max(id) from public.listings));

insert into public.listing_roommates (listing_id, user_id, display_name, note) values
  (1, '11111111-1111-4111-8111-111111111111', 'Alex', 'Staying the whole time.'),
  (1, null, 'Morgan', 'Grad student, usually at the lab.'),
  (4, null, 'Chris', null),
  (4, null, 'Dana', 'Has a cat.');

-- Seeker posts --------------------------------------------------------------

insert into public.seeker_posts (
  user_id, start_date, end_date, reason, budget_max, neighborhoods, note, status
) values
  ('33333333-3333-4333-8333-333333333333', current_date + 60, current_date + 240, 'co_op',
   1200, '{Fenway,Mission Hill}', 'Spring co-op, need a place through the summer.', 'active'),
  ('44444444-4444-4444-8444-444444444444', current_date + 30, current_date + 120, 'summer_classes',
   1000, '{}', 'Anywhere on the Green or Orange Line works.', 'active'),
  ('55555555-5555-4555-8555-555555555555', current_date + 45, current_date + 135, 'internship',
   1500, '{Back Bay,South End}', null, 'active'),
  ('22222222-2222-4222-8222-222222222222', current_date + 10, current_date + 90, 'other',
   900, '{}', 'Old post.', 'paused');

-- Reports -------------------------------------------------------------------

insert into public.reports (listing_id, reporter_id, reason, note) values
  (2, '33333333-3333-4333-8333-333333333333', 'out_of_date', 'Owner said it was taken.');
