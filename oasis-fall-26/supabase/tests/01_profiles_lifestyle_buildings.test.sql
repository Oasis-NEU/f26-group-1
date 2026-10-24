begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'test.c@example.com');
insert into public.buildings (name, neighborhood) values ('Test Building', 'Fenway');

-- User A --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.profiles (id, full_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A') $$,
  'A can create their own profile'
);
select throws_ok(
  $$ insert into public.profiles (id, full_name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Not C') $$,
  '42501', null,
  'A cannot create a profile for someone else'
);
select throws_ok(
  $$ update public.profiles set bio = repeat('x', 501) where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '23514', null,
  'bio is capped at 500 characters'
);
select throws_ok(
  $$ update public.profiles set email = 'a@gmail.com' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '23514', null,
  'profile email must be @northeastern.edu'
);
select lives_ok(
  $$ insert into public.lifestyle (user_id, sleep, cleanliness) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3, 5) $$,
  'A can save their own lifestyle answers'
);
select throws_ok(
  $$ update public.lifestyle set sleep = 6 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '23514', null,
  'lifestyle answers must be 1-5'
);

-- User B --------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.profiles (id, full_name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B') $$,
  'B can create their own profile'
);
select results_eq(
  $$ select full_name from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  $$ values ('User A') $$,
  'B can read A''s profile'
);
select is_empty(
  $$ update public.profiles set bio = 'hacked' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning id $$,
  'B cannot edit A''s profile'
);
select throws_ok(
  $$ insert into public.lifestyle (user_id, sleep) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1) $$,
  '42501', null,
  'B cannot write A''s lifestyle answers'
);
select isnt_empty(
  $$ select 1 from public.buildings where name = 'Test Building' $$,
  'logged-in users can read buildings'
);
select throws_ok(
  $$ insert into public.buildings (name, neighborhood) values ('My Building', 'Fenway') $$,
  '42501', null,
  'users cannot add buildings'
);
select is_empty(
  $$ update public.buildings set summary = 'x' where name = 'Test Building' returning id $$,
  'users cannot edit buildings'
);

-- Logged out ----------------------------------------------------------------
set local role anon;

select is_empty($$ select id from public.profiles $$, 'logged-out users cannot read profiles');
select is_empty($$ select user_id from public.lifestyle $$, 'logged-out users cannot read lifestyle');
select is_empty($$ select id from public.buildings $$, 'logged-out users cannot read buildings');

reset role;
select * from finish();
rollback;
