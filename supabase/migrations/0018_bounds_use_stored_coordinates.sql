-- Point the pin query at the stored coordinates from 0016.
--
-- It no longer recomputes st_x/st_y for every returned row, and the plain btree
-- on (geo_lng, geo_lat) now serves the viewport filter in place of the
-- geography && operator. Signature and result columns are unchanged, so the
-- client needs no update.
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
language sql
stable
as $$
  select r.id, r.name, r.business_type, r.rating_value, r.rating_is_numeric,
         r.geo_lng, r.geo_lat
  from public.restaurants r
  where r.geo_lng is not null
    and r.geo_lng between min_lng and max_lng
    and r.geo_lat between min_lat and max_lat
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
  limit max_rows;
$$;
