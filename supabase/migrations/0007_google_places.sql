-- Cached Google Places enrichment: rating + opening hours, fetched lazily by
-- the server (never by the client — the API key must stay server-only) the
-- first time a user opens a restaurant's detail page, refreshed after 30 days
-- per Google's caching terms.

alter table public.restaurants
  add column if not exists google_place_id text,
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_rating_count integer,
  add column if not exists google_data_fetched_at timestamptz;
