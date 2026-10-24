-- Optional lifestyle answers. Matching must keep working when a user has no row.
create table public.lifestyle (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  sleep smallint check (sleep between 1 and 5),
  cleanliness smallint check (cleanliness between 1 and 5),
  guests smallint check (guests between 1 and 5),
  noise smallint check (noise between 1 and 5),
  smokes boolean,
  has_pets boolean,
  dealbreakers text[] not null default '{}'
);

comment on column public.lifestyle.sleep is '1 = early bird … 5 = night owl';
comment on column public.lifestyle.cleanliness is '1 = relaxed … 5 = very tidy';
comment on column public.lifestyle.guests is '1 = rarely … 5 = often';
comment on column public.lifestyle.noise is '1 = quiet … 5 = loud';

alter table public.lifestyle enable row level security;

create policy "lifestyle is readable by logged-in users"
  on public.lifestyle for select to authenticated
  using (true);

create policy "users can create their own lifestyle"
  on public.lifestyle for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users can update their own lifestyle"
  on public.lifestyle for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users can delete their own lifestyle"
  on public.lifestyle for delete to authenticated
  using ((select auth.uid()) = user_id);
