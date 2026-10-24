-- Temporary: sign-in is anonymous while email delivery is unsolved, so users
-- type their Northeastern email here. It is NOT verified. Drop or replace with
-- auth.users.email once magic-link sign-in comes back.
alter table public.profiles
  add column email text
    check (char_length(email) <= 254 and lower(email) like '%@northeastern.edu');
