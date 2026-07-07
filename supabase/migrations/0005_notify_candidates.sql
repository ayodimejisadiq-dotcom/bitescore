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
