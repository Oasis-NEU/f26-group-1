-- Date-first matching. Score 0-100:
--   date overlap 50 (overlap days / days the seeker needs; under 70% -> not shown)
--   budget       25 (full if rent <= budget, linear to 0 at 15% over)
--   neighborhood 10 (listing neighborhood in seeker's list, or list empty)
--   lifestyle    15 (placeholder 0.5 until implemented)
-- Both match functions call this, so their scoring can't drift apart.
-- Returns null when the match should not be shown.
create function public.match_score(
  listing_start date,
  listing_end date,
  rent_per_room integer,
  listing_neighborhood text,
  seeker_start date,
  seeker_end date,
  budget_max integer,
  seeker_neighborhoods text[]
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when o.overlap >= 0.7 then round(
      50 * least(o.overlap, 1)
    + 25 * case
             when rent_per_room <= budget_max then 1
             when rent_per_room <= budget_max * 1.15
               then 1 - (rent_per_room - budget_max)::numeric / (budget_max * 0.15)
             else 0
           end
    + 10 * case
             when cardinality(seeker_neighborhoods) = 0
               or listing_neighborhood = any (seeker_neighborhoods) then 1
             else 0
           end
    + 15 * 0.5  -- lifestyle placeholder
  )::integer end
  from (
    select greatest(0, least(listing_end, seeker_end) - greatest(listing_start, seeker_start))::numeric
             / nullif(seeker_end - seeker_start, 0) as overlap
  ) o;
$$;

-- Listings for one of the caller's own seeker posts.
-- Hard filters: listing open, at least one open room, not the seeker's own listing.
create function public.match_listings_for_seeker(p_seeker_post bigint)
returns table (listing_id bigint, score integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.score
  from (
    select l.id,
      public.match_score(
        l.start_date, l.end_date, l.rent_per_room, l.neighborhood,
        s.start_date, s.end_date, s.budget_max, s.neighborhoods
      ) as score
    from public.seeker_posts s
    join public.listings l
      on l.status = 'open' and l.open_rooms >= 1 and l.owner_id <> s.user_id
    where s.id = p_seeker_post and s.user_id = (select auth.uid())
  ) m
  where m.score is not null
  order by m.score desc, m.id
  limit 50;
$$;

-- Mirror: active seeker posts for one of the caller's own open listings.
create function public.match_seekers_for_listing(p_listing bigint)
returns table (seeker_post_id bigint, score integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.score
  from (
    select s.id,
      public.match_score(
        l.start_date, l.end_date, l.rent_per_room, l.neighborhood,
        s.start_date, s.end_date, s.budget_max, s.neighborhoods
      ) as score
    from public.listings l
    join public.seeker_posts s
      on s.status = 'active' and s.user_id <> l.owner_id
    where l.id = p_listing
      and l.owner_id = (select auth.uid())
      and l.status = 'open'
      and l.open_rooms >= 1
  ) m
  where m.score is not null
  order by m.score desc, m.id
  limit 50;
$$;

revoke execute on function public.match_listings_for_seeker(bigint) from public, anon;
revoke execute on function public.match_seekers_for_listing(bigint) from public, anon;
grant execute on function public.match_listings_for_seeker(bigint) to authenticated;
grant execute on function public.match_seekers_for_listing(bigint) to authenticated;
