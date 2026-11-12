begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test.a@example.com');
insert into public.buildings (id, name, neighborhood, slug)
overriding system value
values (900001, 'Spec Test Hall', 'Fenway', 'spec-test-hall'),
       (900002, 'Spec Test Annex', 'Fenway', null);

-- Constraints (as the table owner) --------------------------------------------

select lives_ok(
  $$ insert into public.building_specs (building_id, specs, catalog_version, scraped_at)
     values (900001,
             '{"location.walk_min_campus": {"value": 6, "source": "boston_open_data", "status": "verified"}}',
             1, '2026-11-05') $$,
  'specs in the catalog shape are accepted'
);
select throws_ok(
  $$ update public.building_specs set specs = '{"location.walk_min_campus": 6}' where building_id = 900001 $$,
  '23514', null,
  'a field must be an object, not a bare value'
);
select throws_ok(
  $$ update public.building_specs set specs = '{"location.walk_min_campus": {"source": "x"}}' where building_id = 900001 $$,
  '23514', null,
  'a field must have a value'
);
select throws_ok(
  $$ update public.building_specs set specs = '[]' where building_id = 900001 $$,
  '23514', null,
  'specs must be an object'
);
select throws_ok(
  $$ update public.buildings set slug = 'Not A Slug' where id = 900002 $$,
  '23514', null,
  'slugs are lowercase words joined by dashes'
);
select throws_ok(
  $$ update public.buildings set slug = 'spec-test-hall' where id = 900002 $$,
  '23505', null,
  'slugs are unique'
);

-- Logged-in user ----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select results_eq(
  $$ select (specs -> 'location.walk_min_campus' ->> 'value')::int from public.building_specs where building_id = 900001 $$,
  $$ values (6) $$,
  'logged-in users can read building specs'
);
select throws_ok(
  $$ insert into public.building_specs (building_id, specs, catalog_version, scraped_at)
     values (900002, '{}', 1, current_date) $$,
  '42501', null,
  'users cannot add building specs'
);
select is_empty(
  $$ update public.building_specs set specs = '{}' where building_id = 900001 returning building_id $$,
  'users cannot edit building specs'
);

-- Logged out ----------------------------------------------------------------------
set local role anon;

select is_empty($$ select building_id from public.building_specs $$,
  'logged-out users cannot read building specs');

reset role;
select * from finish();
rollback;
