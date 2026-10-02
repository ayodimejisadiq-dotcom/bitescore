-- Free plan: a monthly allowance of restaurant pages for people without Pro.
--
-- The allowance lives in app_config so it can be changed, or switched off,
-- without an app update:
--   update public.app_config set value = '10' where key = 'free_places_per_month';
--   0 = no free plan; everyone without Pro sees the paywall, as before.
--
-- Production applied this one statement at a time (the batch kept timing
-- out through the API); the result is the same as running this file.
--
-- A "place" is a distinct restaurant per calendar month (UK time): opening
-- the same place again that month is free, and the count resets on the 1st.
-- Pro users never call these; the app checks the store entitlement first.

create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null
);

alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select using (true);

insert into public.app_config (key, value)
values ('free_places_per_month', '10')
on conflict (key) do nothing;

create table if not exists public.free_opens (
  user_id       uuid not null references auth.users(id) on delete cascade,
  month         date not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  opened_at     timestamptz not null default now(),
  primary key (user_id, month, restaurant_id)
);

alter table public.free_opens enable row level security;
-- Read-only to the owner; rows are only ever written by claim_free_place.
drop policy if exists free_opens_read_own on public.free_opens;
create policy free_opens_read_own on public.free_opens
  for select using (user_id = auth.uid());

create or replace function public.free_plan_limit()
returns int
language sql stable
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from public.app_config
                   where key = 'free_places_per_month'), 0);
$$;

create or replace function public.current_free_month()
returns date
language sql stable
set search_path = public
as $$
  select date_trunc('month', now() at time zone 'Europe/London')::date;
$$;

-- What the app shows: the allowance, how much of it is used, when it resets.
create or replace function public.free_plan_status()
returns table (free_limit int, used int, resets_on date)
language sql stable security definer
set search_path = public
as $$
  select public.free_plan_limit(),
         (select count(*)::int from public.free_opens f
          where f.user_id = auth.uid() and f.month = public.current_free_month()),
         (public.current_free_month() + interval '1 month')::date;
$$;

-- Records opening a place and says whether it's allowed. Re-opening a place
-- already counted this month is always allowed and costs nothing.
create or replace function public.claim_free_place(p_restaurant_id uuid)
returns table (allowed boolean, free_limit int, used int, resets_on date)
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_month date := public.current_free_month();
  v_limit int := public.free_plan_limit();
  v_used  int;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- One claim at a time per person, so two quick taps can't both take the
  -- last free place.
  perform pg_advisory_xact_lock(hashtext('free_opens:' || v_uid::text));

  select count(*)::int into v_used
  from public.free_opens where user_id = v_uid and month = v_month;

  if exists (select 1 from public.free_opens
             where user_id = v_uid and month = v_month and restaurant_id = p_restaurant_id) then
    return query select true, v_limit, v_used, (v_month + interval '1 month')::date;
    return;
  end if;

  if v_used >= v_limit then
    return query select false, v_limit, v_used, (v_month + interval '1 month')::date;
    return;
  end if;

  insert into public.free_opens (user_id, month, restaurant_id)
  values (v_uid, v_month, p_restaurant_id);
  return query select true, v_limit, v_used + 1, (v_month + interval '1 month')::date;
end;
$$;

revoke execute on function public.claim_free_place(uuid) from public, anon;
grant execute on function public.claim_free_place(uuid) to authenticated;
revoke execute on function public.free_plan_status() from public, anon;
grant execute on function public.free_plan_status() to authenticated;
