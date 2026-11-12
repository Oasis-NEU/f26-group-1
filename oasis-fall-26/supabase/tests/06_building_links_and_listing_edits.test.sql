begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com');
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B');

insert into public.buildings (id, name, neighborhood, address)
overriding system value
values
  (9101, 'Test Linked Building', 'Fenway', '1 Test St, Boston, MA 02115'),
  (9102, 'Test Added Later', 'Mission Hill', null);

-- Building addresses ---------------------------------------------------------
select throws_ok(
  $$ update public.buildings set address = '   ' where id = 9101 $$,
  '23514', null,
  'a blank building address is rejected'
);
select throws_ok(
  $$ update public.buildings set address = repeat('x', 201) where id = 9101 $$,
  '23514', null,
  'building addresses are capped at 200 characters'
);

-- Building coordinates -------------------------------------------------------
select lives_ok(
  $$ update public.buildings set latitude = 42.34, longitude = -71.09 where id = 9101 $$,
  'a building can have a latitude/longitude pair'
);
select throws_ok(
  $$ update public.buildings set latitude = 42.34, longitude = null where id = 9102 $$,
  '23514', null,
  'latitude and longitude must be set together'
);
select throws_ok(
  $$ update public.buildings set latitude = 91, longitude = -71.09 where id = 9102 $$,
  '23514', null,
  'latitude must be between -90 and 90'
);

-- A listing posted with "Other" (no building) -------------------------------
insert into public.listings (
  id, owner_id, title, neighborhood, building_id, total_bedrooms, open_rooms, rent_per_room,
  start_date, end_date, fill_by
)
overriding system value
values
  (9201, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A other', 'Mission Hill', null, 3, 1, 1000,
   '2027-01-01', '2027-06-30', '2026-12-15');

-- User B cannot link or edit A's listing -------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select is_empty(
  $$ update public.listings set building_id = 9102 where id = 9201 returning id $$,
  'B cannot link A''s listing to a building'
);
select is_empty(
  $$ update public.listings set rent_per_room = 1 where id = 9201 returning id $$,
  'B cannot edit A''s listing details'
);

-- User A (owner) can edit their listing, including its building ------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select results_eq(
  $$ update public.listings set building_id = 9102 where id = 9201 returning building_id $$,
  $$ values (9102::bigint) $$,
  'A can link their listing to a building added later'
);
select results_eq(
  $$ update public.listings set title = 'A edited', rent_per_room = 1100 where id = 9201
     returning title, rent_per_room $$,
  $$ values ('A edited'::text, 1100) $$,
  'A can edit their listing details'
);
select results_eq(
  $$ select l.id from public.listings l where l.building_id = 9102 and l.status = 'open' $$,
  $$ values (9201::bigint) $$,
  'the linked listing shows up under its building'
);
select results_eq(
  $$ update public.listings set building_id = null where id = 9201 returning building_id $$,
  $$ values (null::bigint) $$,
  'A can unlink their listing (back to Other)'
);

reset role;
select * from finish();
rollback;
