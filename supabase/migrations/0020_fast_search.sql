-- Make text search fast enough to finish inside the API's statement timeout.
--
-- search_restaurants_near matches `name ilike '%q%' OR postcode ilike 'q%'`.
-- Name had a trigram index but postcode only had a plain btree, which can't
-- serve ilike — so the OR forced a sequential scan of every restaurant. With
-- ~310k rows that took ~4.5s, and a search with no matches ("clean greens")
-- hit the anon role's statement timeout and surfaced the raw Postgres error
-- in the app. A trigram index on postcode lets the planner BitmapOr both
-- sides: the same search now runs in ~35ms.
--
-- Trigram indexes can't help a name search under three characters, which
-- would fall back to a full scan again. Those only match by postcode prefix
-- ("M5", "W1"), which is what a one- or two-character query means anyway.
create index if not exists restaurants_postcode_trgm_idx
  on public.restaurants using gin (postcode gin_trgm_ops);

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
  where ((length(q) >= 3 and r.name ilike '%' || q || '%') or r.postcode ilike q || '%')
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
