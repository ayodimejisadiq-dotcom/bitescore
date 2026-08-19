-- Restaurant watches: the "notify me when their score changes" bell on the
-- restaurant detail page. Previously the only way to be notified was
-- implicit — having the restaurant on any list — which doesn't map to a
-- direct "watch this one place" gesture on the detail page.
--
-- notify_candidates is recreated to union both paths, and now also requires
-- an active (or grace-period) entitlement. Score-change alerts are the paid
-- feature; without this the list-based path would let anyone get it for
-- free just by saving a place, since list saving itself isn't gated.

create table if not exists public.restaurant_watches (
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index if not exists restaurant_watches_restaurant_idx on public.restaurant_watches (restaurant_id);

alter table public.restaurant_watches enable row level security;

drop policy if exists restaurant_watches_owner_all on public.restaurant_watches;
create policy restaurant_watches_owner_all on public.restaurant_watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.notify_candidates(p_restaurant_id uuid)
returns table (user_id uuid, expo_token text)
language sql stable
security definer set search_path = public
as $$
  select distinct pt.user_id, pt.expo_token
  from (
    select l.user_id
    from public.list_items li
    join public.lists l on l.id = li.list_id
    where li.restaurant_id = p_restaurant_id
    union
    select rw.user_id
    from public.restaurant_watches rw
    where rw.restaurant_id = p_restaurant_id
  ) followers
  join public.notification_prefs np on np.user_id = followers.user_id and np.score_change_enabled = true
  join public.push_tokens pt on pt.user_id = followers.user_id
  join public.entitlements e on e.user_id = followers.user_id and e.status in ('active', 'grace');
$$;

revoke execute on function public.notify_candidates(uuid) from public, anon, authenticated;
