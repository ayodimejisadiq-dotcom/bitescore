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
