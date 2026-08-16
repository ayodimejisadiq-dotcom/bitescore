-- Text search that answers "which of these is nearest", not "which of these
-- did the planner happen to return first".
--
-- The client previously filtered `restaurants` directly with an ilike and no
-- ordering at all, so searching a chain — "Nando's", "Greggs" — returned rows
-- in whatever order Postgres produced them. On a national dataset that is
-- effectively random, and the branch you are standing outside could sit
-- anywhere in the list.
--
-- Origin is nullable: with location denied there is no distance to sort by, so
-- results fall back to alphabetical rather than failing. Rows with no
-- coordinates sort last for the same reason — they are still valid matches,
-- they just cannot claim to be near you.
create or replace function public.search_restaurants_near(
  q text,
  origin_lng double precision default null,
  origin_lat double precision default null,
  types text[] default null,
  rating_values text[] default null,
  max_rows int default 50
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
         case
           when origin_lng is null or origin_lat is null or r.geo is null then null
           else st_distance(r.geo, st_point(origin_lng, origin_lat)::geography)
         end as distance_m
  from public.restaurants r
  -- Name and postcode are matched together rather than switching on whether
  -- the query "looks like" a postcode: "W1J" and "Park Chinois" both work, and
  -- a name containing a digit ("Cafe 22") no longer falls into postcode mode.
  where (r.name ilike '%' || q || '%' or r.postcode ilike q || '%')
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
  order by
    case
      when origin_lng is null or origin_lat is null or r.geo is null then null
      else r.geo <-> st_point(origin_lng, origin_lat)::geography
    end asc nulls last,
    r.name asc
  limit max_rows;
$$;
