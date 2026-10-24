begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com');
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B');

insert into public.listings (
  id, owner_id, title, neighborhood, total_bedrooms, open_rooms, rent_per_room,
  start_date, end_date, fill_by, status
)
overriding system value
values
  (9001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A open', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-06-30', '2026-12-15', 'open'),
  (9002, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A closed', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-06-30', '2026-12-15', 'closed');
insert into public.listing_photos (listing_id, path, position) values
  (9002, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/9002/closed.webp', 0);
insert into public.listing_roommates (listing_id, display_name) values
  (9002, 'Hidden roommate');

-- User A (owner) ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A new', 'Mission Hill', 2, 1,
       900, '2027-01-01', '2027-04-30', '2026-12-01') $$,
  'A can create a listing'
);
select throws_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad dates', 'Fenway', 2, 1,
       900, '2027-04-30', '2027-01-01', '2026-12-01') $$,
  '23514', null,
  'end_date must be after start_date'
);
select throws_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'No rooms', 'Fenway', 2, 0,
       900, '2027-01-01', '2027-04-30', '2026-12-01') $$,
  '23514', null,
  'an open listing needs at least one open room'
);
select throws_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Too many', 'Fenway', 2, 3,
       900, '2027-01-01', '2027-04-30', '2026-12-01') $$,
  '23514', null,
  'open_rooms cannot exceed total_bedrooms'
);
select throws_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Free', 'Fenway', 2, 1,
       0, '2027-01-01', '2027-04-30', '2026-12-01') $$,
  '23514', null,
  'rent must be positive'
);
select lives_ok(
  $$ insert into public.listing_photos (listing_id, path, position)
     values (9001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/9001/one.webp', 0) $$,
  'A can add a photo to their listing'
);
select throws_ok(
  $$ insert into public.listing_photos (listing_id, path, position)
     values (9001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/9001/nine.webp', 8) $$,
  '23514', null,
  'at most 8 photos per listing (slots 0-7)'
);
select throws_ok(
  $$ insert into public.listing_photos (listing_id, path, position)
     values (9001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/9001/dupe.webp', 0) $$,
  '23505', null,
  'one photo per slot'
);
select throws_ok(
  $$ insert into public.listing_photos (listing_id, path, position)
     values (9001, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/9001/x.webp', 1) $$,
  '42501', null,
  'photo path must be in the owner''s folder for that listing'
);
select lives_ok(
  $$ insert into public.listing_roommates (listing_id, display_name) values (9001, 'Roommate') $$,
  'A can list a roommate on their listing'
);

-- User B --------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select results_eq(
  $$ select title from public.listings where id = 9001 $$,
  $$ values ('A open') $$,
  'B can see A''s open listing'
);
select is_empty(
  $$ select id from public.listings where id = 9002 $$,
  'B cannot see A''s closed listing'
);
select is_empty(
  $$ update public.listings set title = 'hacked' where id = 9001 returning id $$,
  'B cannot edit A''s listing'
);
select is_empty(
  $$ delete from public.listings where id = 9001 returning id $$,
  'B cannot delete A''s listing'
);
select throws_ok(
  $$ insert into public.listings (owner_id, title, neighborhood, total_bedrooms, open_rooms,
       rent_per_room, start_date, end_date, fill_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fake', 'Fenway', 2, 1,
       900, '2027-01-01', '2027-04-30', '2026-12-01') $$,
  '42501', null,
  'B cannot create a listing owned by A'
);
select isnt_empty(
  $$ select id from public.listing_photos where listing_id = 9001 $$,
  'B can see photos on A''s open listing'
);
select is_empty(
  $$ select id from public.listing_photos where listing_id = 9002 $$,
  'B cannot see photos on A''s closed listing'
);
select throws_ok(
  $$ insert into public.listing_photos (listing_id, path, position)
     values (9001, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/9001/x.webp', 1) $$,
  '42501', null,
  'B cannot add photos to A''s listing'
);
select is_empty(
  $$ delete from public.listing_photos where listing_id = 9001 returning id $$,
  'B cannot delete photos on A''s listing'
);
select isnt_empty(
  $$ select id from public.listing_roommates where listing_id = 9001 $$,
  'B can see roommates on A''s open listing'
);
select is_empty(
  $$ select id from public.listing_roommates where listing_id = 9002 $$,
  'B cannot see roommates on A''s closed listing'
);
select throws_ok(
  $$ insert into public.listing_roommates (listing_id, display_name) values (9001, 'Intruder') $$,
  '42501', null,
  'B cannot add roommates to A''s listing'
);

-- Back to A -----------------------------------------------------------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select isnt_empty(
  $$ select id from public.listings where id = 9002 $$,
  'A can still see their own closed listing'
);
select lives_ok(
  $$ update public.listings set status = 'filled', open_rooms = 0 where id = 9001 $$,
  'A can mark their listing filled'
);
select results_eq(
  $$ select status::text from public.listings where id = 9001 $$,
  $$ values ('filled') $$,
  'the listing is now filled'
);
select throws_ok(
  $$ update public.listings set status = 'open' where id = 9001 $$,
  '23514', null,
  'cannot reopen a listing with no open rooms'
);

-- Logged out ----------------------------------------------------------------
set local role anon;

select is_empty($$ select id from public.listings $$, 'logged-out users cannot see listings');

reset role;
select * from finish();
rollback;
