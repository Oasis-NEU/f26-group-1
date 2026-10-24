begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Start from an empty board so seed data can't change the scores (rolled back below).
delete from public.listings;
delete from public.seeker_posts;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'test.c@example.com');
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'User C');

-- The seeker needs 2027-01-01 to 2027-04-11 (100 days).
insert into public.listings (
  id, owner_id, title, neighborhood, total_bedrooms, open_rooms, rent_per_room,
  start_date, end_date, fill_by, status
)
overriding system value
values
  -- perfect fit: 50 + 25 + 10 + 7.5 = 92.5 -> 93
  (9301, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'perfect', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-04-11', '2026-12-01', 'open'),
  -- 10% over budget, wrong neighborhood: 50 + 8.33 + 0 + 7.5 = 65.8 -> 66
  (9302, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pricey', 'Mission Hill', 3, 1, 1100,
   '2027-01-01', '2027-04-11', '2026-12-01', 'open'),
  -- 20% over budget: 50 + 0 + 10 + 7.5 = 67.5 -> 68
  (9303, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'too pricey', 'Fenway', 3, 1, 1200,
   '2027-01-01', '2027-04-11', '2026-12-01', 'open'),
  -- 40% overlap: not shown
  (9304, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'too short', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-02-10', '2026-12-01', 'open'),
  -- closed: not shown
  (9305, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'closed', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-04-11', '2026-12-01', 'closed'),
  -- the seeker's own listing: not shown
  (9306, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'own', 'Fenway', 3, 1, 1000,
   '2027-01-01', '2027-04-11', '2026-12-01', 'open'),
  -- 80% overlap: 40 + 25 + 10 + 7.5 = 82.5 -> 83
  (9307, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mostly', 'Fenway', 3, 1, 1000,
   '2026-12-22', '2027-03-22', '2026-12-01', 'open');

insert into public.seeker_posts (id, user_id, start_date, end_date, reason, budget_max, neighborhoods, status)
overriding system value
values
  (9401, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2027-01-01', '2027-04-11', 'co_op', 1000, '{Fenway}', 'active'),
  (9402, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2027-01-01', '2027-04-11', 'co_op', 1000, '{}', 'active'),
  (9403, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2027-01-01', '2027-04-11', 'co_op', 1000, '{}', 'paused');

-- Scoring -------------------------------------------------------------------
select is(
  public.match_score('2027-01-01', '2027-04-11', 1000, 'Fenway', '2027-01-01', '2027-04-11', 1000, '{Fenway}'),
  93,
  'a perfect match scores 93 while lifestyle is a placeholder'
);
select is(
  public.match_score('2027-01-01', '2027-02-10', 1000, 'Fenway', '2027-01-01', '2027-04-11', 1000, '{}'),
  null::integer,
  'under 70% date overlap is not shown'
);
select is(
  public.match_score('2027-01-01', '2027-04-11', 1150, 'Fenway', '2027-01-01', '2027-04-11', 1000, '{}'),
  68,
  '15% over budget earns no budget points'
);

-- Seeker B ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select results_eq(
  $$ select listing_id, score from public.match_listings_for_seeker(9401) $$,
  $$ values (9301::bigint, 93), (9307::bigint, 83), (9303::bigint, 68), (9302::bigint, 66) $$,
  'listings are ranked by score; closed, own and short listings are left out'
);
select is_empty(
  $$ select * from public.match_seekers_for_listing(9301) $$,
  'B cannot see matches for A''s listing'
);

-- User C --------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is_empty(
  $$ select * from public.match_listings_for_seeker(9401) $$,
  'C cannot run matching on B''s post'
);

-- Lister A ------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select results_eq(
  $$ select seeker_post_id, score from public.match_seekers_for_listing(9301) $$,
  $$ values (9401::bigint, 93), (9402::bigint, 93) $$,
  'A sees active seekers for their listing, scored the same way'
);
select is_empty(
  $$ select * from public.match_seekers_for_listing(9305) $$,
  'a closed listing has no matches'
);
select throws_ok(
  $$ select public.expire_stale_posts() $$,
  '42501', null,
  'users cannot run the expiry job'
);

-- Logged out ----------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select * from public.match_listings_for_seeker(9401) $$,
  '42501', null,
  'logged-out users cannot call matching'
);

-- Expiry job (relative dates, added after matching so they can't affect it) -
reset role;

insert into public.listings (
  id, owner_id, title, neighborhood, total_bedrooms, open_rooms, rent_per_room,
  start_date, end_date, fill_by, status
)
overriding system value
values
  (9310, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ended', 'Fenway', 3, 1, 1000,
   current_date - 60, current_date - 1, current_date - 70, 'open'),
  (9311, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fill-by 8 days ago', 'Fenway', 3, 1, 1000,
   current_date - 10, current_date + 30, current_date - 8, 'open'),
  (9312, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fill-by 7 days ago', 'Fenway', 3, 1, 1000,
   current_date - 10, current_date + 30, current_date - 7, 'open');

insert into public.seeker_posts (id, user_id, start_date, end_date, reason, budget_max, status)
overriding system value
values
  (9410, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date - 15, current_date + 30, 'other', 1000, 'active'),
  (9411, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date - 14, current_date + 30, 'other', 1000, 'active');

select lives_ok($$ select public.expire_stale_posts() $$, 'the expiry job runs');
select results_eq(
  $$ select id, status::text from public.listings where id in (9310, 9311, 9312) order by id $$,
  $$ values (9310::bigint, 'closed'), (9311::bigint, 'closed'), (9312::bigint, 'open') $$,
  'listings past end_date or a week past fill_by are closed'
);
select results_eq(
  $$ select id, status::text from public.seeker_posts where id in (9410, 9411) order by id $$,
  $$ values (9410::bigint, 'paused'), (9411::bigint, 'active') $$,
  'posts that started over two weeks ago are paused'
);
select isnt_empty(
  $$ select 1 from cron.job where jobname = 'expire-stale-posts' and schedule = '0 8 * * *' $$,
  'the expiry job is scheduled daily at 08:00'
);

select * from finish();
rollback;
