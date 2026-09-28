-- The social redesign: following, shared lists, verified visits, diner checks,
-- tiers, badges and taste match.
--
-- Privacy model, which everything below follows:
--   * Real first/last names stay private (see 0008). What other people see is
--     the username plus an optional `public_name` the user types in
--     themselves, and an optional city.
--   * Visits and diner checks are never readable row-by-row by anyone but
--     their owner. Other people only ever get aggregates through the
--     security-definer functions here ("Maya and Tom have been here",
--     "41 verified diners say it's cleaner", taste match on places you share).
--   * Anonymous reviews stop exposing their author's user_id. Before this,
--     `select * from reviews` returned user_id for anonymous reviews too, which
--     was harmless while a user_id led nowhere — profiles now make it lead
--     somewhere, so anonymous rows are served only through restaurant_reviews().

-- ---------------------------------------------------------------------------
-- Profiles: public identity
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists public_name text check (char_length(public_name) <= 60),
  add column if not exists city text check (char_length(city) <= 60);

-- Safe-to-show fields for any set of users. Never returns first/last name.
create or replace function public.profile_cards(p_ids uuid[])
returns table (user_id uuid, username text, public_name text, city text)
language sql stable
security definer set search_path = public
as $$
  select p.user_id, p.username, p.public_name, p.city
  from public.profiles p
  where p.user_id = any(p_ids);
$$;

-- ---------------------------------------------------------------------------
-- Follows (open model: anyone can follow anyone)
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- The follow graph is public, like follower counts on any social app.
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete using (auth.uid() = follower_id);

-- ---------------------------------------------------------------------------
-- Shared lists
-- ---------------------------------------------------------------------------
alter table public.lists
  add column if not exists access text not null default 'private'
    check (access in ('private', 'invited', 'link')),
  add column if not exists share_slug text unique,
  add column if not exists collaborators_can_add boolean not null default true;

-- Private lists have no link; shared ones always have one.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lists_slug_matches_access') then
    alter table public.lists
      add constraint lists_slug_matches_access check ((access = 'private') = (share_slug is null));
  end if;
end $$;

-- The slug doubles as the invite for 'invited' lists, so its tail must be
-- unguessable: 12 hex chars from gen_random_uuid (48 random bits). The name
-- prefix is only there to make the link readable.
create or replace function public.lists_manage_slug()
returns trigger
language plpgsql
as $$
declare
  prefix text;
begin
  if new.access = 'private' then
    new.share_slug := null;
  elsif new.share_slug is null then
    prefix := trim(both '-' from left(regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'), 16));
    new.share_slug := case when prefix = '' then '' else prefix || '-' end
      || left(replace(gen_random_uuid()::text, '-', ''), 12);
  end if;
  return new;
end;
$$;

drop trigger if exists lists_manage_slug on public.lists;
create trigger lists_manage_slug
  before insert or update of access on public.lists
  for each row execute function public.lists_manage_slug();

create table if not exists public.list_members (
  list_id    uuid not null references public.lists(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- The owner is lists.user_id and never has a row here. Editors can add
  -- places while the list's collaborators_can_add switch is on.
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index if not exists list_members_user_idx on public.list_members (user_id);

alter table public.list_items
  add column if not exists added_by uuid references auth.users(id) on delete set null default auth.uid();

update public.list_items li
set added_by = l.user_id
from public.lists l
where l.id = li.list_id and li.added_by is null;

-- Access helpers. Security definer so policies on lists and list_members can
-- consult each other without recursing through RLS.
create or replace function public.list_role(p_list_id uuid)
returns text
language sql stable
security definer set search_path = public
as $$
  select case
    when l.user_id = auth.uid() then 'owner'
    when m.role is not null then m.role
    when l.access = 'link' then 'link'
    else null
  end
  from public.lists l
  left join public.list_members m on m.list_id = l.id and m.user_id = auth.uid()
  where l.id = p_list_id;
$$;

create or replace function public.is_list_member(p_list_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.list_members where list_id = p_list_id and user_id = auth.uid());
$$;

create or replace function public.can_add_to_list(p_list_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list_id
      and (
        l.user_id = auth.uid()
        or (
          l.collaborators_can_add
          and l.access <> 'private'
          and exists (
            select 1 from public.list_members m
            where m.list_id = l.id and m.user_id = auth.uid() and m.role = 'editor'
          )
        )
      )
  );
$$;

alter table public.lists enable row level security;

drop policy if exists lists_owner_all on public.lists;
drop policy if exists lists_read on public.lists;
-- Checked on the row's own columns, not through list_role(): an INSERT ...
-- RETURNING re-checks this policy against the new row, which a lookup by id
-- can't see yet, so creating a list would fail.
create policy lists_read on public.lists
  for select using (user_id = auth.uid() or access = 'link' or public.is_list_member(id));
drop policy if exists lists_insert_own on public.lists;
create policy lists_insert_own on public.lists
  for insert with check (auth.uid() = user_id);
drop policy if exists lists_update_own on public.lists;
create policy lists_update_own on public.lists
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists lists_delete_own on public.lists;
create policy lists_delete_own on public.lists
  for delete using (auth.uid() = user_id);

drop policy if exists list_items_owner_all on public.list_items;
drop policy if exists list_items_read on public.list_items;
create policy list_items_read on public.list_items
  for select using (public.list_role(list_id) is not null);
drop policy if exists list_items_insert on public.list_items;
create policy list_items_insert on public.list_items
  for insert with check (public.can_add_to_list(list_id) and added_by = auth.uid());
-- Upserts touch existing rows too; allow it for the same people who can add.
drop policy if exists list_items_update on public.list_items;
create policy list_items_update on public.list_items
  for update using (public.can_add_to_list(list_id)) with check (public.can_add_to_list(list_id));
-- The owner can remove anything; a collaborator only what they added.
drop policy if exists list_items_delete on public.list_items;
create policy list_items_delete on public.list_items
  for delete using (
    public.list_role(list_id) = 'owner'
    or (added_by = auth.uid() and public.can_add_to_list(list_id))
  );

alter table public.list_members enable row level security;

drop policy if exists list_members_read on public.list_members;
create policy list_members_read on public.list_members
  for select using (public.list_role(list_id) in ('owner', 'editor', 'viewer'));
-- Joining goes through join_list(); owners add people via invite_to_list().
drop policy if exists list_members_update_owner on public.list_members;
create policy list_members_update_owner on public.list_members
  for update using (public.list_role(list_id) = 'owner') with check (public.list_role(list_id) = 'owner');
-- Leave a list yourself, or be removed by its owner.
drop policy if exists list_members_delete on public.list_members;
create policy list_members_delete on public.list_members
  for delete using (user_id = auth.uid() or public.list_role(list_id) = 'owner');

-- Score tiles for a list's mosaic, oldest-added first.
create or replace function public.list_mosaic(p_list_id uuid)
returns text[]
language sql stable
security definer set search_path = public
as $$
  select coalesce(array_agg(rating_value order by created_at), '{}')
  from (
    select r.rating_value, li.created_at
    from public.list_items li
    join public.restaurants r on r.id = li.restaurant_id
    where li.list_id = p_list_id
    order by li.created_at
    limit 4
  ) t;
$$;

-- People on a list other than the caller: the owner plus members.
create or replace function public.list_people(p_list_id uuid)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'username', p.username, 'public_name', p.public_name,
           'role', x.role) order by x.ord, x.joined_at), '[]'::jsonb)
  from (
    select l.user_id, 'owner'::text as role, 0 as ord, l.created_at as joined_at
    from public.lists l where l.id = p_list_id
    union all
    select m.user_id, m.role, 1, m.joined_at
    from public.list_members m where m.list_id = p_list_id
  ) x
  join public.profiles p on p.user_id = x.user_id;
$$;

-- The Lists tab: lists I own or belong to. Others' link-only lists are
-- readable but are not "mine", so they're excluded here.
create or replace function public.my_lists()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  owner_id uuid,
  access text,
  share_slug text,
  collaborators_can_add boolean,
  my_role text,
  place_count int,
  mosaic text[],
  people jsonb
)
language sql stable
security definer set search_path = public
as $$
  select l.id, l.name, l.created_at, l.user_id, l.access, l.share_slug,
         l.collaborators_can_add,
         case when l.user_id = auth.uid() then 'owner' else m.role end,
         (select count(*)::int from public.list_items li where li.list_id = l.id),
         public.list_mosaic(l.id),
         public.list_people(l.id)
  from public.lists l
  left join public.list_members m on m.list_id = l.id and m.user_id = auth.uid()
  where l.user_id = auth.uid() or m.user_id is not null
  order by l.created_at;
$$;

create or replace function public.list_detail(p_list_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public
as $$
declare
  v_role text := public.list_role(p_list_id);
  v jsonb;
begin
  if v_role is null then
    return null;
  end if;
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'owner_id', l.user_id, 'access', l.access,
    'share_slug', l.share_slug, 'collaborators_can_add', l.collaborators_can_add,
    'my_role', v_role, 'can_add', public.can_add_to_list(l.id),
    'people', public.list_people(l.id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'business_type', r.business_type,
        'rating_value', r.rating_value, 'rating_is_numeric', r.rating_is_numeric,
        'address', r.address, 'postcode', r.postcode,
        'lng', r.geo_lng, 'lat', r.geo_lat,
        'added_by', li.added_by, 'added_at', li.created_at) order by li.created_at desc)
      from public.list_items li
      join public.restaurants r on r.id = li.restaurant_id
      where li.list_id = l.id
    ), '[]'::jsonb)
  ) into v
  from public.lists l where l.id = p_list_id;
  return v;
end;
$$;

-- Preview behind a share link, for the invite landing screen and the web page.
create or replace function public.list_by_slug(p_slug text)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'access', l.access, 'owner_id', l.user_id,
    'collaborators_can_add', l.collaborators_can_add,
    'my_role', public.list_role(l.id),
    'place_count', (select count(*) from public.list_items li where li.list_id = l.id),
    'people_count', 1 + (select count(*) from public.list_members m where m.list_id = l.id),
    'owner', (select jsonb_build_object('user_id', p.user_id, 'username', p.username,
                                        'public_name', p.public_name)
              from public.profiles p where p.user_id = l.user_id),
    'mosaic', public.list_mosaic(l.id),
    'preview', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', r.id, 'name', r.name, 'rating_value', r.rating_value) as x
        from public.list_items li join public.restaurants r on r.id = li.restaurant_id
        where li.list_id = l.id order by li.created_at limit 3
      ) t
    ), '[]'::jsonb)
  )
  from public.lists l
  where l.share_slug = p_slug and l.access <> 'private';
$$;

-- Join from a link. Invited lists accept editors or viewers; link lists are
-- read-only, so joining one just keeps it under "Shared with you".
create or replace function public.join_list(p_slug text, p_role text default 'editor')
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  l public.lists;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into l from public.lists where share_slug = p_slug and access <> 'private';
  if l.id is null then raise exception 'list_not_found'; end if;
  if l.user_id = auth.uid() then return l.id; end if;
  insert into public.list_members (list_id, user_id, role, invited_by)
  values (l.id, auth.uid(),
          case when l.access = 'invited' and p_role = 'editor' then 'editor' else 'viewer' end,
          l.user_id)
  on conflict (list_id, user_id) do nothing;
  return l.id;
end;
$$;

-- The owner adds someone they follow straight onto the list.
create or replace function public.invite_to_list(p_list_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if public.list_role(p_list_id) is distinct from 'owner' then
    raise exception 'not_owner';
  end if;
  if not exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_user_id) then
    raise exception 'not_following';
  end if;
  if exists (select 1 from public.user_blocks where blocker_id = p_user_id and blocked_id = auth.uid()) then
    raise exception 'not_allowed';
  end if;
  update public.lists set access = 'invited' where id = p_list_id and access = 'private';
  insert into public.list_members (list_id, user_id, role, invited_by)
  values (p_list_id, p_user_id, 'editor', auth.uid())
  on conflict (list_id, user_id) do nothing;
end;
$$;

-- Lists that show on a profile: only "anyone with the link" ones.
create or replace function public.public_lists(p_user_id uuid)
returns table (id uuid, name text, share_slug text, place_count int, mosaic text[])
language sql stable
security definer set search_path = public
as $$
  select l.id, l.name, l.share_slug,
         (select count(*)::int from public.list_items li where li.list_id = l.id),
         public.list_mosaic(l.id)
  from public.lists l
  where l.user_id = p_user_id and l.access = 'link'
  order by l.created_at desc;
$$;

-- Score-change pushes now reach everyone on a shared list, not just its owner.
create or replace function public.notify_candidates(p_restaurant_id uuid)
returns table (user_id uuid, expo_token text)
language sql stable
security definer set search_path = public
as $$
  select distinct pt.user_id, pt.expo_token
  from public.list_items li
  join public.lists l on l.id = li.list_id
  join (
    select id as list_id, user_id from public.lists
    union
    select list_id, user_id from public.list_members
  ) who on who.list_id = l.id
  join public.notification_prefs np on np.user_id = who.user_id and np.score_change_enabled = true
  join public.push_tokens pt on pt.user_id = who.user_id
  where li.restaurant_id = p_restaurant_id;
$$;

revoke execute on function public.notify_candidates(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visits
-- ---------------------------------------------------------------------------
create table if not exists public.visits (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  visited_at    timestamptz not null default now(),
  -- The UK calendar day, which is what "one visit per venue per day" means.
  visit_date    date not null default ((now() at time zone 'Europe/London')::date),
  method        text not null check (method in ('location', 'receipt', 'reminder', 'none')),
  verified      boolean not null default false,
  distance_m    double precision,
  unique (user_id, restaurant_id, visit_date)
);

create index if not exists visits_user_idx on public.visits (user_id, visited_at desc);
create index if not exists visits_restaurant_idx on public.visits (restaurant_id) where verified;

alter table public.visits enable row level security;

-- Your own history only. Writes go through log_visit(), which does the checks.
drop policy if exists visits_read_own on public.visits;
create policy visits_read_own on public.visits for select using (auth.uid() = user_id);
drop policy if exists visits_delete_own on public.visits;
create policy visits_delete_own on public.visits for delete using (auth.uid() = user_id);

-- Location verification is decided here, not on the phone: the phone sends
-- where it is and the server measures the distance to the venue.
create or replace function public.log_visit(
  p_restaurant_id uuid,
  p_method text,
  p_lng double precision default null,
  p_lat double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_distance double precision;
  v_verified boolean := false;
  v_row public.visits;
  max_distance constant double precision := 75;
  daily_cap constant int := 8;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_method not in ('location', 'none') then raise exception 'unsupported_method'; end if;

  if p_method = 'location' then
    if p_lng is null or p_lat is null then raise exception 'location_required'; end if;
    select st_distance(r.geo, st_point(p_lng, p_lat)::geography) into v_distance
    from public.restaurants r where r.id = p_restaurant_id and r.geo is not null;
    if v_distance is null then raise exception 'venue_has_no_location'; end if;
    if v_distance > max_distance then raise exception 'too_far'; end if;
    v_verified := true;
  end if;

  select * into v_row from public.visits
  where user_id = auth.uid() and restaurant_id = p_restaurant_id and visit_date = v_today;

  if v_row.id is not null then
    -- Already logged today: a later location check can still verify it.
    if v_verified and not v_row.verified then
      update public.visits
      set verified = true, method = 'location', distance_m = v_distance, visited_at = now()
      where id = v_row.id
      returning * into v_row;
    end if;
  else
    if (select count(*) from public.visits where user_id = auth.uid() and visit_date = v_today) >= daily_cap then
      raise exception 'daily_visit_cap';
    end if;
    insert into public.visits (user_id, restaurant_id, visit_date, method, verified, distance_m)
    values (auth.uid(), p_restaurant_id, v_today, p_method, v_verified, v_distance)
    returning * into v_row;
  end if;

  return jsonb_build_object('id', v_row.id, 'verified', v_row.verified,
                            'visited_at', v_row.visited_at, 'distance_m', v_row.distance_m);
end;
$$;

-- People I follow who have a verified visit here.
create or replace function public.followed_visitors(p_restaurant_id uuid)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'people', coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'username', p.username, 'public_name', p.public_name))
      filter (where rn <= 3), '[]'::jsonb)
  )
  from (
    select distinct on (v.user_id) v.user_id,
           row_number() over (order by v.user_id) as rn
    from public.visits v
    join public.follows f on f.followee_id = v.user_id and f.follower_id = auth.uid()
    where v.restaurant_id = p_restaurant_id and v.verified
  ) x
  join public.profiles p on p.user_id = x.user_id;
$$;

-- ---------------------------------------------------------------------------
-- Diner checks: verified diners say whether a place matches its score or is
-- cleaner now. The official FSA rating is never touched.
-- ---------------------------------------------------------------------------
create table if not exists public.diner_checks (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  verdict       text not null check (verdict in ('match', 'cleaner')),
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create index if not exists diner_checks_restaurant_idx on public.diner_checks (restaurant_id, created_at);

alter table public.diner_checks enable row level security;

drop policy if exists diner_checks_read_own on public.diner_checks;
create policy diner_checks_read_own on public.diner_checks for select using (auth.uid() = user_id);

create or replace function public.set_diner_check(p_restaurant_id uuid, p_verdict text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_verdict is null then
    delete from public.diner_checks where user_id = auth.uid() and restaurant_id = p_restaurant_id;
    return;
  end if;
  if p_verdict not in ('match', 'cleaner') then raise exception 'bad_verdict'; end if;
  if not exists (
    select 1 from public.visits
    where user_id = auth.uid() and restaurant_id = p_restaurant_id and verified
      and visited_at > now() - interval '90 days'
  ) then
    raise exception 'needs_verified_visit';
  end if;
  -- Re-voting restarts the 90-day clock.
  insert into public.diner_checks (user_id, restaurant_id, verdict, created_at)
  values (auth.uid(), p_restaurant_id, p_verdict, now())
  on conflict (user_id, restaurant_id) do update set verdict = excluded.verdict, created_at = now();
end;
$$;

-- Counts only votes from the last 90 days and cast after the latest
-- inspection: a vote about the kitchen before a re-inspection says nothing
-- about the new score. Totals are public only from 5 votes up.
create or replace function public.diner_check_summary(p_restaurant_id uuid)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  with r as (select rating_date from public.restaurants where id = p_restaurant_id),
  live as (
    select d.* from public.diner_checks d, r
    where d.restaurant_id = p_restaurant_id
      and d.created_at > now() - interval '90 days'
      and (r.rating_date is null or d.created_at::date >= r.rating_date)
  )
  select jsonb_build_object(
    'total', (select count(*) from live),
    'cleaner', case when (select count(*) from live) >= 5
                    then (select count(*) from live where verdict = 'cleaner') end,
    'match', case when (select count(*) from live) >= 5
                  then (select count(*) from live where verdict = 'match') end,
    'min_public', 5,
    'my_verdict', (select verdict from live where user_id = auth.uid()),
    'can_vote', exists (
      select 1 from public.visits
      where user_id = auth.uid() and restaurant_id = p_restaurant_id and verified
        and visited_at > now() - interval '90 days'
    ),
    'my_visit_today', (
      select jsonb_build_object('verified', v.verified, 'visited_at', v.visited_at, 'method', v.method)
      from public.visits v
      where v.user_id = auth.uid() and v.restaurant_id = p_restaurant_id
        and v.visit_date = (now() at time zone 'Europe/London')::date
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Reviews: stop exposing who wrote anonymous reviews
-- ---------------------------------------------------------------------------
drop policy if exists reviews_read_visible on public.reviews;
create policy reviews_read_visible on public.reviews
  for select using (
    status = 'visible'
    and not is_anonymous
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = reviews.user_id
    )
  );

create or replace function public.restaurant_reviews(p_restaurant_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  user_id uuid,
  display_name_snapshot text,
  is_anonymous boolean,
  body text,
  status text,
  created_at timestamptz,
  public_name text,
  username text
)
language sql stable
security definer set search_path = public
as $$
  select rv.id, rv.restaurant_id,
         case when rv.is_anonymous and rv.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
              then null else rv.user_id end,
         case when rv.is_anonymous then null else rv.display_name_snapshot end,
         rv.is_anonymous, rv.body, rv.status, rv.created_at,
         case when rv.is_anonymous then null else p.public_name end,
         case when rv.is_anonymous then null else p.username end
  from public.reviews rv
  left join public.profiles p on p.user_id = rv.user_id
  where rv.restaurant_id = p_restaurant_id
    and rv.status = 'visible'
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = rv.user_id
    )
  order by rv.created_at desc
  limit 50;
$$;

-- Blocking works on anonymous reviews without revealing whose they are.
create or replace function public.block_review_author(p_review_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_author uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select user_id into v_author from public.reviews where id = p_review_id;
  if v_author is null or v_author = auth.uid() then return; end if;
  insert into public.user_blocks (blocker_id, blocked_id)
  values (auth.uid(), v_author)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: summary, tiers, badges, taste match
-- ---------------------------------------------------------------------------

-- Normalised name, for telling chains from independents: a name that appears
-- on 10+ venues nationally counts as a chain ("McDonald's" and "McDonalds"
-- both become "mcdonalds").
create or replace function public.name_key(p_name text)
returns text
language sql immutable
as $$ select lower(regexp_replace(p_name, '[^a-zA-Z0-9]', '', 'g')) $$;

create index if not exists restaurants_name_key_idx on public.restaurants (public.name_key(name));

create or replace function public.is_chain(p_name text)
returns boolean
language sql stable
as $$
  select count(*) >= 10 from (
    select 1 from public.restaurants where public.name_key(name) = public.name_key(p_name) limit 10
  ) t;
$$;

create or replace function public.profile_summary(p_user_id uuid)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  with v as (
    select vi.restaurant_id, r.name, r.rating_value, r.rating_is_numeric, r.local_authority
    from public.visits vi
    join public.restaurants r on r.id = vi.restaurant_id
    where vi.user_id = p_user_id and vi.verified
  ),
  places as (
    select distinct on (restaurant_id) restaurant_id, name, rating_value, rating_is_numeric,
           local_authority, public.is_chain(name) as chain
    from v
  ),
  visit_chain as (
    select v.restaurant_id, p.chain from v join places p using (restaurant_id)
  )
  select jsonb_build_object(
    'user_id', pr.user_id,
    'username', pr.username,
    'public_name', pr.public_name,
    'city', pr.city,
    'is_me', pr.user_id = auth.uid(),
    'followers', (select count(*) from public.follows where followee_id = pr.user_id),
    'following', (select count(*) from public.follows where follower_id = pr.user_id),
    'i_follow', exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = pr.user_id),
    'follows_me', exists (select 1 from public.follows where follower_id = pr.user_id and followee_id = auth.uid()),
    'reviews', (select count(*) from public.reviews
                where user_id = pr.user_id and status = 'visible' and not is_anonymous),
    'verified_visits', (select count(*) from v),
    'independent_pct', (select case when count(*) = 0 then null
                         else round(100.0 * count(*) filter (where not chain) / count(*)) end
                        from visit_chain),
    'avg_score', (select round(avg(rating_value::numeric), 1) from places where rating_is_numeric),
    'authorities', (select count(distinct local_authority) from places),
    'chain_visits', (select count(*) from visit_chain where chain)
  )
  from public.profiles pr
  where pr.user_id = p_user_id;
$$;

-- Followers or following, with whether I follow each of them back.
create or replace function public.follow_list(p_user_id uuid, p_kind text)
returns table (user_id uuid, username text, public_name text, i_follow boolean, follows_me boolean)
language sql stable
security definer set search_path = public
as $$
  select p.user_id, p.username, p.public_name,
         exists (select 1 from public.follows f2 where f2.follower_id = auth.uid() and f2.followee_id = p.user_id),
         exists (select 1 from public.follows f3 where f3.follower_id = p.user_id and f3.followee_id = auth.uid())
  from public.follows f
  join public.profiles p
    on p.user_id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
  where (p_kind = 'followers' and f.followee_id = p_user_id)
     or (p_kind = 'following' and f.follower_id = p_user_id)
  order by f.created_at desc
  limit 500;
$$;

-- Places we've both verified-visited and how our diner checks compare.
-- Agreement is only counted where both of us voted.
create or replace function public.taste_match(p_other uuid)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  with shared as (
    select distinct a.restaurant_id
    from public.visits a
    join public.visits b on b.restaurant_id = a.restaurant_id and b.user_id = p_other and b.verified
    where a.user_id = auth.uid() and a.verified and p_other <> auth.uid()
  ),
  rows as (
    select s.restaurant_id, r.name, r.rating_value,
           (select verdict from public.diner_checks where user_id = auth.uid() and restaurant_id = s.restaurant_id) as mine,
           (select verdict from public.diner_checks where user_id = p_other and restaurant_id = s.restaurant_id) as theirs
    from shared s join public.restaurants r on r.id = s.restaurant_id
  )
  select jsonb_build_object(
    'shared', (select count(*) from rows),
    'compared', (select count(*) from rows where mine is not null and theirs is not null),
    'agreed', (select count(*) from rows where mine is not null and mine = theirs),
    'places', coalesce((select jsonb_agg(jsonb_build_object(
                'id', restaurant_id, 'name', name, 'rating_value', rating_value,
                'mine', mine, 'theirs', theirs) order by name)
              from (select * from rows order by name limit 10) t), '[]'::jsonb)
  );
$$;

-- Public (non-anonymous) reviews by a user, newest first.
create or replace function public.user_reviews(p_user_id uuid)
returns table (id uuid, restaurant_id uuid, restaurant_name text, rating_value text, body text, created_at timestamptz)
language sql stable
security definer set search_path = public
as $$
  select rv.id, rv.restaurant_id, r.name, r.rating_value, rv.body, rv.created_at
  from public.reviews rv
  join public.restaurants r on r.id = rv.restaurant_id
  where rv.user_id = p_user_id and rv.status = 'visible' and not rv.is_anonymous
  order by rv.created_at desc
  limit 20;
$$;
