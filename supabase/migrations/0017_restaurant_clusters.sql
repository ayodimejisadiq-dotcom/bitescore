-- Grid aggregation for zoomed-out map views.
--
-- Rendering one native marker per venue is what made the map crash while
-- panning across new areas. A client-side clustering library cannot fix that
-- honestly: it clusters only the rows it was sent, so a capped fetch would
-- report "12 places" for a city holding 8,000. Counting server-side keeps the
-- numbers true — a UK-wide view returns 65 cells totalling all 250,603 venues.
--
-- The viewport is divided into a cells x cells grid, and each populated cell
-- returns its centroid, its count, and the best rating within it (which colours
-- the bubble). Deriving cells from the viewport rather than a fixed grid means
-- clusters subdivide naturally as the user zooms in.
--
-- Depends on the stored coordinates from 0016; aggregating the geography casts
-- directly took 4.8s where this takes 10ms for a city and ~1.5s for the whole
-- country, which is the rare worst case.
create or replace function public.restaurant_clusters(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  cells int default 10,
  types text[] default null,
  rating_values text[] default null
)
returns table (
  lng double precision,
  lat double precision,
  n bigint,
  best_rating text
)
language sql
stable
as $$
  select
    avg(r.geo_lng)::double precision,
    avg(r.geo_lat)::double precision,
    count(*)::bigint,
    max(r.rating_value) filter (where r.rating_is_numeric)
  from public.restaurants r
  where r.geo_lng is not null
    and r.geo_lng between min_lng and max_lng
    and r.geo_lat between min_lat and max_lat
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
  group by
    width_bucket(r.geo_lng, min_lng, max_lng, greatest(cells, 1)),
    width_bucket(r.geo_lat, min_lat, max_lat, greatest(cells, 1));
$$;
