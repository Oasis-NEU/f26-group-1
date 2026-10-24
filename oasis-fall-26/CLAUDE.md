CLAUDE.md — NUSublet backend
What this is
NUSublet helps Northeastern students fill empty rooms in an existing lease when roommates leave for co-op or summer. Seekers (students back for co-op, summer classes, internships) find rooms whose dates actually line up. Each building gets a housing info page summarizing what students say about it.
This file covers the backend (Supabase). The frontend is a React SPA that talks to Supabase directly from the browser, so Row Level Security is the backend. There is no app server.
MVP scope — build only this
Profiles (name, year, major, short bio) + optional lifestyle answers.
Listings: neighborhood, total/open rooms, exact dates, rent per room, fill-by date, photos, roommates who are staying, link to a building.
Seeker posts: dates, reason (co-op / summer classes / internship / other), budget, neighborhoods.
Date-first matching: only overlapping dates; rank by date fit > budget > neighborhood

 lifestyle.



Reports: flag a listing as out of date (or other issue).
Building pages: one per building/complex, team-written.
Out of scope for now — do not build, scaffold, or add tables for: pairs/group applications, messaging/chat, applications + accept/decline flow, exact-address reveal, notifications, email, blocking. If a task seems to need one of these, stop and ask.
Stack
Frontend: React + Vite + TypeScript + Tailwind (separate concern; see src/).
Backend: Supabase — Auth, Postgres, Storage, pg_cron. Edge Functions only if something truly needs the service-role key.
Hosting: Vercel (static build).
Client: @supabase/supabase-js, single shared client in src/lib/supabase.ts.
Commands
supabase start                      # local Supabase (Docker)
supabase migration new <name>       # new migration file
supabase db reset                   # rebuild local DB from migrations + seed.sql
supabase test db                    # run pgTAP tests in supabase/tests/
supabase gen types typescript --local > src/types/database.ts
supabase db push                    # apply migrations to the linked remote project
npm run dev                         # frontend

After any schema change: write a migration, supabase db reset, regenerate types, run tests.
Repo layout (backend parts)
supabase/
  migrations/      # every schema/RLS/function change, timestamped, never edited after merge
  seed.sql         # fake users, listings, seekers, buildings for local dev
  tests/           # pgTAP tests, especially RLS
src/lib/supabase.ts
src/types/database.ts   # generated — do not hand-edit

Security rules (non-negotiable)
The browser only ever has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Anything prefixed VITE_ is shipped to every visitor. The service-role key never gets a VITE_ prefix and never appears in src/.
.env*.local is in .gitignore. Never commit keys.
Every table has RLS enabled in the same migration that creates it. A table without policies is a bug.
Default to security invoker for SQL functions so RLS still applies. Use security definer only when necessary, and then set search_path = '', fully qualify names (public.listings), and check auth.uid() yourself.
Don't store exact street addresses, phone numbers, or ID documents in the MVP. Listings show neighborhood + building only.
Validate in the database (check constraints), not just in forms.
Auth
TEMPORARY (Oct 2026): sign-in is Supabase anonymous auth (signInAnonymously) while email delivery is unsolved. Users type their email into profiles.email (unverified, check-constrained to @northeastern.edu). Don't build features that rely on a verified email. When restoring magic links, re-enable the LoginPage OTP flow from git history, turn off anonymous sign-ins, and drop/replace profiles.email.
Target: Email magic link / one-time code. No passwords.
Northeastern only: reject any email that isn't exactly @northeastern.edu (lower(email) like '%@northeastern.edu'). Enforce server-side with a Supabase "before user created" auth hook (or a before insert trigger on auth.users); also check in the sign-in form for a friendly error.
No profile row is created automatically. After first login, the app routes users to an onboarding form that inserts their profiles row (full_name is required).
Data model
Use bigint generated always as identity for ids, uuid for user ids (references auth.users), timestamptz default now() for timestamps, and money as whole dollars per month (integer).
profiles — id uuid pk → auth.users on delete cascade, full_name text not null, year, major, bio (≤500 chars), school text not null default 'Northeastern', created_at.
lifestyle — user_id pk → profiles, sleep, cleanliness, guests, noise (each smallint 1–5), smokes bool, has_pets bool, dealbreakers text[]. Optional for users; matching must work when it's missing.
buildings — name, neighborhood, management_company, walk_minutes_to_campus, rent_range text, laundry text, heat_ac text, amenities text[], summary text, sources jsonb ([{"title","url"}]), updated_at date. Team-maintained through the dashboard; users can't write.
listings — owner_id → profiles, title, neighborhood, building_id → buildings (on delete set null), total_bedrooms (1–10), open_rooms, rent_per_room (>0), utilities_included, furnished, start_date, end_date, fill_by, description (≤2000), status listing_status ('open','filled','closed'), created_at, updated_at. Checks: end_date > start_date, open_rooms between 0 and total_bedrooms, status <> 'open' or open_rooms >= 1. Owners mark listings filled themselves.
listing_photos — listing_id → listings on delete cascade, path, position. Max 8 per listing (enforce with a trigger or check in the insert path).
listing_roommates — listing_id → listings on delete cascade, user_id → profiles (nullable, on delete set null), display_name, note. Roommates may not have accounts; the UI should remind owners to get their OK before listing them.
seeker_posts — user_id → profiles, start_date, end_date, reason seeker_reason ('co_op','summer_classes','internship','other'), budget_max (>0), neighborhoods text[] (empty = anywhere), note (≤1000), status seeker_status ('active','paused','housed'), created_at. Check: end_date > start_date.
reports — listing_id → listings on delete cascade, reporter_id → profiles on delete set null, reason report_reason ('out_of_date','other'), note (≤500), created_at, resolved_at. unique (listing_id, reporter_id) so one person can't spam a listing.
Indexes: listings (status, start_date, end_date), seeker_posts (status, start_date, end_date), reports (listing_id).
RLS policies
All policies are to authenticated (logged-out users see nothing).
Table
Read
Write
profiles, lifestyle
any logged-in user
own row only (auth.uid() = id / user_id)
buildings
any logged-in user
nobody (team uses dashboard)
listings
status = 'open' or owner_id = auth.uid()
owner only
listing_photos, listing_roommates
if the parent listing is readable
owner of parent listing
seeker_posts
status = 'active' or user_id = auth.uid()
own posts only
reports
nobody (team reviews in dashboard)
insert only, reporter_id = auth.uid(), can't report own listing

Child-table policies check the parent with exists (select 1 from public.listings l where l.id = listing_id ...). Always include with check on write policies, not just using.
Test RLS for every table in supabase/tests/ with at least two fake users: user B can't edit A's listing, can't see A's closed listing, can't read reports, can't upload into A's photo folder.
Storage
Bucket listing-photos, private. Path: {owner_id}/{listing_id}/{uuid}.webp.
Read: authenticated. Write/delete: only when (storage.foldername(name))[1] = auth.uid()::text.
Frontend displays photos with signed URLs.
Compress in the browser before upload: ~1600px long side, WebP ~0.8.
Matching
Score 0–100. Date fit dominates.
Factor
Weight
Rule
Date overlap
50
overlap days ÷ days the seeker needs. Under 70% → not shown.
Budget
25
full if rent ≤ budget; linear down to 0 at 15% over; 0 beyond
Neighborhood
10
full if listing neighborhood is in seeker's list, or list empty
Lifestyle
15
placeholder 0.5 (7.5 pts) until implemented; dealbreakers will remove the match

Hard filters: listing status = 'open', open_rooms >= 1, not the seeker's own listing.
create or replace function public.match_listings_for_seeker(p_seeker_post bigint)
returns table (listing_id bigint, score int)
language sql stable security invoker
set search_path = ''
as $$
  with s as (
    select * from public.seeker_posts
    where id = p_seeker_post and user_id = auth.uid()
  ),
  c as (
    select l.id, l.rent_per_room, l.neighborhood, s.budget_max, s.neighborhoods,
      greatest(0, least(l.end_date, s.end_date) - greatest(l.start_date, s.start_date))::numeric
        / nullif(s.end_date - s.start_date, 0) as overlap
    from public.listings l cross join s
    where l.status = 'open' and l.open_rooms >= 1 and l.owner_id <> s.user_id
  )
  select id,
    round(
        50 * least(overlap, 1)
      + 25 * case when rent_per_room <= budget_max then 1
                  when rent_per_room <= budget_max * 1.15
                    then 1 - (rent_per_room - budget_max)::numeric / (budget_max * 0.15)
                  else 0 end
      + 10 * case when cardinality(neighborhoods) = 0
                    or neighborhood = any(neighborhoods) then 1 else 0 end
      + 15 * 0.5  -- lifestyle placeholder
    )::int
  from c
  where overlap >= 0.7
  order by 2 desc
  limit 50;
$$;

Also write the mirror, match_seekers_for_listing(p_listing bigint), which only works when auth.uid() owns the listing and uses the same scoring. Keep both functions' scoring in sync; if you change weights, change both and update this table. Tune weights against seed.sql data, not real users.
Scheduled job (pg_cron)
Daily at 08:00:
listings → closed when status = 'open' and end_date < current_date, or fill_by < current_date - 7.
seeker_posts → paused when status = 'active' and start_date < current_date - 14.
Building pages content rules
Summaries are written in the team's own words. Never paste Reddit comments or review text into summary; link originals in sources.
Start with the 15–20 most-mentioned buildings; seed them in seed.sql for local dev.
Open decisions (ask before assuming)
Contact: with no messaging, how does a seeker reach a lister? (e.g. show the owner's Northeastern email to logged-in users, or an owner-chosen contact field on the listing.)
Whether building pages should be visible before login.
Whether a listing with several unresolved out-of-date reports should be auto-hidden.
Working style for Claude
Small, focused migrations; one concern per file; descriptive names (20261021_create_listings.sql).
Never edit a migration that has been pushed; write a new one.
When adding a table, add its RLS policies and a pgTAP test in the same change.
Prefer constraints and SQL functions over client-side logic for anything that must be true.
If a request touches out-of-scope features, say so instead of building it.



