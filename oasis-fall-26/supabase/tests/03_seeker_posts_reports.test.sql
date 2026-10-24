begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'test.c@example.com');
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'User C');

insert into public.listings (
  id, owner_id, title, neighborhood, total_bedrooms, open_rooms, rent_per_room,
  start_date, end_date, fill_by, status
)
overriding system value
values
  (9101, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A open', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-06-30', '2026-12-15', 'open'),
  (9102, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A closed', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-06-30', '2026-12-15', 'closed');

insert into public.seeker_posts (id, user_id, start_date, end_date, reason, budget_max, status)
overriding system value
values
  (9201, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-01-01', '2027-06-30', 'co_op', 1100, 'active'),
  (9202, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-01-01', '2027-06-30', 'co_op', 1100, 'paused');

-- User B (seeker) -----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.seeker_posts (user_id, start_date, end_date, reason, budget_max, neighborhoods)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-05-01', '2027-08-15', 'summer_classes', 900, '{Fenway}') $$,
  'B can create a seeker post'
);
select throws_ok(
  $$ insert into public.seeker_posts (user_id, start_date, end_date, reason, budget_max)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2027-05-01', '2027-08-15', 'other', 900) $$,
  '42501', null,
  'B cannot create a post for A'
);
select throws_ok(
  $$ insert into public.seeker_posts (user_id, start_date, end_date, reason, budget_max)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-08-15', '2027-05-01', 'other', 900) $$,
  '23514', null,
  'seeker end_date must be after start_date'
);
select throws_ok(
  $$ insert into public.seeker_posts (user_id, start_date, end_date, reason, budget_max)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-05-01', '2027-08-15', 'other', 0) $$,
  '23514', null,
  'budget must be positive'
);
select lives_ok(
  $$ insert into public.reports (listing_id, reporter_id, reason)
     values (9101, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'out_of_date') $$,
  'B can report A''s listing'
);
select throws_ok(
  $$ insert into public.reports (listing_id, reporter_id, reason)
     values (9101, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other') $$,
  '23505', null,
  'one report per person per listing'
);
select throws_ok(
  $$ insert into public.reports (listing_id, reporter_id, reason)
     values (9102, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'out_of_date') $$,
  '42501', null,
  'B cannot report a listing they cannot see'
);
select throws_ok(
  $$ insert into public.reports (listing_id, reporter_id, reason)
     values (9101, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'out_of_date') $$,
  '42501', null,
  'B cannot file a report as someone else'
);
select is_empty(
  $$ select id from public.reports $$,
  'B cannot read reports, even their own'
);
select is_empty(
  $$ update public.reports set note = 'edited' returning id $$,
  'B cannot edit reports'
);

-- User A (lister) -----------------------------------------------------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.reports (listing_id, reporter_id, reason)
     values (9101, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other') $$,
  '42501', null,
  'A cannot report their own listing'
);
select is_empty(
  $$ select id from public.reports $$,
  'A cannot read reports on their listing'
);
select isnt_empty(
  $$ select id from public.seeker_posts where id = 9201 $$,
  'A can see B''s active post'
);
select is_empty(
  $$ select id from public.seeker_posts where id = 9202 $$,
  'A cannot see B''s paused post'
);
select is_empty(
  $$ update public.seeker_posts set budget_max = 1 where id = 9201 returning id $$,
  'A cannot edit B''s post'
);
select is_empty(
  $$ delete from public.seeker_posts where id = 9201 returning id $$,
  'A cannot delete B''s post'
);

-- Back to B -----------------------------------------------------------------
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select isnt_empty(
  $$ select id from public.seeker_posts where id = 9202 $$,
  'B can see their own paused post'
);
select lives_ok(
  $$ update public.seeker_posts set status = 'housed' where id = 9201 $$,
  'B can mark their post housed'
);
select results_eq(
  $$ select status::text from public.seeker_posts where id = 9201 $$,
  $$ values ('housed') $$,
  'the post is now housed'
);

reset role;
select * from finish();
rollback;
