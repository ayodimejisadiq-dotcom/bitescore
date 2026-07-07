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
