-- Hosted projects don't auto-grant table privileges to the API roles, so RLS
-- policies never get a chance to run ("permission denied for table ...").
-- Grant only what each table's policies allow, and only to authenticated:
-- logged-out users (anon) see nothing.
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.lifestyle,
  public.listings,
  public.listing_photos,
  public.listing_roommates,
  public.seeker_posts
to authenticated;

-- Team-maintained through the dashboard.
grant select on public.buildings to authenticated;

-- Users can file reports but never read them.
grant insert on public.reports to authenticated;
