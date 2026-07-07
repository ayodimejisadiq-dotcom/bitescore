-- Bitescore RPCs: geospatial queries + score-change tracking for notifications.

-- ---------------------------------------------------------------------------
-- Score change events
-- The ingestion job writes one row here whenever a restaurant's rating changes.
-- The notification dispatcher reads unsent rows, pushes to listers, marks sent.
-- ---------------------------------------------------------------------------
create table if not exists public.score_changes (
  id             uuid primary key default uuid_generate_v4(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  old_rating     text,
  new_rating     text,
  changed_at     timestamptz not null default now(),
  notified_at    timestamptz
);

create index if not exists score_changes_unnotified_idx
  on public.score_changes (changed_at) where notified_at is null;

alter table public.score_changes enable row level security;
-- No client access; service role only (no policies).

-- ---------------------------------------------------------------------------
-- restaurants_in_bounds: pins for a map viewport.
-- Returns lightweight rows; caps result count to keep payloads sane.
-- ---------------------------------------------------------------------------
create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  min_rating int default null,          -- filter: numeric rating >= this
  types text[] default null,            -- filter: business_type in this set
  max_rows int default 500
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
  limit max_rows;
$$;

-- ---------------------------------------------------------------------------
-- restaurants_near: "near me" list sorted by distance.
-- ---------------------------------------------------------------------------
create or replace function public.restaurants_near(
  origin_lng double precision,
  origin_lat double precision,
  radius_m double precision default 2000,
  min_rating int default null,
  types text[] default null,
  max_rows int default 100
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
  order by r.geo <-> st_point(origin_lng, origin_lat)::geography
  limit max_rows;
$$;

-- ---------------------------------------------------------------------------
-- delete_my_account: GDPR + Apple in-app account deletion.
-- Runs as the caller; cascades remove all user-owned rows via FKs.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Deleting the auth user cascades to profiles, lists, reviews, etc.
  delete from auth.users where id = auth.uid();
end;
$$;
