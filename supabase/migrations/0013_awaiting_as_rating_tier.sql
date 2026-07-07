-- Replaces the "hide awaiting inspection" boolean (migration 0012) with an
-- "Awaiting" tier inside the same rating dropdown, mutually exclusive with a
-- numeric minimum — selecting it shows ONLY places registered but never
-- inspected, the same one-tap behavior as picking "5+ rated" etc. A numeric
-- minimum already excludes non-numeric statuses (rating_is_numeric check
-- below), and "Any rating" already includes everything, so neither of those
-- needed to change — only this new tier is genuinely new.
--
-- Parameter removal isn't possible via create-or-replace, so drop first.
drop function if exists public.restaurants_in_bounds(
  double precision, double precision, double precision, double precision,
  int, text[], int, boolean
);
drop function if exists public.restaurants_near(
  double precision, double precision, double precision, int, text[], int, boolean
);

create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  min_rating int default null,
  types text[] default null,
  max_rows int default 500,
  only_awaiting boolean default false
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
    and (
      (only_awaiting and r.rating_value = 'AwaitingInspection')
      or (not only_awaiting and (min_rating is null or (r.rating_is_numeric and r.rating_value::int >= min_rating)))
    )
  limit max_rows;
$$;

create or replace function public.restaurants_near(
  origin_lng double precision,
  origin_lat double precision,
  radius_m double precision default 2000,
  min_rating int default null,
  types text[] default null,
  max_rows int default 100,
  only_awaiting boolean default false
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
    and (
      (only_awaiting and r.rating_value = 'AwaitingInspection')
      or (not only_awaiting and (min_rating is null or (r.rating_is_numeric and r.rating_value::int >= min_rating)))
    )
  order by r.geo <-> st_point(origin_lng, origin_lat)::geography
  limit max_rows;
$$;
