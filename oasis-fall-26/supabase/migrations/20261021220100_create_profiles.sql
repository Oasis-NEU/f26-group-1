-- One row per user, created by the onboarding form after first login
-- (no automatic profile creation).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  year text check (char_length(year) <= 30),
  major text check (char_length(major) <= 100),
  bio text check (char_length(bio) <= 500),
  school text not null default 'Northeastern',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by logged-in users"
  on public.profiles for select to authenticated
  using (true);

create policy "users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "users can delete their own profile"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);
