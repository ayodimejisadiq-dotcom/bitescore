-- Bitescore full schema — convenience file for pasting into the Supabase SQL Editor.
-- Source of truth is the numbered files in supabase/migrations/. This is their
-- concatenation so you can apply everything in one run. Safe to re-run (idempotent).

-- ============================================================================
-- supabase/migrations/0001_init.sql
-- ============================================================================
-- Bitescore initial schema
-- Postgres + PostGIS. All user-owned tables are protected by RLS.
--
-- Conventions:
--   * auth.uid() is the Supabase-authenticated user id.
--   * `restaurants` is public read (FSA open data); everything else is scoped
--     to the owning user.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists postgis;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;   -- trigram search on names

-- ---------------------------------------------------------------------------
-- Restaurants (FSA FHRS establishments, dining venues only)
-- Populated by the nightly ingestion job. No RLS write access from clients.
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id                uuid primary key default uuid_generate_v4(),
  fhrs_id           bigint not null unique,           -- FSA FHRSID
  name              text not null,
  business_type     text not null,                    -- FSA BusinessType
  business_type_id  integer,                          -- FSA BusinessTypeID
  address           text,                             -- composed AddressLine1..4
  postcode          text,
  local_authority   text,                             -- LocalAuthorityName
  geo               geography(Point, 4326),           -- lng/lat, nullable if FSA has no coords
  rating_value      text not null,                    -- '0'..'5' | 'Exempt' | 'AwaitingInspection' | 'AwaitingPublication'
  rating_is_numeric boolean not null default false,   -- convenience flag for filtering
  rating_date       date,                             -- RatingDate
  hours_cache       jsonb,                            -- Google Places opening hours, cached
  hours_fetched_at  timestamptz,
  last_synced_at    timestamptz not null default now()
);

create index if not exists restaurants_geo_idx on public.restaurants using gist (geo);
create index if not exists restaurants_postcode_idx on public.restaurants (postcode);
create index if not exists restaurants_name_trgm_idx on public.restaurants using gin (name gin_trgm_ops);
create index if not exists restaurants_rating_idx on public.restaurants (rating_value);

alter table public.restaurants enable row level security;

-- Public read access (data is open government data).
drop policy if exists restaurants_read on public.restaurants;
create policy restaurants_read on public.restaurants
  for select using (true);
-- No insert/update/delete policies => clients cannot write. The ingestion job
-- uses the service-role key which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists profiles_upsert_own on public.profiles;
create policy profiles_upsert_own on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null))
  on conflict (user_id) do nothing;
  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Lists + list items
-- ---------------------------------------------------------------------------
create table if not exists public.lists (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lists_user_idx on public.lists (user_id);

alter table public.lists enable row level security;

drop policy if exists lists_owner_all on public.lists;
create policy lists_owner_all on public.lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.list_items (
  list_id       uuid not null references public.lists(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (list_id, restaurant_id)
);

create index if not exists list_items_restaurant_idx on public.list_items (restaurant_id);

alter table public.list_items enable row level security;

-- Access to list_items is gated on ownership of the parent list.
drop policy if exists list_items_owner_all on public.list_items;
create policy list_items_owner_all on public.list_items
  for all using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- User blocks (defined before reviews: the reviews read policy references it)
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id  uuid not null references auth.users(id) on delete cascade,
  blocked_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists user_blocks_owner_all on public.user_blocks;
create policy user_blocks_owner_all on public.user_blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Reviews (text-only, account-backed, optionally displayed anonymously)
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id                   uuid primary key default uuid_generate_v4(),
  restaurant_id        uuid not null references public.restaurants(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  display_name_snapshot text,                          -- captured at post time (null if anonymous)
  is_anonymous         boolean not null default false,
  body                 text not null check (char_length(body) between 1 and 2000),
  status               text not null default 'visible' check (status in ('visible','hidden')),
  created_at           timestamptz not null default now()
);

create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id);

alter table public.reviews enable row level security;

-- Anyone (even logged out) can read visible reviews, EXCEPT reviews authored by
-- someone the current user has blocked.
drop policy if exists reviews_read_visible on public.reviews;
create policy reviews_read_visible on public.reviews
  for select using (
    status = 'visible'
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = reviews.user_id
    )
  );

-- Authors can always read their own reviews (even if hidden).
drop policy if exists reviews_read_own on public.reviews;
create policy reviews_read_own on public.reviews
  for select using (auth.uid() = user_id);

drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
  for insert with check (auth.uid() = user_id);

-- Authors can edit/delete their own reviews.
drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Review reports (for moderation)
-- ---------------------------------------------------------------------------
create table if not exists public.review_reports (
  id           uuid primary key default uuid_generate_v4(),
  review_id    uuid not null references public.reviews(id) on delete cascade,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reason       text,
  created_at   timestamptz not null default now(),
  unique (review_id, reporter_id)                     -- one report per user per review
);

create index if not exists review_reports_review_idx on public.review_reports (review_id);

alter table public.review_reports enable row level security;

drop policy if exists review_reports_insert_own on public.review_reports;
create policy review_reports_insert_own on public.review_reports
  for insert with check (auth.uid() = reporter_id);

-- Reporters can see their own reports (read-back after submit).
drop policy if exists review_reports_read_own on public.review_reports;
create policy review_reports_read_own on public.review_reports
  for select using (auth.uid() = reporter_id);

-- Auto-hide a review once it accumulates N distinct reports (Apple 1.2:
-- act on objectionable content quickly). N is intentionally low for launch.
create or replace function public.auto_hide_reported_review()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  report_count int;
  threshold constant int := 3;
begin
  select count(*) into report_count
  from public.review_reports where review_id = new.review_id;

  if report_count >= threshold then
    update public.reviews set status = 'hidden' where id = new.review_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_review_reported on public.review_reports;
create trigger on_review_reported
  after insert on public.review_reports
  for each row execute function public.auto_hide_reported_review();

-- ---------------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  user_id     uuid not null references auth.users(id) on delete cascade,
  expo_token  text not null,
  platform    text check (platform in ('ios','android')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, expo_token)
);

alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_owner_all on public.push_tokens;
create policy push_tokens_owner_all on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------
create table if not exists public.notification_prefs (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  score_change_enabled boolean not null default true,
  updated_at           timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists notification_prefs_owner_all on public.notification_prefs;
create policy notification_prefs_owner_all on public.notification_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Entitlements (synced from RevenueCat webhooks by the server)
-- Clients may read their own entitlement; only the service role writes.
-- ---------------------------------------------------------------------------
create table if not exists public.entitlements (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  product     text check (product in ('annual','lifetime')),
  status      text not null default 'inactive' check (status in ('active','inactive','expired','grace')),
  source      text not null default 'revenuecat',
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.entitlements enable row level security;

drop policy if exists entitlements_read_own on public.entitlements;
create policy entitlements_read_own on public.entitlements
  for select using (auth.uid() = user_id);
-- No client write policies; service role only.

-- ============================================================================
-- supabase/migrations/0002_functions.sql
-- ============================================================================
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

-- ============================================================================
-- supabase/migrations/0003_ingest_state.sql
-- ============================================================================
-- Tracks the nightly FSA ingestion so a run can be spread across several
-- serverless invocations (Vercel function time limits) and resume cleanly.

create table if not exists public.ingest_state (
  id                 int primary key default 1 check (id = 1),  -- singleton row
  cursor             int not null default 0,                    -- next authority index to process
  authority_count    int not null default 0,
  pass_started_at    timestamptz,
  last_run_at        timestamptz,
  last_completed_at  timestamptz,                               -- when a full pass last finished
  establishments_seen int not null default 0
);

insert into public.ingest_state (id) values (1)
  on conflict (id) do nothing;

alter table public.ingest_state enable row level security;
-- No policies: service role only.

-- ============================================================================
-- supabase/migrations/0004_ingest_upsert.sql
-- ============================================================================
-- Bulk upsert used by the FSA ingestion job. Takes a JSON array of rows,
-- builds the PostGIS geography from lng/lat, and records a score_changes row
-- whenever an existing establishment's rating actually changed (drives
-- notifications). Service role only.

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
      local_authority, geo, rating_value, rating_is_numeric, rating_date, last_synced_at
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

-- ============================================================================
-- supabase/migrations/0005_notify_candidates.sql
-- ============================================================================
-- Finds who to push-notify when a restaurant's score changes: anyone with it
-- on a list, who has score-change alerts on, and has a registered push token.
-- Server-only (service role) — not reachable by anon/authenticated clients.

create or replace function public.notify_candidates(p_restaurant_id uuid)
returns table (user_id uuid, expo_token text)
language sql stable
security definer set search_path = public
as $$
  select distinct pt.user_id, pt.expo_token
  from public.list_items li
  join public.lists l on l.id = li.list_id
  join public.notification_prefs np on np.user_id = l.user_id and np.score_change_enabled = true
  join public.push_tokens pt on pt.user_id = l.user_id
  where li.restaurant_id = p_restaurant_id;
$$;

revoke execute on function public.notify_candidates(uuid) from public, anon, authenticated;

-- ============================================================================
-- supabase/migrations/0006_backfill_restaurant_cafe_split.sql
-- ============================================================================
-- One-time backfill: reclassify already-ingested rows that still carry FSA's
-- combined 'Restaurant/Cafe/Canteen' BusinessType into our own split
-- 'Restaurant' / 'Cafe' values, using the same name-keyword heuristic as
-- server/lib/fsa.ts (normalizedBusinessType) and mobile/lib/fsa.ts
-- (classifyRestaurantOrCafe). Future ingestion runs write the split value
-- directly, so this only needs to run once against existing data.
update public.restaurants
set business_type = case
  when name ~* 'caf[eé]|coffee|tea\s*room|patisserie' then 'Cafe'
  else 'Restaurant'
end
where business_type = 'Restaurant/Cafe/Canteen';

-- ============================================================================
-- supabase/migrations/0007_google_places.sql
-- ============================================================================
-- Cached Google Places enrichment: rating + opening hours, fetched lazily by
-- the server (never by the client — the API key must stay server-only) the
-- first time a user opens a restaurant's detail page, refreshed after 30 days
-- per Google's caching terms.

alter table public.restaurants
  add column if not exists google_place_id text,
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_rating_count integer,
  add column if not exists google_data_fetched_at timestamptz;

-- ============================================================================
-- supabase/migrations/0008_anonymous_profiles.sql
-- ============================================================================
-- Move from "sign in required to do anything" to "anonymous by default, add
-- an email later when ready" (Supabase Anonymous Sign-ins — must also be
-- enabled in the dashboard: Authentication -> Settings -> Allow anonymous
-- sign-ins). Anonymous users get a real, stable auth.uid() immediately, so
-- lists/reviews/RLS all work unchanged; adding an email later upgrades the
-- same user in place rather than creating a new one.
--
-- Profiles gain first/last name (private) plus an auto-generated,
-- inconspicuous public username shown on reviews instead of a real name.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists username text unique;

-- Existing rows (from the old display_name-only model) get a placeholder
-- username immediately so the unique constraint holds.
update public.profiles
set username = 'guest' || floor(random() * 900000 + 100000)::int
where username is null;

alter table public.profiles drop column if exists display_name;

-- Every new profile (anonymous or not) gets a random placeholder username
-- right away; the app overwrites it once the user enters their name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, 'guest' || floor(random() * 900000 + 100000)::int)
  on conflict (user_id) do nothing;
  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ============================================================================
-- supabase/migrations/0009_backfill_bogus_rating_date.sql
-- ============================================================================
-- One-time backfill: FSA sends a meaningless sentinel date (e.g. 1900-01-01)
-- for non-numeric rating statuses like AwaitingInspection instead of leaving
-- it blank. Ingestion now nulls this out at the source (server/lib/fsa.ts),
-- but rows already ingested before that fix still carry the bogus date.
update public.restaurants
set rating_date = null
where not rating_is_numeric
  and rating_date is not null;

-- ============================================================================
-- supabase/migrations/0010_reviews_one_per_user.sql
-- ============================================================================
-- One review per user per restaurant. Writing a new review for a place
-- you've already reviewed edits it in place (upsert on this constraint)
-- instead of creating a second row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_user_restaurant_unique'
  ) then
    alter table public.reviews
      add constraint reviews_user_restaurant_unique unique (user_id, restaurant_id);
  end if;
end $$;

-- ============================================================================
-- supabase/migrations/0011_restaurant_detail_rpc.sql
-- ============================================================================
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
