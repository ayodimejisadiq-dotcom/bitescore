-- The detail page needs lng/lat (for the "Get directions" button), but those
-- only exist inside the `geo` geography column — not selectable directly via
-- PostgREST the way the map/near-me RPCs already extract them. Mirrors the
-- same st_x/st_y pattern as restaurants_in_bounds / restaurants_near.
create or replace function public.restaurant_detail(p_id uuid)
returns table (
  id uuid,
  fhrs_id bigint,
  name text,
  business_type text,
  business_type_id integer,
  address text,
  postcode text,
  local_authority text,
  rating_value text,
  rating_is_numeric boolean,
  rating_date date,
  hours_cache jsonb,
  hours_fetched_at timestamptz,
  google_rating numeric,
  google_rating_count integer,
  lng double precision,
  lat double precision
)
language sql stable
as $$
  select r.id, r.fhrs_id, r.name, r.business_type, r.business_type_id,
         r.address, r.postcode, r.local_authority,
         r.rating_value, r.rating_is_numeric, r.rating_date,
         r.hours_cache, r.hours_fetched_at, r.google_rating, r.google_rating_count,
         st_x(r.geo::geometry) as lng, st_y(r.geo::geometry) as lat
  from public.restaurants r
  where r.id = p_id;
$$;
