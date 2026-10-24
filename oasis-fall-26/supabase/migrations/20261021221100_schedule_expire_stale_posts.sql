create extension if not exists pg_cron;

-- Closes listings whose dates have passed (or that are a week past fill-by),
-- and pauses seeker posts whose start date is two weeks gone.
create function public.expire_stale_posts()
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.listings
  set status = 'closed'
  where status = 'open'
    and (end_date < current_date or fill_by < current_date - 7);

  update public.seeker_posts
  set status = 'paused'
  where status = 'active'
    and start_date < current_date - 14;
$$;

revoke execute on function public.expire_stale_posts() from public, anon, authenticated;

-- pg_cron runs in UTC, so this is 08:00 UTC (3-4am in Boston).
select cron.schedule('expire-stale-posts', '0 8 * * *', 'select public.expire_stale_posts()');
