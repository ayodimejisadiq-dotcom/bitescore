-- Onboarding wizard + no free plan.
--
-- 1. What someone likes eating, from the first-launch wizard
--    (mobile/lib/onboarding.ts FOOD_OPTIONS keys, e.g. 'indian', 'pub').
--    Private like the rest of the profile row: profile_cards() never returns it.
alter table public.profiles
  add column if not exists food_likes text[] not null default '{}'
    check (cardinality(food_likes) <= 30);

-- 2. The free plan is gone: Pro (yearly or lifetime) or the paywall. Setting
--    the allowance to 0 also turns it off in builds that still have the free
--    plan code, since they read it from here (0026). free_opens is kept for
--    the stats dashboard's history.
update public.app_config set value = '0' where key = 'free_places_per_month';

-- 3. Onboarding funnel: one row per wizard step a person reaches, plus
--    'paywall' and 'unlocked'. Written by the app (insert-only, own rows);
--    read only through onboarding_funnel() with the service role:
--      select * from public.onboarding_funnel(30);
create table if not exists public.onboarding_events (
  id      bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  step    text not null check (char_length(step) <= 40),
  at      timestamptz not null default now()
);

create index if not exists onboarding_events_at_idx on public.onboarding_events (at);

alter table public.onboarding_events enable row level security;
drop policy if exists onboarding_events_insert_own on public.onboarding_events;
create policy onboarding_events_insert_own on public.onboarding_events
  for insert with check (user_id = auth.uid());

-- People reaching each step in the last p_days, in wizard order.
create or replace function public.onboarding_funnel(p_days int default 30)
returns table (step text, people bigint)
language sql stable security definer
set search_path = public
as $$
  with steps(step, ord) as (
    values ('welcome', 1), ('location', 2), ('location_on', 3), ('notifications', 4),
           ('notifications_on', 5), ('city', 6), ('food', 7), ('name', 8), ('nearby', 9),
           ('paywall', 10), ('unlocked', 11)
  )
  select s.step, count(distinct e.user_id)
  from steps s
  left join public.onboarding_events e
    on e.step = s.step and e.at > now() - make_interval(days => p_days)
  group by s.step, s.ord
  order by s.ord;
$$;

revoke execute on function public.onboarding_funnel(int) from public, anon, authenticated;
grant execute on function public.onboarding_funnel(int) to service_role;

-- 4. The onboarding reveal (last wizard step, shown with the paywall): what's
--    within p_radius_m of a point. Low scorers (0–2) come back WITHOUT names —
--    scores, types and distances only — so the teaser can't be read off the
--    response; the app looks the names up after purchase. The two nearest
--    5-rated places are shown in full.
create or replace function public.nearby_teaser(
  origin_lng double precision,
  origin_lat double precision,
  p_radius_m double precision default 1609
)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with here as (
    select r.id, r.name, r.business_type, r.rating_value, r.rating_is_numeric,
           st_distance(r.geo, st_point(origin_lng, origin_lat)::geography) as distance_m
    from public.restaurants r
    where r.geo is not null
      and st_dwithin(r.geo, st_point(origin_lng, origin_lat)::geography, least(p_radius_m, 5000))
  ),
  low as (
    select * from here
    where rating_is_numeric and rating_value in ('0', '1', '2')
  )
  select jsonb_build_object(
    'total', (select count(*) from here),
    'low_count', (select count(*) from low),
    'low', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'rating_value', l.rating_value,
               'business_type', l.business_type, 'distance_m', round(l.distance_m)))
      from (select * from low order by rating_value, distance_m limit 3) l
    ), '[]'::jsonb),
    'best', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'rating_value', b.rating_value,
               'business_type', b.business_type, 'distance_m', round(b.distance_m)))
      from (select * from here where rating_value = '5' order by distance_m limit 2) b
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.nearby_teaser(double precision, double precision, double precision) from public, anon;
grant execute on function public.nearby_teaser(double precision, double precision, double precision) to authenticated;

-- 5. Whether a username is free, for the wizard's live check. Profiles are
--    only readable by their owner, so this can't be a plain select.
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where username = lower(p_username) and user_id <> auth.uid()
  );
$$;

revoke execute on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
