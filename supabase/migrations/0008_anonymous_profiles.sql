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
