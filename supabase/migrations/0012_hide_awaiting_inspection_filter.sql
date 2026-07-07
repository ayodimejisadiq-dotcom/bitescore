-- Lets the map/near-me filters exclude places FSA has registered but never
-- inspected yet (AwaitingInspection — no usable score at all), without
-- hiding Exempt or AwaitingPublication (already inspected, rating just not
-- published yet). New param appended at the end so this safely replaces the
-- existing functions rather than creating an ambiguous overload.
create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  min_rating int default null,
  types text[] default null,
  max_rows int default 500,
  hide_awaiting_inspection boolean default false
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
    and (min_rating is null or (r.rating_is_numeric and r.rating_value::int >= min_rating))
    and (types is null or r.business_type = any(types))
    and (not hide_awaiting_inspection or r.rating_value <> 'AwaitingInspection')
  limit max_rows;
$$;

create or replace function public.restaurants_near(
  origin_lng double precision,
  origin_lat double precision,
  radius_m double precision default 2000,
  min_rating int default null,
  types text[] default null,
  max_rows int default 100,
  hide_awaiting_inspection boolean default false
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
    and (min_rating is null or (r.rating_is_numeric and r.rating_value::int >= min_rating))
    and (types is null or r.business_type = any(types))
    and (not hide_awaiting_inspection or r.rating_value <> 'AwaitingInspection')
  order by r.geo <-> st_point(origin_lng, origin_lat)::geography
  limit max_rows;
$$;
