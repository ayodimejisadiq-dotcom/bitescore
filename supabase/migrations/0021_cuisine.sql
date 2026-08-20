-- Cuisine v1: a name-keyword heuristic, same idea as migration 0006's
-- Restaurant/Cafe split — FSA has no cuisine field at all. Kept in sync with
-- the identical pattern list in server/lib/fsa.ts and mobile/lib/fsa.ts
-- (classifyCuisine). Postgres regex uses \y for a word boundary, not \b
-- (which means backspace in this engine) — the one place this list can't be
-- copy-pasted verbatim from the TS versions.
--
-- Going forward, ingest_upsert stores whatever server/lib/fsa.ts computed
-- per row; this migration's UPDATE only backfills rows that already existed
-- before this column did.

alter table public.restaurants add column if not exists cuisine text;

update public.restaurants set cuisine = case
  when name ~* '\ythai\y' then 'thai'
  when name ~* '\ychinese\y' then 'chinese'
  when name ~* '\yindian\y|\ytandoori\y|\ybalti\y' then 'indian'
  when name ~* '\yitalian\y|\ytrattoria\y' then 'italian'
  when name ~* '\ypizzas?\y|\ypizzeria\y' then 'pizza'
  when name ~* '\yburgers?\y' then 'burger'
  when name ~* '\ysushi\y|\yjapanese\y|\yramen\y' then 'japanese'
  when name ~* '\ymexican\y|\ytaqueria\y|\yburritos?\y' then 'mexican'
  when name ~* '\yturkish\y|\ykebabs?\y' then 'turkish'
  when name ~* '\yfish\s*(&|and)\s*chips?\y|\ychippy\y' then 'fish_and_chips'
  when name ~* '\ygreek\y|\ytaverna\y' then 'greek'
  when name ~* '\ycaribbean\y|\yjerk\y' then 'caribbean'
  else null
end
where cuisine is null;

-- ---------------------------------------------------------------------------
-- ingest_upsert: store the cuisine the ingestion job already computed
-- ---------------------------------------------------------------------------
create or replace function public.ingest_upsert(rows jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r      jsonb;
  v_fhrs bigint;
  v_old  text;
  v_new  text;
  v_lng  double precision;
  v_lat  double precision;
  n      int := 0;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    v_fhrs := (r->>'fhrs_id')::bigint;
    v_new  := coalesce(r->>'rating_value', '');
    v_lng  := nullif(r->>'lng', '')::double precision;
    v_lat  := nullif(r->>'lat', '')::double precision;

    select rating_value into v_old
    from public.restaurants where fhrs_id = v_fhrs;

    insert into public.restaurants (
      fhrs_id, name, business_type, business_type_id, address, postcode,
      local_authority, geo, rating_value, rating_is_numeric, rating_date,
      cuisine, last_synced_at
    ) values (
      v_fhrs,
      r->>'name',
      r->>'business_type',
      nullif(r->>'business_type_id', '')::int,
      r->>'address',
      r->>'postcode',
      r->>'local_authority',
      case when v_lng is not null and v_lat is not null
           then st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography
           else null end,
      v_new,
      v_new ~ '^[0-5]$',
      nullif(r->>'rating_date', '')::date,
      r->>'cuisine',
      now()
    )
    on conflict (fhrs_id) do update set
      name             = excluded.name,
      business_type    = excluded.business_type,
      business_type_id = excluded.business_type_id,
      address          = excluded.address,
      postcode         = excluded.postcode,
      local_authority  = excluded.local_authority,
      geo              = excluded.geo,
      rating_value     = excluded.rating_value,
      rating_is_numeric= excluded.rating_is_numeric,
      rating_date      = excluded.rating_date,
      cuisine          = excluded.cuisine,
      last_synced_at   = now();

    -- Only log a change for establishments we already knew about.
    if v_old is not null and v_old is distinct from v_new then
      insert into public.score_changes (restaurant_id, old_rating, new_rating)
      select id, v_old, v_new from public.restaurants where fhrs_id = v_fhrs;
    end if;

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Query RPCs: add a `cuisines` exact-match filter (same shape as the
-- existing `types`/`rating_values` filters), and return `cuisine` from the
-- row-returning ones so the client can show/label it.
-- ---------------------------------------------------------------------------

-- restaurants_in_bounds / restaurant_clusters: filter param only, no output
-- column — map pins and cluster bubbles don't display cuisine.
create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  types text[] default null,
  max_rows int default 500,
  rating_values text[] default null,
  cuisines text[] default null
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
    and (cuisines is null or r.cuisine = any(cuisines))
  limit max_rows;
$$;

create or replace function public.restaurant_clusters(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  cells int default 10,
  types text[] default null,
  rating_values text[] default null,
  cuisines text[] default null
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
    and (cuisines is null or r.cuisine = any(cuisines))
  group by
    width_bucket(r.geo_lng, min_lng, max_lng, greatest(cells, 1)),
    width_bucket(r.geo_lat, min_lat, max_lat, greatest(cells, 1));
$$;

-- restaurant_detail / restaurants_near / search_restaurants_near: their
-- return shape is changing (new `cuisine` output column), which
-- CREATE OR REPLACE can't do — drop the exact prior signatures first.
drop function if exists public.restaurant_detail(uuid);
drop function if exists public.restaurants_near(
  double precision, double precision, double precision, text[], int, text[]
);
drop function if exists public.search_restaurants_near(
  text, double precision, double precision, text[], text[], int
);

create function public.restaurant_detail(p_id uuid)
returns table (
  id uuid,
  fhrs_id bigint,
  name text,
  business_type text,
  business_type_id integer,
  cuisine text,
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
  select r.id, r.fhrs_id, r.name, r.business_type, r.business_type_id, r.cuisine,
         r.address, r.postcode, r.local_authority,
         r.rating_value, r.rating_is_numeric, r.rating_date,
         r.hours_cache, r.hours_fetched_at, r.google_rating, r.google_rating_count,
         st_x(r.geo::geometry) as lng, st_y(r.geo::geometry) as lat
  from public.restaurants r
  where r.id = p_id;
$$;

create function public.restaurants_near(
  origin_lng double precision,
  origin_lat double precision,
  radius_m double precision default 2000,
  types text[] default null,
  max_rows int default 100,
  rating_values text[] default null,
  cuisines text[] default null
)
returns table (
  id uuid,
  name text,
  business_type text,
  cuisine text,
  address text,
  postcode text,
  rating_value text,
  rating_is_numeric boolean,
  rating_date date,
  distance_m double precision
)
language sql stable
as $$
  select r.id, r.name, r.business_type, r.cuisine, r.address, r.postcode,
         r.rating_value, r.rating_is_numeric, r.rating_date,
         st_distance(r.geo, st_point(origin_lng, origin_lat)::geography) as distance_m
  from public.restaurants r
  where r.geo is not null
    and st_dwithin(r.geo, st_point(origin_lng, origin_lat)::geography, radius_m)
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
    and (cuisines is null or r.cuisine = any(cuisines))
  order by r.geo <-> st_point(origin_lng, origin_lat)::geography
  limit max_rows;
$$;

create function public.search_restaurants_near(
  q text,
  origin_lng double precision default null,
  origin_lat double precision default null,
  types text[] default null,
  rating_values text[] default null,
  max_rows int default 50,
  cuisines text[] default null
)
returns table (
  id uuid,
  name text,
  business_type text,
  cuisine text,
  address text,
  postcode text,
  rating_value text,
  rating_is_numeric boolean,
  rating_date date,
  distance_m double precision
)
language sql stable
as $$
  select r.id, r.name, r.business_type, r.cuisine, r.address, r.postcode,
         r.rating_value, r.rating_is_numeric, r.rating_date,
         case
           when origin_lng is null or origin_lat is null or r.geo is null then null
           else st_distance(r.geo, st_point(origin_lng, origin_lat)::geography)
         end as distance_m
  from public.restaurants r
  where (r.name ilike '%' || q || '%' or r.postcode ilike q || '%')
    and (types is null or r.business_type = any(types))
    and (rating_values is null or r.rating_value = any(rating_values))
    and (cuisines is null or r.cuisine = any(cuisines))
  order by
    case
      when origin_lng is null or origin_lat is null or r.geo is null then null
      else r.geo <-> st_point(origin_lng, origin_lat)::geography
    end asc nulls last,
    r.name asc
  limit max_rows;
$$;
