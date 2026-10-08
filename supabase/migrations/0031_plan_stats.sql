-- Free vs Pro user counts. RevenueCat only counts store purchases, so free
-- users never show up in its subscription or revenue cards; this is where to
-- see them. Run in the Supabase SQL editor:
--   select * from public.plan_stats();
--
-- Pro = an active row in public.entitlements (kept in sync by the RevenueCat
-- webhook). Everyone else with an account is free.

create or replace function public.plan_stats()
returns table (
  total_users                  int,
  pro_users                    int,
  free_users                   int,
  free_new_last_28_days        int,
  free_used_places_this_month  int,
  free_hit_limit_this_month    int,
  free_limit                   int
)
language sql stable security definer
set search_path = public
as $$
  with pro as (
    select user_id from public.entitlements
    where status in ('active', 'grace')
      and (expires_at is null or expires_at > now())
  ),
  free as (
    select u.id, u.created_at from auth.users u
    where not exists (select 1 from pro where pro.user_id = u.id)
  ),
  month_usage as (
    select f.user_id, count(*) as used from public.free_opens f
    join free on free.id = f.user_id
    where f.month = public.current_free_month()
    group by f.user_id
  )
  select
    (select count(*)::int from auth.users),
    (select count(*)::int from pro),
    (select count(*)::int from free),
    (select count(*)::int from free where created_at > now() - interval '28 days'),
    (select count(*)::int from month_usage),
    (select count(*)::int from month_usage where used >= public.free_plan_limit()),
    public.free_plan_limit();
$$;

-- Owner-only: reads every account. Not callable with the app's keys.
revoke execute on function public.plan_stats() from public, anon, authenticated;
grant execute on function public.plan_stats() to service_role;
