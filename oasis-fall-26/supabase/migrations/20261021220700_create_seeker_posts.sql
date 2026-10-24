create type public.seeker_reason as enum ('co_op', 'summer_classes', 'internship', 'other');
create type public.seeker_status as enum ('active', 'paused', 'housed');

-- A student looking for a room for specific dates.
create table public.seeker_posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason public.seeker_reason not null,
  budget_max integer not null check (budget_max > 0),
  -- Empty array = anywhere.
  neighborhoods text[] not null default '{}',
  note text check (char_length(note) <= 1000),
  status public.seeker_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint seeker_posts_dates_check check (end_date > start_date)
);

comment on column public.seeker_posts.budget_max is 'Whole dollars per month';

create index seeker_posts_status_dates_idx on public.seeker_posts (status, start_date, end_date);
create index seeker_posts_user_id_idx on public.seeker_posts (user_id);

alter table public.seeker_posts enable row level security;

create policy "active posts and your own are readable"
  on public.seeker_posts for select to authenticated
  using (status = 'active' or user_id = (select auth.uid()));

create policy "users can create their own posts"
  on public.seeker_posts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "users can update their own posts"
  on public.seeker_posts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users can delete their own posts"
  on public.seeker_posts for delete to authenticated
  using (user_id = (select auth.uid()));
