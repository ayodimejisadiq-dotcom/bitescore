-- Replaces the "minimum rating" threshold (and the short-lived only_awaiting
-- flag from migration 0013) with a plain exact-match, multi-select filter:
-- rating_values is a set of exact rating_value strings to show (e.g.
-- ARRAY['0','5'] shows 0s and 5s only, ARRAY['AwaitingInspection'] shows only
-- places never inspected, null shows everything). Simpler than the old
-- threshold logic and matches how the dropdown UI now works (every rating is
-- its own independent toggle instead of a single cumulative minimum).
--
-- Drops every historical signature so this applies cleanly no matter which
-- prior migrations were actually run against this database.
drop function if exists public.restaurants_in_bounds(
  double precision, double precision, double precision, double precision, int, text[], int
);
drop function if exists public.restaurants_in_bounds(
  double precision, double precision, double precision, double precision, int, text[], int, boolean
);
drop function if exists public.restaurants_near(
  double precision, double precision, double precision, int, text[], int
);
drop function if exists public.restaurants_near(
  double precision, double precision, double precision, int, text[], int, boolean
);

create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  types text[] default null,
  max_rows int default 500,
  rating_values text[] default null
)
returns table (
  id uuid,
  name text,
  business_type text,
  rating_value text,
  rating_is_numeric boolean,
  lng double precision,
  lat double precision
)
language sql stable
as $$
  select r.id, r.name, r.business_type, r.rating_value, r.rating_is_numeric,
         st_x(r.geo::geometry) as lng,
         st_y(r.geo::geometry) as lat
  from public.restaurants r
  where r.geo is not null
    and r.geo && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
  limit max_rows;
$$;

create or replace function public.restaurants_near(
  origin_lng double precision,
  origin_lat double precision,
  radius_m double precision default 2000,
  types text[] default null,
  max_rows int default 100,
  rating_values text[] default null
)
returns table (
  id uuid,
  name text,
  business_type text,
  address text,
  postcode text,
  rating_value text,
  rating_is_numeric boolean,
  rating_date date,
  distance_m double precision
)
language sql stable
as $$
  select r.id, r.name, r.business_type, r.address, r.postcode,
         r.rating_value, r.rating_is_numeric, r.rating_date,
         st_distance(r.geo, st_point(origin_lng, origin_lat)::geography) as distance_m
  from public.restaurants r
  where r.geo is not null
    and st_dwithin(r.geo, st_point(origin_lng, origin_lat)::geography, radius_m)
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
  order by r.geo <-> st_point(origin_lng, origin_lat)::geography
  limit max_rows;
$$;
