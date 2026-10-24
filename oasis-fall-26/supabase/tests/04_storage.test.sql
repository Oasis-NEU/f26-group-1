begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test.b@example.com');

select results_eq(
  $$ select public from storage.buckets where id = 'listing-photos' $$,
  $$ values (false) $$,
  'listing-photos bucket exists and is private'
);

-- User A --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('listing-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1/photo.webp') $$,
  'A can upload into their own folder'
);

-- User B --------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('listing-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1/evil.webp') $$,
  '42501', null,
  'B cannot upload into A''s photo folder'
);
select isnt_empty(
  $$ select id from storage.objects where name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1/photo.webp' $$,
  'logged-in users can read listing photos'
);
select is_empty(
  $$ update storage.objects set name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/1/photo.webp'
     where name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1/photo.webp' returning id $$,
  'B cannot move A''s photo'
);

-- Logged out ----------------------------------------------------------------
set local role anon;

select is_empty(
  $$ select id from storage.objects where bucket_id = 'listing-photos' $$,
  'logged-out users cannot read listing photos'
);

reset role;
select * from finish();
rollback;
