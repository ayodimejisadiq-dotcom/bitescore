-- Everything the stats dashboard shows, as one JSON object, so the page makes
-- one read:  select public.dashboard_stats();
-- Pro/free use the same definition as plan_stats() (0031). Days are UK days.

create or replace function public.dashboard_stats()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with pro as (
    select user_id, product from public.entitlements
    where status in ('active', 'grace')
      and (expires_at is null or expires_at > now())
  ),
  uk_today as (select (now() at time zone 'Europe/London')::date as d),
  days as (
    select generate_series((select d from uk_today) - 59, (select d from uk_today), interval '1 day')::date as d
  ),
  signups as (
    select (created_at at time zone 'Europe/London')::date as d, count(*) as n
    from auth.users group by 1
  ),
  opens as (
    select (opened_at at time zone 'Europe/London')::date as d,
           count(*) as places, count(distinct user_id) as people
    from public.free_opens group by 1
  ),
  month_usage as (
    select user_id, count(*) as used from public.free_opens
    where month = public.current_free_month()
      and user_id not in (select user_id from pro)
    group by user_id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total',     (select count(*) from auth.users),
      'pro',       (select count(*) from pro),
      'free',      (select count(*) from auth.users u where u.id not in (select user_id from pro)),
      'signed_in', (select count(*) from auth.users where not is_anonymous),
      'new_7d',    (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'new_28d',   (select count(*) from auth.users where created_at > now() - interval '28 days')
    ),
    'pro', jsonb_build_object(
      'annual',   (select count(*) from pro where product = 'annual'),
      'lifetime', (select count(*) from pro where product = 'lifetime'),
      'other',    (select count(*) from pro where product is null)
    ),
    'free_plan', jsonb_build_object(
      'limit',                 public.free_plan_limit(),
      'requires_sign_in',      (select value #>> '{}' from public.app_config where key = 'free_requires_sign_in'),
      'launched_on',           (select min(opened_at)::date from public.free_opens),
      'people_this_month',     (select count(*) from month_usage),
      'places_this_month',     (select coalesce(sum(used), 0) from month_usage),
      'hit_limit_this_month',  (select count(*) from month_usage where used >= public.free_plan_limit()),
      'resets_on',             (public.current_free_month() + interval '1 month')::date
    ),
    'engagement', jsonb_build_object(
      'lists',            (select count(*) from public.lists),
      'list_owners',      (select count(distinct user_id) from public.lists),
      'saved_places',     (select count(*) from public.list_items),
      'reviews',          (select count(*) from public.reviews),
      'visits',           (select count(*) from public.visits),
      'follows',          (select count(*) from public.follows),
      'push_enabled',     (select count(distinct user_id) from public.push_tokens),
      'alerts_on',        (select count(*) from public.notification_prefs where score_change_enabled)
    ),
    'data', jsonb_build_object(
      'restaurants',        (select count(*) from public.restaurants),
      'last_ingest_run',    (select max(last_run_at) from public.ingest_state),
      'last_full_pass',     (select max(last_completed_at) from public.ingest_state),
      'score_changes_7d',   (select count(*) from public.score_changes where changed_at > now() - interval '7 days'),
      'score_changes_28d',  (select count(*) from public.score_changes where changed_at > now() - interval '28 days')
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'd', days.d,
        'signups', coalesce(s.n, 0),
        'total', (select count(*) from auth.users where (created_at at time zone 'Europe/London')::date <= days.d),
        'free_places', coalesce(o.places, 0),
        'free_people', coalesce(o.people, 0)
      ) order by days.d)
      from days
      left join signups s on s.d = days.d
      left join opens o on o.d = days.d
    )
  );
$$;

-- Owner-only: reads every account. Not callable with the app's keys.
revoke execute on function public.dashboard_stats() from public, anon, authenticated;
grant execute on function public.dashboard_stats() to service_role;
